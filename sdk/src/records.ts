// Patient-controlled health records:
//   - FHIR R4 Bundle, AES-256-GCM encrypted client-side
//   - content-addressed (IPFS CIDv1, sha2-256) — only the hash goes on-chain
//   - record key wrapped per grantee with ECIES (secp256k1 ECDH + HKDF + AES-GCM)
//   - emergency key split 2-of-3 with Shamir secret sharing for break-glass guardians
import { SigningKey, Wallet, getBytes, hexlify, keccak256, sha256 } from 'ethers';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 as mfSha256 } from 'multiformats/hashes/sha2';
import { FIELD_MODULUS } from './hash.js';

const subtle = () => globalThis.crypto.subtle;
const rnd = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const te = new TextEncoder();
const td = new TextDecoder();

// ---------------- symmetric ----------------
export interface Sealed {
  iv: string;
  ct: string;
}

export async function newRecordKey(): Promise<Uint8Array> {
  return rnd(32);
}

async function aesKey(raw: Uint8Array) {
  return subtle().importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(key: Uint8Array, data: Uint8Array): Promise<Sealed> {
  const iv = rnd(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await aesKey(key), data as BufferSource));
  return { iv: hexlify(iv), ct: hexlify(ct) };
}

export async function open(key: Uint8Array, s: Sealed): Promise<Uint8Array> {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: getBytes(s.iv) as BufferSource }, await aesKey(key), getBytes(s.ct) as BufferSource);
  return new Uint8Array(pt);
}

export const sealJSON = async (key: Uint8Array, obj: unknown) => seal(key, te.encode(JSON.stringify(obj)));
export const openJSON = async <T = any>(key: Uint8Array, s: Sealed): Promise<T> => JSON.parse(td.decode(await open(key, s)));

// ---------------- ECIES key wrapping ----------------
export interface WrappedKey {
  eph: string; // ephemeral compressed pubkey
  iv: string;
  ct: string;
}

async function kdf(shared: string): Promise<Uint8Array> {
  return getBytes(sha256(getBytes(shared))); // shared secret -> 32-byte AES key
}

export async function wrapKey(recordKey: Uint8Array, recipientPubKey: string): Promise<WrappedKey> {
  const eph = Wallet.createRandom();
  const shared = eph.signingKey.computeSharedSecret(recipientPubKey);
  const s = await seal(await kdf(shared), recordKey);
  return { eph: eph.signingKey.compressedPublicKey, ...s };
}

export async function unwrapKey(w: WrappedKey, recipientPrivKey: string): Promise<Uint8Array> {
  const shared = new SigningKey(recipientPrivKey).computeSharedSecret(w.eph);
  return open(await kdf(shared), w);
}

// ---------------- content addressing ----------------
export async function cidOf(bytes: Uint8Array): Promise<string> {
  const h = await mfSha256.digest(bytes);
  return CID.create(1, raw.code, h).toString();
}

export const sealedBytes = (s: Sealed) => te.encode(JSON.stringify(s));

/**
 * Field-sized record id bound into claims (inside the nullifier). Keyed with the record's AES key so it can
 * NOT be linked to the public content hash in HealthVault — only the patient and the hospital can compute it.
 * (Found by our own leak scanner: an unkeyed keccak(ciphertext) equalled the on-chain contentHash ~19% of the
 * time, letting the insurer — who knows the policy salt — link a claim to a vault record and wallet.)
 */
export function recordHashField(bytes: Uint8Array, recordKey: Uint8Array): bigint {
  const tag = new TextEncoder().encode('kavach/claim-record/v1');
  const buf = new Uint8Array(tag.length + recordKey.length + bytes.length);
  buf.set(tag, 0);
  buf.set(recordKey, tag.length);
  buf.set(bytes, tag.length + recordKey.length);
  return BigInt(keccak256(buf)) % FIELD_MODULUS;
}

// ---------------- Shamir 2-of-3 over GF(256) ----------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x ^= x << 1; // multiply by generator 3
    if (x & 0x100) x ^= 0x11b;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const gdiv = (a: number, b: number) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);

export interface Share {
  x: number;
  y: string;
}

export function splitSecret(secret: Uint8Array, n = 3, k = 2): Share[] {
  const coeffs = Array.from({ length: secret.length }, (_, i) => [secret[i], ...rnd(k - 1)]);
  return Array.from({ length: n }, (_, j) => {
    const x = j + 1;
    const y = coeffs.map((c) => {
      let acc = 0;
      for (let d = c.length - 1; d >= 0; d--) acc = gmul(acc, x) ^ c[d];
      return acc;
    });
    return { x, y: hexlify(Uint8Array.from(y)) };
  });
}

export function combineShares(shares: Share[]): Uint8Array {
  const ys = shares.map((s) => getBytes(s.y));
  const len = ys[0].length;
  const out = new Uint8Array(len);
  for (let b = 0; b < len; b++) {
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
      let num = 1;
      let den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        num = gmul(num, shares[j].x);
        den = gmul(den, shares[i].x ^ shares[j].x);
      }
      acc ^= gmul(ys[i][b], gdiv(num, den));
    }
    out[b] = acc;
  }
  return out;
}
