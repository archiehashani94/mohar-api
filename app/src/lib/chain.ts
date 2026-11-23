import { Contract, JsonRpcProvider, Wallet, NonceManager, Interface } from 'ethers';
import abi from '../abi.json';
import { patchTrace, trace } from './trace';

export type Role =
  | 'regulator'
  | 'insurer'
  | 'patient'
  | 'patient2'
  | 'doctor'
  | 'relayer'
  | 'guardian1'
  | 'guardian2'
  | 'guardian3'
  | 'responder'
  | 'lab'
  | 'pharmacy';

export interface Demo {
  rpc: string;
  deployment: Record<string, any>;
  accounts: Record<Role, { address: string; privateKey: string }>;
  names: Record<Role, string>;
  hospitals: { name: string; hfrId: string; city: string; specialty: string; secret: string; leaf: string }[];
  shadyClinic: { name: string; secret: string };
  policies: Record<string, { json: string; commitment: string }>;
  records: Record<string, { recordId: string; cid: string; kind: string; key: string }[]>;
  seededAt: number;
}

let demo: Demo;
let provider: JsonRpcProvider;
const signers = new Map<Role, NonceManager>();

export async function loadDemo(): Promise<Demo> {
  if (demo) return demo;
  demo = await (await fetch('/demo.json', { cache: 'no-store' })).json();
  provider = new JsonRpcProvider(location.origin + '/rpc', undefined, { staticNetwork: true, pollingInterval: 700, cacheTimeout: -1 } as any);
  return demo;
}

export const getDemo = () => demo;
export const getProvider = () => provider;

const CONTRACT_NAMES: Record<string, string> = {};
const fnIface = () => {
  if (!(fnIface as any).i) {
    const d = demo.deployment;
    const map: [string, string][] = [
      [d.token, 'BINR'],
      [d.regulator, 'Regulator'],
      [d.claimSettlement, 'ClaimSettlement'],
      [d.healthVault, 'HealthVault'],
      [d.breakGlass, 'BreakGlass'],
      [d.patientRegistry, 'PatientRegistry'],
    ];
    for (const [a, n] of map) if (a) CONTRACT_NAMES[a.toLowerCase()] = n;
    (fnIface as any).i = Object.fromEntries(map.map(([, n]) => [n, new Interface((abi as any)[n] ?? [])]));
  }
  return (fnIface as any).i as Record<string, Interface>;
};

/** Decode "Contract.method" for the activity log. */
export function describeCall(to?: string | null, data?: string) {
  if (!to) return 'deploy';
  const ifs = fnIface();
  const name = CONTRACT_NAMES[to.toLowerCase()] ?? 'contract';
  try {
    const f = ifs[name]?.parseTransaction({ data: data ?? '0x' });
    return `${name}.${f?.name ?? '?'}`;
  } catch {
    return name;
  }
}

/** A NonceManager that (1) reports every tx to the activity log and (2) recovers from nonce drift
 *  when the same wallet is used from two tabs (role sign-in makes that common). */
class TracedSigner extends NonceManager {
  constructor(private role: Role, w: Wallet) {
    super(w);
  }
  async sendTransaction(tx: any): Promise<any> {
    const what = describeCall(tx.to, tx.data);
    let sent: any;
    try {
      sent = await super.sendTransaction(tx);
    } catch (e: any) {
      const m = String(e?.message ?? e);
      if (!/nonce|NONCE_EXPIRED|replacement/i.test(m)) {
        trace({ kind: 'fail', title: `${what} reverted`, detail: revertReason(e), where: 'chain' });
        throw e;
      }
      this.reset();
      sent = await super.sendTransaction(tx);
    }
    const ev = trace({ kind: 'chain', title: `tx ${what}`, detail: `from ${demo.names[this.role] ?? this.role}`, tx: sent.hash, vis: 'public' });
    const wait = sent.wait.bind(sent);
    sent.wait = async (...a: any[]) => {
      const rc = await wait(...a);
      patchTrace(ev.id, { block: rc?.blockNumber, gas: Number(rc?.gasUsed ?? 0) });
      return rc;
    };
    return sent;
  }
}

export function signerFor(role: Role) {
  if (!signers.has(role)) signers.set(role, new TracedSigner(role, new Wallet(demo.accounts[role].privateKey, provider)));
  return signers.get(role)!;
}

export const walletFor = (role: Role) => new Wallet(demo.accounts[role].privateKey);

export function c(role?: Role) {
  const runner = role ? signerFor(role) : provider;
  const d = demo.deployment;
  return {
    token: new Contract(d.token, abi.BINR, runner),
    regulator: new Contract(d.regulator, abi.Regulator, runner),
    claims: new Contract(d.claimSettlement, abi.ClaimSettlement, runner),
    vault: new Contract(d.healthVault, abi.HealthVault, runner),
    breakGlass: new Contract(d.breakGlass, abi.BreakGlass, runner),
    patients: new Contract(d.patientRegistry, (abi as any).PatientRegistry, runner),
  };
}

export const roleOf = (addr: string): Role | undefined =>
  (Object.keys(demo.accounts) as Role[]).find((r) => demo.accounts[r].address.toLowerCase() === addr.toLowerCase());

export const nameOf = (addr: string) => {
  const r = roleOf(addr);
  return r ? demo.names[r] : short(addr);
};

export const short = (h: string, n = 6) => (h && h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

export async function events(contractName: keyof ReturnType<typeof c>, eventName: string, ...args: any[]) {
  const ct = c()[contractName];
  const filter = (ct.filters as any)[eventName](...args);
  const logs = await ct.queryFilter(filter, demo.deployment.startBlock ?? 0);
  return logs as any[];
}

export async function blockTime(n?: number) {
  const b = await provider.getBlock(n ?? 'latest');
  return b!.timestamp;
}

const errFrags = Object.values(abi).flat().filter((x: any) => x.type === 'error');
const allErrors = new Interface([...new Map(errFrags.map((x: any) => [x.name + JSON.stringify(x.inputs), x])).values()] as any);
export function revertReason(e: any): string {
  if (e?.revert?.name) return e.revert.name;
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof data === 'string' && data.length >= 10) {
    try {
      return allErrors.parseError(data)!.name;
    } catch {}
  }
  return e?.reason ?? e?.shortMessage ?? e?.message ?? String(e);
}
