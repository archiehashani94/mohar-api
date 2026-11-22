// Licensing checks before anything goes on-chain:
//   hospitals → ABDM Health Facility Registry (HFR)       clinicians → NMC Indian Medical Register (IMR)
// Live lookups need credentials the team must supply (ABDM sandbox client, NMC access). Without them we use a
// bundled OFFLINE SNAPSHOT and say so: the on-chain attestation records which source was used.
import { keccak256, toUtf8Bytes } from 'ethers';

export interface FacilityRecord {
  facilityId: string;
  facilityName: string;
  ownership: string;
  systemOfMedicine: string;
  facilityType: string;
  state: string;
  district: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'NOT_FOUND';
}

export interface ClinicianRecord {
  registrationNo: string;
  name: string;
  council: string;
  qualification: string;
  yearOfRegistration: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'NOT_FOUND';
}

/** Demo snapshot (synthetic facility & doctor ids in ABDM/NMC formats — NOT real registry data). */
export const HFR_SNAPSHOT: FacilityRecord[] = [
  { facilityId: 'IN2210000101', facilityName: 'AIIMS Raipur', ownership: 'Public', systemOfMedicine: 'Modern Medicine', facilityType: 'Hospital', state: 'Chhattisgarh', district: 'Raipur', status: 'ACTIVE' },
  { facilityId: 'IN2210000202', facilityName: 'Balco Medical Centre', ownership: 'Private', systemOfMedicine: 'Modern Medicine', facilityType: 'Hospital', state: 'Chhattisgarh', district: 'Raipur', status: 'ACTIVE' },
  { facilityId: 'IN2210000303', facilityName: 'Ramkrishna Care Hospital', ownership: 'Private', systemOfMedicine: 'Modern Medicine', facilityType: 'Hospital', state: 'Chhattisgarh', district: 'Raipur', status: 'ACTIVE' },
  { facilityId: 'IN2210000404', facilityName: 'Sunrise IVF Clinic', ownership: 'Private', systemOfMedicine: 'Modern Medicine', facilityType: 'Clinic', state: 'Chhattisgarh', district: 'Bilaspur', status: 'ACTIVE' },
  { facilityId: 'IN2210000505', facilityName: 'Lakeview Nursing Home', ownership: 'Private', systemOfMedicine: 'Modern Medicine', facilityType: 'Nursing Home', state: 'Chhattisgarh', district: 'Durg', status: 'ACTIVE' },
];

export const NMC_SNAPSHOT: ClinicianRecord[] = [
  { registrationNo: 'CGMC/2011/4471', name: 'Dr. Meera Iyer', council: 'Chhattisgarh Medical Council', qualification: 'MD (General Medicine)', yearOfRegistration: '2011', status: 'ACTIVE' },
  { registrationNo: 'CGMC/2016/7720', name: 'Dr. Kavita Rao', council: 'Chhattisgarh Medical Council', qualification: 'MBBS', yearOfRegistration: '2016', status: 'ACTIVE' },
];

/** Stable, key-sorted JSON → keccak256: the attestation stored on-chain. */
export function attestationHash(record: object): string {
  const stable = (v: any): string =>
    v === null || typeof v !== 'object'
      ? JSON.stringify(v)
      : Array.isArray(v)
        ? `[${v.map(stable).join(',')}]`
        : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return keccak256(toUtf8Bytes(stable(record)));
}

/** ABDM HFR ids are "IN" + 10 digits (state code + serial). */
export const isHfrIdFormat = (id: string) => /^IN\d{10}$/.test(id);

export function lookupFacilitySnapshot(id: string): FacilityRecord {
  return HFR_SNAPSHOT.find((f) => f.facilityId === id) ?? { facilityId: id, facilityName: '', ownership: '', systemOfMedicine: '', facilityType: '', state: '', district: '', status: 'NOT_FOUND' };
}

export function lookupClinicianSnapshot(reg: string): ClinicianRecord {
  return NMC_SNAPSHOT.find((c) => c.registrationNo === reg) ?? { registrationNo: reg, name: '', council: '', qualification: '', yearOfRegistration: '', status: 'NOT_FOUND' };
}

export interface VerificationResult<T> {
  ok: boolean;
  source: string;
  record: T;
  attestation: string;
  checks: { label: string; ok: boolean }[];
}

export function verifyFacility(record: FacilityRecord, claimedName: string, source: string): VerificationResult<FacilityRecord> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const checks = [
    { label: 'HFR id format (IN + 10 digits)', ok: isHfrIdFormat(record.facilityId) },
    { label: 'Facility found in registry', ok: record.status !== 'NOT_FOUND' },
    { label: 'Registry status ACTIVE', ok: record.status === 'ACTIVE' },
    { label: 'Name matches application', ok: norm(record.facilityName) === norm(claimedName) },
    { label: 'System of medicine: Modern Medicine', ok: record.systemOfMedicine === 'Modern Medicine' },
  ];
  return { ok: checks.every((c) => c.ok), source, record, attestation: attestationHash({ source, record }), checks };
}

export function verifyClinician(record: ClinicianRecord, claimedName: string, source: string): VerificationResult<ClinicianRecord> {
  const norm = (s: string) => s.toLowerCase().replace(/^dr\.?\s*/, '').replace(/[^a-z]/g, '');
  const checks = [
    { label: 'Found in Indian Medical Register', ok: record.status !== 'NOT_FOUND' },
    { label: 'Registration ACTIVE', ok: record.status === 'ACTIVE' },
    { label: 'Name matches', ok: norm(record.name) === norm(claimedName) },
  ];
  return { ok: checks.every((c) => c.ok), source, record, attestation: attestationHash({ source, record }), checks };
}
