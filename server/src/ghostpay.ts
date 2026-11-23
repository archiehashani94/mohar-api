// Ghost Pay — the payout leg. Problem: a ZK proof can hide which hospital claimed, but if the contract then
// pays the hospital's PUBLIC wallet, an oncology / IVF / HIV clinic's name leaks the diagnosis anyway.
//
// Rail A "stealth" (default, trustless): the proof binds a one-time EVM address derived from
//   keccak(hospitalSecret, nullifier). Only the hospital can link it to itself or spend from it.
// Rail B "zcash" (shielded): the proof binds the Ghost Pay bridge address; the hospital gives the bridge its
//   Zcash unified address out-of-band (sealed in the relay request). When the contract pays the bridge, the
//   bridge sends ZEC to that address from the Sapling/Orchard shielded pool with the nullifier as encrypted
//   memo. On-chain observers see "bridge received X" and a shielded Zcash tx with no visible recipient.
//   Trade-off (stated in the threat model): the bridge is custodial for the moment of conversion.
//
// The bridge drives a real Zcash light wallet (zingo-cli) on testnet when ZINGO_CLI is configured.
// Without it, Zcash payouts are queued as "awaiting-zcash-wallet" — never faked as paid.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { JsonRpcProvider } from 'ethers';

const run = promisify(execFile);

export type ZPayout = {
  nullifier: string;
  ua: string;
  inr: number; // paise
  zatoshi: number;
  status: 'queued' | 'awaiting-zcash-wallet' | 'sent' | 'failed';
  txid?: string;
  error?: string;
  settledTx?: string;
};

const instructions = new Map<string, string>(); // nullifier -> unified address
const payouts: ZPayout[] = [];
// Demo FX: 1 ZEC ≈ ₹4,000 → 1 paise = 25 zatoshi (configurable)
const ZAT_PER_PAISE = Number(process.env.ZAT_PER_PAISE ?? 25);

const cli = process.env.ZINGO_CLI ?? fileURLToPath(new URL('../../.zcash-tools/bin/zingo-cli', import.meta.url));
const server = process.env.ZCASH_LIGHTWALLETD ?? 'https://testnet.zec.rocks:443';
const walletDir = process.env.ZCASH_WALLET_DIR ?? fileURLToPath(new URL('../data/zcash-wallet', import.meta.url));

export const zcashReady = () => existsSync(cli);

async function zingo(...args: string[]) {
  const { stdout } = await run(cli, ['--chain', 'testnet', '--server', server, '--data-dir', walletDir, ...args], { timeout: 180_000 });
  return stdout;
}

export function registerZcashInstruction(nullifier: string, ua: string) {
  if (!/^(utest1|ztestsapling1|tm)[a-z0-9]+$/i.test(ua)) throw new Error('not a Zcash testnet address');
  instructions.set(nullifier.toLowerCase(), ua);
}

export function ghostPayStatus() {
  return { rails: { stealth: true, zcash: zcashReady() }, lightwalletd: server, payouts };
}

export async function zcashAddress(): Promise<string | null> {
  if (!zcashReady()) return null;
  try {
    const out = await zingo('addresses');
    return out.match(/utest1[a-z0-9]+/)?.[0] ?? null;
  } catch {
    return null;
  }
}

async function send(p: ZPayout) {
  if (!zcashReady()) {
    p.status = 'awaiting-zcash-wallet';
    return;
  }
  try {
    const memo = 'kavach:' + p.nullifier.slice(2, 18);
    const out = await zingo('quicksend', p.ua, String(p.zatoshi), memo);
    p.txid = out.match(/[0-9a-f]{64}/)?.[0];
    p.status = p.txid ? 'sent' : 'failed';
    if (!p.txid) p.error = out.slice(0, 300);
  } catch (e: any) {
    p.status = 'failed';
    p.error = String(e?.stderr ?? e?.message ?? e).slice(0, 300);
  }
}

/** Watches ClaimSettled; payouts addressed to the bridge (relayer) are forwarded to Zcash. */
export async function startGhostPay(provider: JsonRpcProvider, c: { claims: any; token: any }) {
  const bridge = (await (c.claims.runner as any).getAddress()).toLowerCase();
  c.claims.on('ClaimSettled', async (nullifier: string, _pc: string, _ins: string, payout: bigint, recipient: string, _d: bigint, ev: any) => {
    if (recipient.toLowerCase() !== bridge) return;
    const ua = instructions.get(nullifier.toLowerCase());
    if (!ua) return;
    const p: ZPayout = {
      nullifier,
      ua,
      inr: Number(payout),
      zatoshi: Number(payout) * ZAT_PER_PAISE,
      status: 'queued',
      settledTx: ev?.log?.transactionHash,
    };
    payouts.push(p);
    await send(p);
  });
}

export const bridgeInfo = async (c: { claims: any }) => ({
  bridgeAddress: await (c.claims.runner as any).getAddress(),
  zcashReady: zcashReady(),
  zatPerPaise: ZAT_PER_PAISE,
});
