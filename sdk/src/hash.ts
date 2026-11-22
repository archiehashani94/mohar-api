// Poseidon2 over BN254, byte-compatible with noir-lang/poseidon v0.4.0 (verified: H(1,2) = 0x0386…7383).
import { Barretenberg } from '@aztec/bb.js';

export const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Domain separators — MUST match circuits/claim/src/main.nr
export const DOM = {
  HOSPITAL: 0xb1f00001n,
  POLICY: 0xb1f00002n,
  NULLIFIER: 0xb1f00003n,
  CONSENT: 0xb1f00004n,
  PATIENT: 0xb1f00005n,
  PROCEDURE: 0xb1f00006n,
  EXCLUSIONS: 0xb1f00007n,
  NODE: 0xb1f00008n,
} as const;

let api: Barretenberg | null = null;
let apiPromise: Promise<Barretenberg> | null = null;

export async function getBarretenberg(): Promise<Barretenberg> {
  if (api) return api;
  // Browser: use all cores when the page is cross-origin isolated (SharedArrayBuffer available).
  const g: any = globalThis;
  const threads = g.window ? (g.crossOriginIsolated ? Math.min(g.navigator?.hardwareConcurrency ?? 4, 8) : 1) : Math.min(8, Number(g.process?.env?.BB_THREADS ?? 4));
  if (!apiPromise)
    apiPromise = Barretenberg.new({ threads })
      .then((b) => (api = b))
      .catch((e) => {
        apiPromise = null; // don't cache a failed init (e.g. a network blip while fetching the CRS)
        throw e;
      });
  return apiPromise;
}

export function toBytes32(x: bigint): Uint8Array {
  const b = new Uint8Array(32);
  let v = ((x % FIELD_MODULUS) + FIELD_MODULUS) % FIELD_MODULUS;
  for (let i = 31; i >= 0; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

export function fromBytes(b: Uint8Array): bigint {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}

export const toHex32 = (x: bigint) => '0x' + x.toString(16).padStart(64, '0');

export async function poseidon2(inputs: bigint[]): Promise<bigint> {
  const bb = await getBarretenberg();
  const r = await bb.poseidon2Hash({ inputs: inputs.map(toBytes32) });
  return fromBytes(r.hash);
}

/** Encode a short ASCII code (ICD-10 "C50.9", procedure "PROC-0412", HFR id) as a field. */
export function codeToField(code: string): bigint {
  if (!code) return 0n;
  const bytes = new TextEncoder().encode(code.trim().toUpperCase());
  if (bytes.length > 31) throw new Error(`code too long: ${code}`);
  return fromBytes(bytes);
}

export function fieldToCode(f: bigint): string {
  if (f === 0n) return '';
  const hex = f.toString(16);
  const bytes = (hex.length % 2 ? '0' + hex : hex).match(/../g)!.map((h) => parseInt(h, 16));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function randomField(): bigint {
  const b = new Uint8Array(31);
  globalThis.crypto.getRandomValues(b);
  return fromBytes(b);
}
