// Clinical data services: ICD-10 smart search, HAPI FHIR import, licensing-registry checks.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  lookupFacilitySnapshot,
  lookupClinicianSnapshot,
  verifyFacility,
  verifyClinician,
  type FacilityRecord,
  type ClinicianRecord,
} from '@kavach/sdk';

// ---------------- ICD-10 (71k codes, offline) ----------------
type Icd = { code: string; desc: string; cat: string; l: string };
let ICD: Icd[] = [];
const csv = fileURLToPath(new URL('../../.cache/icd10/codes.csv', import.meta.url));
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) (out.push(cur), (cur = ''));
    else cur += ch;
  }
  out.push(cur);
  return out;
}
if (existsSync(csv)) {
  for (const line of readFileSync(csv, 'utf8').split('\n')) {
    if (!line) continue;
    const [, , full, , long, cat] = parseCsvLine(line);
    const code = full.length > 3 ? `${full.slice(0, 3)}.${full.slice(3)}` : full;
    ICD.push({ code, desc: long, cat, l: long.toLowerCase() });
  }
  // add the 3-character category codes too (e.g. B20)
  const seen = new Set(ICD.map((x) => x.code));
  for (const x of [...ICD]) {
    const c3 = x.code.slice(0, 3);
    if (!seen.has(c3)) (seen.add(c3), ICD.push({ code: c3, desc: x.cat, cat: x.cat, l: x.cat.toLowerCase() }));
  }
}

// Lay terms → clinical vocabulary (what a front-desk clerk types vs what ICD says).
const SYNONYMS: Record<string, string> = {
  cancer: 'malignant neoplasm',
  tumour: 'neoplasm',
  tumor: 'neoplasm',
  'heart attack': 'myocardial infarction',
  stroke: 'cerebral infarction',
  'sugar': 'diabetes mellitus',
  diabetes: 'diabetes mellitus',
  bp: 'hypertension',
  'high blood pressure': 'hypertension',
  ivf: 'infertility',
  depression: 'depressive',
  'broken': 'fracture',
  'hip fracture': 'fracture of neck of femur',
  hiv: 'human immunodeficiency virus',
  tb: 'tuberculosis',
  appendix: 'appendicitis',
  dengue: 'dengue',
  'kidney stone': 'calculus of kidney',
  cosmetic: 'cosmetic surgery',
  pregnancy: 'pregnancy',
};

export function icdSearch(q: string, limit = 12) {
  const raw = q.trim().toLowerCase();
  if (!raw) return [];
  if (/^[a-z]\d/i.test(raw)) {
    const c = raw.toUpperCase();
    return ICD.filter((x) => x.code.startsWith(c) || x.code.replace('.', '').startsWith(c.replace('.', '')))
      .sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code))
      .slice(0, limit)
      .map(({ code, desc }) => ({ code, desc, why: 'code' }));
  }
  let expanded = raw;
  const used: string[] = [];
  for (const [k, v] of Object.entries(SYNONYMS)) {
    if (new RegExp(`\\b${k}\\b`).test(expanded)) (expanded = expanded.replace(new RegExp(`\\b${k}\\b`), v), used.push(`${k} → ${v}`));
  }
  const toks = expanded.split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  const scored: { x: Icd; s: number }[] = [];
  for (const x of ICD) {
    let s = 0;
    for (const t of toks) {
      if (x.l.includes(t)) s += x.l.match(new RegExp(`\\b${t}`)) ? 3 : 1;
      else {
        s = -1;
        break;
      }
    }
    if (s <= 0) continue;
    const catl = x.cat.toLowerCase();
    if (toks.every((t) => catl.includes(t))) s += 4; // the whole concept is the category (C50 = malignant neoplasm of breast)
    if (x.l.includes('unspecified')) s += 1.5; // front desks usually want the unspecified default
    s -= x.code.length * 0.15; // prefer shorter, more general codes
    scored.push({ x, s });
  }
  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ x }) => ({ code: x.code, desc: x.desc, why: used.join(', ') || 'text' }));
}
export const icdCount = () => ICD.length;

