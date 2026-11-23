// Scans every tx + event of every Mohar contract for each private value of a claim.
import { AbiCoder, hexlify, toUtf8Bytes } from 'ethers';
import { codeToField, formatINR, splitPubKey, toHex32 } from '@kavach/sdk';
import { getDemo, getProvider } from './chain';
import { policyFor } from './flow';

export type Secret = { label: string; value: string; needles: string[]; scope: 'claim' | 'all'; note?: string };
export type ScanRow = Secret & { hits: number };

const strip = (h: string) => h.toLowerCase().replace(/^0x/, '');
const ascii = (s: string) => strip(hexlify(toUtf8Bytes(s)));
const u256 = (n: number | bigint) => strip(AbiCoder.defaultAbiCoder().encode(['uint256'], [n]));

export function secretsFor(cl: any): Secret[] {
  const d = getDemo();
  const h = d.hospitals[cl.hospitalIdx];
  const pol = policyFor(cl.patient);
  const patient = d.accounts[cl.patient as 'patient'].address;
  const { x } = splitPubKey(pol.patientPubKey);
  const total = cl.bill.reduce((a: number, b: any) => a + b.amount, 0);
  return [
    { label: 'Diagnosis code', value: `${cl.diagnosis.code} · ${cl.diagnosis.display}`, needles: [ascii(cl.diagnosis.code), strip(toHex32(codeToField(cl.diagnosis.code)))], scope: 'all' },
    { label: 'Diagnosis text', value: cl.diagnosis.display, needles: [ascii(cl.diagnosis.display)], scope: 'all' },
    { label: 'Procedure', value: `${cl.procedure.code} · ${cl.procedure.display}`, needles: [ascii(cl.procedure.code), strip(toHex32(codeToField(cl.procedure.code)))], scope: 'all' },
    { label: 'Hospital name', value: h.name, needles: [ascii(h.name)], scope: 'claim' },
    { label: 'Hospital HFR id', value: h.hfrId, needles: [ascii(h.hfrId)], scope: 'claim' },
    { label: 'Hospital registry leaf', value: h.leaf, needles: [strip(h.leaf)], scope: 'claim' },
    { label: 'Hospital secret', value: h.secret, needles: [strip(h.secret)], scope: 'all' },
    { label: 'Patient wallet', value: patient, needles: [strip(patient)], scope: 'claim' },
    { label: 'Patient consent key', value: hexlify(x), needles: [strip(hexlify(x))], scope: 'all', note: 'Per-policy key derived from a wallet signature, never registered anywhere.' },
    { label: 'Policy salt', value: toHex32(pol.salt), needles: [strip(toHex32(pol.salt))], scope: 'all' },
    { label: 'Sum insured', value: formatINR(pol.sumInsured), needles: [u256(pol.sumInsured)], scope: 'claim' },
    { label: 'Record hash', value: toHex32(BigInt(cl.recordHash)), needles: [strip(toHex32(BigInt(cl.recordHash)))], scope: 'all' },
    { label: 'Bill total', value: formatINR(total), needles: [u256(total)], scope: 'claim' },
  ];
}

export async function scanChain(cl: any, onRow?: (r: ScanRow, i: number) => void) {
  const p = getProvider();
  const dep = getDemo().deployment;
  const addrs = [dep.claimSettlement, dep.healthVault, dep.breakGlass, dep.regulator, dep.token, dep.patientRegistry].filter(Boolean);
  const logs = await p.getLogs({ fromBlock: dep.startBlock ?? 0, toBlock: 'latest', address: addrs });
  const hashes = [...new Set(logs.map((l) => l.transactionHash))];
  const txs = await Promise.all(hashes.map((h) => p.getTransaction(h)));
  const all = (txs.map((t) => strip(t!.data)).join('|') + '|' + logs.map((l) => strip(l.data) + l.topics.map(strip).join('')).join('|')).toLowerCase();
  const tx = await p.getTransaction(cl.result.txHash);
  const rc = await p.getTransactionReceipt(cl.result.txHash);
  const claim = (strip(tx!.data) + '|' + strip(tx!.from) + '|' + rc!.logs.map((l) => strip(l.data) + l.topics.map(strip).join('')).join('|')).toLowerCase();
  const rows: ScanRow[] = [];
  const secrets = secretsFor(cl);
  for (let i = 0; i < secrets.length; i++) {
    const s = secrets[i];
    const hay = s.scope === 'all' ? all : claim;
    const row = { ...s, hits: s.needles.filter((n) => n.length >= 6 && hay.includes(n)).length };
    rows.push(row);
    onRow?.(row, i);
  }
  return { rows, txCount: txs.length, logCount: logs.length, kb: all.length / 2 / 1024, sender: tx!.from };
}
