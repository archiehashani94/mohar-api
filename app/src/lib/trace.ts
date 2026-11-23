// "Under the hood" — every real operation (crypto, IPFS, chain tx, ZK) reports here as it happens,
// so the UI can show judges exactly what ran, where, and what (if anything) left the device.
export type TraceKind = 'crypto' | 'ipfs' | 'chain' | 'zk' | 'net' | 'id' | 'ok' | 'fail';
export type Where = 'patient' | 'hospital' | 'insurer' | 'doctor' | 'lab' | 'pharmacy' | 'regulator' | 'responder' | 'guardian' | 'relayer' | 'server' | 'chain' | 'device';

export interface TraceEvent {
  id: number;
  t: number;
  kind: TraceKind;
  where: Where;
  title: string;
  detail?: string;
  /** what crossed the device boundary, if anything */
  wire?: string;
  /** 'private' = stays on device · 'public' = visible on-chain / to the server */
  vis?: 'private' | 'public' | 'sealed';
  tx?: string;
  block?: number;
  gas?: number;
}

let n = 0;
let ctx: Where = 'device';
const log: TraceEvent[] = [];
const subs = new Set<(e: TraceEvent[]) => void>();

/** Who is acting right now (set by the session or by the story step). */
export function actingAs(w: Where) {
  ctx = w;
}
export const currentActor = () => ctx;

export function trace(e: Omit<TraceEvent, 'id' | 't' | 'where'> & { where?: Where }) {
  const ev = { id: ++n, t: Date.now(), where: ctx, ...e } as TraceEvent;
  log.push(ev);
  if (log.length > 400) log.shift();
  subs.forEach((f) => f(log.slice()));
  return ev;
}

export function patchTrace(id: number, patch: Partial<TraceEvent>) {
  const e = log.find((x) => x.id === id);
  if (e) Object.assign(e, patch);
  subs.forEach((f) => f(log.slice()));
}

export function clearTrace() {
  log.length = 0;
  subs.forEach((f) => f([]));
}

export function onTrace(f: (e: TraceEvent[]) => void) {
  subs.add(f);
  f(log.slice());
  return () => subs.delete(f);
}

export const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

export const lastTraceId = () => n;