// ---------------- HAPI FHIR public test server ----------------
const HAPI = process.env.HAPI_FHIR_BASE ?? 'https://hapi.fhir.org/baseR4';
export async function hapiSample() {
  const r = await fetch(`${HAPI}/Condition?_count=40&_include=Condition:subject&_sort=-_lastUpdated`, { headers: { accept: 'application/fhir+json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HAPI ${r.status}`);
  const b: any = await r.json();
  const res = (b.entry ?? []).map((e: any) => e.resource);
  const patients = new Map(res.filter((x: any) => x.resourceType === 'Patient').map((p: any) => [`Patient/${p.id}`, p]));
  for (const c of res.filter((x: any) => x.resourceType === 'Condition')) {
    const coding = c.code?.coding?.find((k: any) => k.code && (k.display || c.code?.text));
    const pat: any = patients.get(c.subject?.reference);
    if (!coding || !pat) continue;
    const name = pat.name?.[0]?.text ?? [pat.name?.[0]?.given?.join(' '), pat.name?.[0]?.family].filter(Boolean).join(' ');
    return {
      source: `${HAPI}/Condition/${c.id}`,
      patient: { id: pat.id, name: name || 'Unnamed', gender: pat.gender, birthDate: pat.birthDate },
      condition: { system: coding.system, code: coding.code, display: coding.display ?? c.code.text },
      resources: { condition: c, patient: pat },
    };
  }
  throw new Error('no suitable Condition in latest HAPI page');
}

// ---------------- licensing registries ----------------
// Live mode needs credentials only the team has. Snapshot mode is labelled as such in the attestation.
export async function checkFacility(id: string, name: string) {
  if (process.env.HFR_LOOKUP_URL && process.env.ABDM_ACCESS_TOKEN) {
    const r = await fetch(`${process.env.HFR_LOOKUP_URL}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.ABDM_ACCESS_TOKEN}` },
      body: JSON.stringify({ facilityId: id }),
      signal: AbortSignal.timeout(20000),
    });
    const j: any = await r.json();
    const f = j.facility ?? j;
    const rec: FacilityRecord = {
      facilityId: id,
      facilityName: f.facilityName ?? '',
      ownership: f.ownership ?? '',
      systemOfMedicine: f.systemOfMedicine ?? '',
      facilityType: f.facilityType ?? '',
      state: f.stateName ?? '',
      district: f.districtName ?? '',
      status: f.facilityStatus === 'Active' || f.status === 'ACTIVE' ? 'ACTIVE' : f.facilityId ? 'SUSPENDED' : 'NOT_FOUND',
    };
    return verifyFacility(rec, name, 'abdm-hfr-live');
  }
  return verifyFacility(lookupFacilitySnapshot(id), name, 'hfr-offline-snapshot');
}

export async function checkClinician(reg: string, name: string) {
  if (process.env.NMC_LIVE === '1' && process.env.NMC_DOCTOR_ID) {
    // Public NMC Indian Medical Register endpoint; enabled only when the team opts in.
    const r = await fetch('https://www.nmc.org.in/MCIRest/open/getDataFromService?service=getDoctorDetailsByIdImrExt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doctorId: process.env.NMC_DOCTOR_ID, regdNoValue: reg }),
      signal: AbortSignal.timeout(20000),
    });
    const j: any = await r.json();
    const rec: ClinicianRecord = {
      registrationNo: j.registrationNo ?? reg,
      name: [j.firstName, j.middleName, j.lastName].filter(Boolean).join(' '),
      council: j.smcName ?? '',
      qualification: j.doctorDegree ?? '',
      yearOfRegistration: j.yearInfo ?? '',
      status: j.registrationNo ? 'ACTIVE' : 'NOT_FOUND',
    };
    return verifyClinician(rec, name, 'nmc-imr-live');
  }
  return verifyClinician(lookupClinicianSnapshot(reg), name, 'nmc-offline-snapshot');
}
