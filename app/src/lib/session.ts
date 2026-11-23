// Role-based sign-in. Each browser TAB holds one identity (sessionStorage), so a presenter can open
// Patient, Hospital and Insurer side by side. `?as=<identity>` in the URL signs a tab in directly
// (used by the "open on phone" QR codes).
import { useEffect, useState } from 'react';
import { Wallet, verifyMessage } from 'ethers';
import { getDemo, Role } from './chain';
import { actingAs, trace, Where } from './trace';

export type Kind = 'patient' | 'hospital' | 'insurer' | 'doctor' | 'lab' | 'pharmacy' | 'regulator' | 'responder' | 'guardian';

export interface Identity {
  id: string; // e.g. patient, patient2, hospital-1, guardian2
  kind: Kind;
  role?: Role; // wallet role (hospitals have none — they never touch the chain)
  hospitalIdx?: number;
  name: string;
  sub: string;
  page: string;
}

export const KIND_META: Record<Kind, { label: string; color: string; blurb: string }> = {
  patient: { label: 'Patient', color: '#5b3fd6', blurb: 'Owns the records and the policy. Approves claims, shares and revokes access.' },
  hospital: { label: 'Hospital', color: '#0f7c86', blurb: 'Writes the encounter, gets consent, proves the claim in zero knowledge.' },
  insurer: { label: 'Insurer', color: '#16181d', blurb: 'Issues policies as commitments. Sees an amount and a proof — never the diagnosis.' },
  doctor: { label: 'Doctor', color: '#1f8a4c', blurb: 'NMC-verified clinician. Sees only what a patient shares, while the grant lasts.' },
  lab: { label: 'Lab', color: '#2f6fb7', blurb: 'Receives only the lab-order slice of a record (FHIR Observation / ServiceRequest).' },
  pharmacy: { label: 'Pharmacy', color: '#a2489b', blurb: 'Receives only the prescription slice (FHIR MedicationRequest).' },
  regulator: { label: 'Regulator', color: '#b7791f', blurb: 'Licenses hospitals (HFR-attested Merkle root), insurers and clinicians.' },
  responder: { label: 'Paramedic', color: '#d8432b', blurb: 'Scans a patient’s emergency QR and asks guardians for break-glass access.' },
  guardian: { label: 'Guardian', color: '#7a5c2e', blurb: 'Holds 1 of 3 Shamir shares of a patient’s emergency key.' },
};

export function identities(): Identity[] {
  const d = getDemo();
  const out: Identity[] = [
    { id: 'patient', kind: 'patient', role: 'patient', name: d.names.patient, sub: policyName('asha'), page: 'vault' },
    { id: 'patient2', kind: 'patient', role: 'patient2', name: d.names.patient2, sub: policyName('rahul'), page: 'vault' },
  ];
  d.hospitals.forEach((h, i) => out.push({ id: `hospital-${i}`, kind: 'hospital', hospitalIdx: i, name: h.name, sub: `${h.specialty} · HFR ${h.hfrId}`, page: 'seal' }));
  out.push({ id: 'insurer', kind: 'insurer', role: 'insurer', name: d.names.insurer, sub: 'IRDAI/HLT/2026/147', page: 'desk' });
  out.push({ id: 'doctor', kind: 'doctor', role: 'doctor', name: d.names.doctor, sub: 'NMC CGMC/2011/4471', page: 'provider' });
  if (d.accounts.lab) out.push({ id: 'lab', kind: 'lab', role: 'lab', name: d.names.lab, sub: 'NABL-accredited lab', page: 'provider' });
  if (d.accounts.pharmacy) out.push({ id: 'pharmacy', kind: 'pharmacy', role: 'pharmacy', name: d.names.pharmacy, sub: 'Licensed pharmacy', page: 'provider' });
  out.push({ id: 'regulator', kind: 'regulator', role: 'regulator', name: d.names.regulator, sub: 'Hospital & insurer registry', page: 'regulator' });
  out.push({ id: 'responder', kind: 'responder', role: 'responder', name: d.names.responder, sub: 'Emergency responder', page: 'responder' });
  (['guardian1', 'guardian2', 'guardian3'] as Role[]).forEach((g) => out.push({ id: g, kind: 'guardian', role: g, name: d.names[g], sub: 'Guardian of Asha Verma', page: 'guardian' }));
  return out;
}

function policyName(k: string) {
  try {
    return JSON.parse(getDemo().policies[k].json).planName;
  } catch {
    return '';
  }
}

const KEY = 'kavach.session.v1';
let current: Identity | null = null;
const subs = new Set<() => void>();

export function initSession() {
  const q = new URLSearchParams(location.search).get('as');
  const id = q ?? safe(() => sessionStorage.getItem(KEY));
  const found = id ? identities().find((x) => x.id === id) : undefined;
  if (found) setIdentity(found, !!q);
  if (q) history.replaceState(null, '', location.pathname + location.hash);
}

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

export function setIdentity(i: Identity | null, viaQr = false) {
  current = i;
  safe(() => (i ? sessionStorage.setItem(KEY, i.id) : sessionStorage.removeItem(KEY)));
  actingAs(i ? (i.kind as Where) : 'device');
  if (i && viaQr) trace({ kind: 'id', title: `Signed in as ${i.name}`, detail: 'opened from a QR code' });
  subs.forEach((f) => f());
}

export const getIdentity = () => current;

export function useIdentity() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return current;
}

/** Sign-in = the role's wallet signs a fresh challenge (SIWE-style). Hospitals sign with their HFR-registered staff key. */
export async function signIn(i: Identity) {
  const d = getDemo();
  const nonce = Math.random().toString(36).slice(2, 10);
  const msg = `Mohar sign-in\nIdentity: ${i.name}\nNonce: ${nonce}\nIssued: ${new Date().toISOString()}`;
  let addr = '';
  let sig = '';
  if (i.role) {
    const w = new Wallet(d.accounts[i.role].privateKey);
    sig = await w.signMessage(msg);
    addr = verifyMessage(msg, sig);
  } else {
    // a hospital has no on-chain wallet; its staff key is derived from its secret and never touches the chain
    const { keccak256, toUtf8Bytes } = await import('ethers');
    const w = new Wallet(keccak256(toUtf8Bytes('staff:' + d.hospitals[i.hospitalIdx!].secret)));
    sig = await w.signMessage(msg);
    addr = verifyMessage(msg, sig);
  }
  setIdentity(i);
  trace({ kind: 'id', title: `Signed in as ${i.name}`, detail: `challenge signed by ${addr.slice(0, 10)}… · ${sig.slice(0, 18)}…`, vis: 'private' });
  return { addr, sig };
}
