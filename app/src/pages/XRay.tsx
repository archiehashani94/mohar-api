import { useState } from 'react';
import { hexlify, toUtf8Bytes, AbiCoder } from 'ethers';
import { codeToField, formatINR, hospitalLeaf, toHex32, splitPubKey } from '@kavach/sdk';
import { PageHeader } from '../App';
import { Card, Chip, Empty, Hex, Spinner } from '../components/ui';
import { c, getDemo, getProvider } from '../lib/chain';
import { ring } from '../lib/keyring';
import { policyFor } from '../lib/flow';

type Secret = { label: string; value: string; needles: string[]; scope: 'claim' | 'all'; note?: string };

const strip = (h: string) => h.toLowerCase().replace(/^0x/, '');
const ascii = (s: string) => strip(hexlify(toUtf8Bytes(s)));
const u256 = (n: number | bigint) => strip(AbiCoder.defaultAbiCoder().encode(['uint256'], [n]));

async function secretsFor(cl: any): Promise<Secret[]> {
  const d = getDemo();
  const h = d.hospitals[cl.hospitalIdx];
  const pol = policyFor(cl.patient);
  const patient = d.accounts[cl.patient].address;
  const { x } = splitPubKey(pol.patientPubKey);
  return [
    { label: 'Diagnosis code', value: `${cl.diagnosis.code} · ${cl.diagnosis.display}`, needles: [ascii(cl.diagnosis.code), strip(toHex32(codeToField(cl.diagnosis.code)))], scope: 'all' },
    { label: 'Diagnosis text', value: cl.diagnosis.display, needles: [ascii(cl.diagnosis.display)], scope: 'all' },
    { label: 'Procedure code', value: `${cl.procedure.code} · ${cl.procedure.display}`, needles: [ascii(cl.procedure.code), strip(toHex32(codeToField(cl.procedure.code)))], scope: 'all' },
    { label: 'Hospital name', value: h.name, needles: [ascii(h.name)], scope: 'claim' },
    { label: 'Hospital HFR id', value: h.hfrId, needles: [ascii(h.hfrId)], scope: 'claim' },
    { label: 'Hospital registry leaf', value: h.leaf, needles: [strip(h.leaf)], scope: 'claim' },
    { label: 'Hospital secret', value: h.secret, needles: [strip(h.secret)], scope: 'all' },
    { label: 'Patient wallet', value: patient, needles: [strip(patient)], scope: 'claim' },
    { label: 'Patient consent key', value: hexlify(x), needles: [strip(hexlify(x))], scope: 'all', note: 'Per-policy key derived from a wallet signature. Never registered anywhere.' },
    { label: 'Policy salt', value: toHex32(pol.salt), needles: [strip(toHex32(pol.salt))], scope: 'all' },
    { label: 'Policy id', value: toHex32(pol.policyId), needles: [strip(toHex32(pol.policyId))], scope: 'all' },
    { label: 'Sum insured', value: formatINR(pol.sumInsured), needles: [u256(pol.sumInsured)], scope: 'claim' },
    { label: 'Record hash (in nullifier)', value: toHex32(BigInt(cl.recordHash)), needles: [strip(toHex32(BigInt(cl.recordHash)))], scope: 'all' },
    { label: 'Bill total', value: formatINR(cl.bill.reduce((a: number, b: any) => a + b.amount, 0)), needles: [u256(cl.bill.reduce((a: number, b: any) => a + b.amount, 0))], scope: 'claim' },
  ];
}

