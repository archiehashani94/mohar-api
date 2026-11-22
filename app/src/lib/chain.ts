import { Contract, JsonRpcProvider, Wallet, NonceManager, Interface } from 'ethers';
import abi from '../abi.json';

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
  | 'responder';

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

export function signerFor(role: Role) {
  if (!signers.has(role)) signers.set(role, new NonceManager(new Wallet(demo.accounts[role].privateKey, provider)));
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
