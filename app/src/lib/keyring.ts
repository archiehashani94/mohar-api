// Per-device key ring (localStorage). In production these live in each party's own wallet/HSM.
import type { Role } from './chain';

const K = 'kavach.keyring.v1';
type Ring = {
  recordKeys: Record<string, string>; // recordId -> hex AES key (patient-owned)
  claims: any[]; // hospital-side claim history (private: holds diagnosis etc. — never leaves the device)
  policies: Record<string, string>; // patient -> policy JSON issued to them
  emergency: Record<string, any>;
};

function load(): Ring {
  try {
    return { recordKeys: {}, claims: [], policies: {}, emergency: {}, ...JSON.parse(localStorage.getItem(K) ?? '{}') };
  } catch {
    return { recordKeys: {}, claims: [], policies: {}, emergency: {} };
  }
}

export const ring = {
  get: load,
  update(fn: (r: Ring) => void) {
    const r = load();
    fn(r);
    try {
      localStorage.setItem(K, JSON.stringify(r));
    } catch {}
    window.dispatchEvent(new Event('keyring'));
  },
  reset() {
    try {
      localStorage.removeItem(K);
    } catch {}
  },
};

export type { Role };