export function XRay() {
  const d = getDemo();
  const claims = ring.get().claims.filter((x) => x.status === 'settled').reverse();
  const [sel, setSel] = useState(0);
  const cl = claims[sel];
  const [scan, setScan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<any>(null);

  async function load() {
    if (!cl) return;
    const t = await getProvider().getTransaction(cl.result.txHash);
    setTx(t);
  }

  async function runScan() {
    setBusy(true);
    const p = getProvider();
    const dep = d.deployment;
    const logs = await p.getLogs({ fromBlock: dep.startBlock ?? 0, toBlock: 'latest', address: [dep.claimSettlement, dep.healthVault, dep.breakGlass, dep.regulator, dep.token] });
    const hashes = [...new Set(logs.map((l) => l.transactionHash))];
    const txs = await Promise.all(hashes.map((h) => p.getTransaction(h)));
    const allBlob = (txs.map((t) => strip(t!.data)).join('|') + '|' + logs.map((l) => strip(l.data) + l.topics.map(strip).join('')).join('|')).toLowerCase();
    const claimTx = await p.getTransaction(cl.result.txHash);
    const claimRc = await p.getTransactionReceipt(cl.result.txHash);
    const claimBlob = (strip(claimTx!.data) + '|' + strip(claimTx!.from) + '|' + claimRc!.logs.map((l) => strip(l.data) + l.topics.map(strip).join('')).join('|')).toLowerCase();
    const secrets = await secretsFor(cl);
    const rows = secrets.map((s) => {
      const blob = s.scope === 'all' ? allBlob : claimBlob;
      const hits = s.needles.filter((n) => n.length >= 6 && blob.includes(n)).length;
      return { ...s, hits };
    });
    setScan({ rows, txCount: txs.length, logCount: logs.length, bytes: allBlob.length / 2 });
    setBusy(false);
  }

  if (!cl)
    return (
      <div className="space-y-6">
        <PageHeader icon="" title="X-Ray" sub="Side by side: what the hospital knows vs what the chain learned." />
        <Empty>Settle a claim from  Seal first.</Empty>
      </div>
    );

  const h = d.hospitals[cl.hospitalIdx];
  const pub = cl.pub;
  return (
    <div className="space-y-6">
      <PageHeader
        icon=""
        title="X-Ray"
        sub="The threat model, live: left is what sits on the hospital's machine, right is everything the chain — and therefore the insurer and the whole world — can read."
        right={
          <select className="input w-auto" value={sel} onChange={(e) => (setSel(+e.target.value), setScan(null), setTx(null))}>
            {claims.map((x, i) => (
              <option key={x.id} value={i}>
                {x.procedure.display} · {x.hospital}
              </option>
            ))}
          </select>
        }
      />
      <div className="grid lg:grid-cols-2 gap-6">
        <Card title=" Hospital device (private witness)" sub="Never leaves this machine unencrypted" className="!border-violet/40">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-muted">Patient</dt>
            <dd>{d.names[cl.patient as 'patient']}</dd>
            <dt className="text-muted">Hospital</dt>
            <dd>
              {h.name} · <span className="text-rose">{h.specialty}</span>
            </dd>
            <dt className="text-muted">Diagnosis</dt>
            <dd className="text-rose font-semibold">
              {cl.diagnosis.code} · {cl.diagnosis.display}
            </dd>
            <dt className="text-muted">Procedure</dt>
            <dd>
              {cl.procedure.code} · {cl.procedure.display}
            </dd>
            <dt className="text-muted">Bill</dt>
            <dd>
              {cl.bill.map((b: any) => (
                <div key={b.label} className="flex justify-between">
                  <span>{b.label}</span>
                  <span className="mono">{formatINR(b.amount)}</span>
                </div>
              ))}
            </dd>
            <dt className="text-muted">Policy</dt>
            <dd>
              {policyFor(cl.patient).planName} · {formatINR(policyFor(cl.patient).sumInsured)} · co-pay {policyFor(cl.patient).copayBps / 100}%
            </dd>
            <dt className="text-muted">Hospital secret</dt>
            <dd>
              <Hex v={h.secret} />
            </dd>
            <dt className="text-muted">Record</dt>
            <dd className="mono text-xs">ipfs://{cl.cid.slice(0, 26)}…</dd>
          </dl>
        </Card>
        <Card title=" Public chain (what the insurer sees)" sub={`tx ${cl.result.txHash.slice(0, 14)}… · ${cl.proofBytes?.toLocaleString()} byte proof`} className="!border-mint/40">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-muted">hospital_root</dt>
            <dd>
              <Hex v={pub.hospitalRoot} /> <span className="text-xs text-muted">one of {d.hospitals.length} licensed</span>
            </dd>
            <dt className="text-muted">policy_commitment</dt>
            <dd>
              <Hex v={pub.policyCommitment} />
            </dd>
            <dt className="text-muted">nullifier</dt>
            <dd>
              <Hex v={pub.nullifier} />
            </dd>
            <dt className="text-muted">claim_date</dt>
            <dd className="mono text-xs">{pub.claimDate}</dd>
            <dt className="text-muted">used_before</dt>
            <dd className="mono text-xs">{pub.usedBefore}</dd>
            <dt className="text-muted">payout_amount</dt>
            <dd className="text-mint font-semibold">{formatINR(pub.payoutAmount)}</dd>
            <dt className="text-muted">payout_recipient</dt>
            <dd>
              <Hex v={pub.payoutRecipient} /> <Chip tone="violet">{cl.rail === 'zcash' ? 'Zcash bridge' : 'one-time'}</Chip>
            </dd>
            <dt className="text-muted">tx sender</dt>
            <dd>
              {tx ? <Hex v={tx.from} /> : <button className="text-violet text-xs" onClick={load}>load</button>} <Chip>relayer, not hospital</Chip>
            </dd>
          </dl>
        </Card>
      </div>

      <Card
        title="Leak scan"
        sub="Reads every transaction and event emitted by the Mohar contracts and searches for each private value (as text, as a field element, as uint256)."
        right={
          <button className="btn btn-primary" onClick={runScan} disabled={busy}>
            {busy ? <Spinner /> : ''} Scan the chain
          </button>
        }
      >
        {scan ? (
          <div className="fade-in">
            <div className="text-sm text-muted mb-3"> Scanned {scan.txCount} transactions, {scan.logCount} events, {(scan.bytes / 1024).toFixed(1)} KB of calldata + logs.{' '}
              {scan.rows.every((r: any) => r.hits === 0) ? <Chip tone="mint">0 leaks</Chip> : <Chip tone="rose">leak found</Chip>}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {scan.rows.map((r: any) => (
                  <tr key={r.label} className="border-t border-line">
                    <td className="py-2">
                      {r.label}
                      {r.note && <div className="text-[11px] text-muted max-w-80">{r.note}</div>}
                    </td>
                    <td className="text-muted truncate max-w-56">{r.value}</td>
                    <td className="text-xs text-muted">{r.scope === 'all' ? 'entire chain' : 'claim tx + events'}</td>
                    <td className="text-right">{r.hits === 0 ? <Chip tone="mint">not found</Chip> : <Chip tone="rose">{r.hits} hits</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-muted">Press scan. Expected result: zero private values anywhere on-chain.</div>
        )}
      </Card>
    </div>
  );
}

export const _h = hospitalLeaf;
export const _c = c;
