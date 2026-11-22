import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { formatINR, PROCEDURES, policyCommitment, toHex32 } from '@kavach/sdk';
import { PageHeader } from '../App';
import { Card, Check, Chip, Empty, Hex, Redacted, Spinner, Stat, useAsync } from '../components/ui';
import { FhirView } from '../components/Fhir';
import { c, events, getDemo, nameOf, revertReason, Role } from '../lib/chain';

const dupOwner = (e: any) => {
  const data: string = e?.data ?? e?.info?.error?.data ?? '';
  return data.length >= 74 ? nameOf('0x' + data.slice(-40)) : 'another account';
};
import { api } from '../lib/zk';
import { openRecord, patientApprove, patientOpenRequest, policyFor, revokeAndRekey, shareRecord, aadhaarStatus, verifyAadhaar } from '../lib/flow';
import { Fingerprint } from 'lucide-react';

const ROLE_NAMES = ['—', 'Doctor', 'Hospital', 'Lab', 'Pharmacy', 'Emergency'];

export function Vault() {
  const d = getDemo();
  const [who, setWho] = useState<Role>('patient');
  const addr = d.accounts[who].address;
  const policy = policyFor(who);

  const pol = useAsync(async () => {
    const cm = toHex32(await policyCommitment(policy));
    const p = await c().claims.policies(cm);
    return { used: Number(p.used), active: p.active, cm, matches: p.insurer !== '0x0000000000000000000000000000000000000000' };
  }, [who], 4000);

  return (
    <div className="space-y-6">
      <PageHeader
        icon=""
        title="Patient Vault"
        sub="Your records are encrypted on your device and pinned to IPFS. The chain only holds hashes, who you've let in, and a log of every look."
        right={
          <div className="flex gap-1 card p-1">
            {(['patient', 'patient2'] as Role[]).map((r) => (
              <button key={r} onClick={() => setWho(r)} className={`px-3 py-1.5 rounded-lg text-sm ${who === r ? 'bg-text text-ink' : 'text-muted'}`}>
                {d.names[r]}
              </button>
            ))}
          </div>
        }
      />
      <EmergencyBanner addr={addr} />

      <div className="grid md:grid-cols-4 gap-3">
        <Stat label="Plan" value={<span className="text-lg">{policy.planName}</span>} hint={policy.insurerName} />
        <Stat label="Sum insured" value={formatINR(policy.sumInsured)} hint={`deductible ${formatINR(policy.deductible)} · co-pay ${policy.copayBps / 100}%`} />
        <Stat label="Remaining" value={pol.data ? formatINR(policy.sumInsured - pol.data.used) : '—'} tone="mint" hint={pol.data && `used ${formatINR(pol.data.used)} (tracked on-chain)`} />
        <Stat
          label="Valid"
          value={<span className="text-lg">{new Date(policy.endDate * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
          hint={policy.waitingUntil * 1000 > Date.now() ? <span className="text-amber">waiting period until {new Date(policy.waitingUntil * 1000).toLocaleDateString('en-IN')}</span> : 'waiting period over'}
        />
      </div>
      <div className="text-xs text-muted flex flex-wrap gap-2 items-center"> On-chain this policy is only <Hex v={pol.data?.cm ?? ''} n={10} />
        {pol.data?.matches && <Chip tone="mint">✓ recomputed from your copy, found on-chain</Chip>}
        <span>· covers {policy.coveredProcedures.map((p) => PROCEDURES.find((x) => x.code === p)?.display ?? p).join(', ')}</span>
      </div>

      <Identity who={who} />
      <Inbox who={who} />
      <Records who={who} />
      <div className="grid md:grid-cols-2 gap-6">
        <AuditTrail who={who} />
        <EmergencySetup who={who} />
      </div>
    </div>
  );
}

function EmergencyBanner({ addr }: { addr: string }) {
  const { data } = useAsync(async () => events('breakGlass', 'EmergencyUnlocked', null, addr), [addr], 4000);
  if (!data?.length) return null;
  const last = data.at(-1);
  return (
    <div className="card border-rose/50 bg-rose/10 p-4 flex items-center gap-3 fade-in">
      <span className="text-2xl"></span>
      <div className="text-sm">
        <b className="text-rose">Your emergency card was unlocked</b> for {nameOf(last.args.responder)} (block {last.blockNumber}) after 2 of your guardians approved. Every view is
        logged below.
      </div>
    </div>
  );
}

function Inbox({ who }: { who: Role }) {
  const d = getDemo();
  const { data, reload } = useAsync(async () => {
    const items = await api(`/consent?patient=${d.accounts[who].address}`);
    return Promise.all(items.map(async (i: any) => ({ ...i, open: i.status === 'pending' ? await patientOpenRequest(who, i).catch(() => null) : null })));
  }, [who], 2500);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = (data ?? []).filter((i: any) => i.status === 'pending');
  return (
    <Card title="Claim consent requests" sub="A hospital can't claim on your policy unless you sign the exact amount and payout address. Your device re-derives every number first.">
      {!pending.length && <Empty>No pending requests. Start one from the  Seal desk.</Empty>}
      <div className="space-y-3">
        {pending.map((i: any) => {
          const o = i.open;
          if (!o) return null;
          const p = o.payload;
          return (
            <div key={i.id} className="rounded-xl border border-violet/50 bg-violet/5 p-4 fade-in">
              <div className="flex flex-wrap justify-between gap-4">
                <div>
                  <div className="text-sm text-muted">{p.hospital} asks you to approve</div>
                  <div className="text-lg font-bold">{p.procedure.display}</div>
                  <div className="text-sm text-muted">Diagnosis {p.diagnosis.code} · {p.diagnosis.display}</div>
                  <div className="mt-2 text-sm"> Bill {formatINR(p.bill.reduce((a: number, b: any) => a + b.amount, 0))} → insurer pays <b className="text-mint">{formatINR(p.claim.payoutAmount)}</b> to{' '}
                    {p.claim.rail === 'zcash' ? 'a Zcash shielded address' : 'a one-time address'} <Hex v={p.claim.recipient} />
                  </div>
                </div>
                <div className="space-y-1.5 min-w-60">
                  <Check ok={o.checks.payoutMatchesPolicy}>Payout matches my policy maths</Check>
                  <Check ok={o.checks.covered}>Procedure is on my covered list</Check>
                  <Check ok={o.checks.nullifierMatches}>Claim ID derived from my record</Check>
                  <Check ok={o.checks.digestMatches}>Signing exactly these terms</Check>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  className="btn btn-primary"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy(i.id);
                    try {
                      await patientApprove(who, i);
                    } catch (e: any) {
                      alert(e.message);
                    }
                    setBusy(null);
                    reload();
                  }}
                >
                  {busy === i.id ? <Spinner /> : ''} Approve & sign
                </button>
                <button className="btn btn-ghost" onClick={async () => (await api(`/consent/${i.id}`, { decline: true }), reload())}> Decline
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Records({ who }: { who: Role }) {
  const d = getDemo();
  const addr = d.accounts[who].address;
  const { data, reload } = useAsync(async () => {
    const ids: string[] = await c().vault.recordsOf(addr);
    return Promise.all(
      ids.map(async (id) => {
        const r = await c().vault.records(id);
        const grantees: string[] = await c().vault.granteesOf(id);
        const grants = await Promise.all(grantees.map(async (g) => ({ g, ...(await c().vault.getGrant(id, g)).toObject(), can: await c().vault.canAccess(id, g) })));
        return { id, kind: r.kind, cid: r.cid, version: Number(r.version), updatedAt: Number(r.updatedAt), grants };
      }),
    );
  }, [who], 5000);
  const [open, setOpen] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [hours, setHours] = useState(24);

  const act = async (key: string, fn: () => Promise<any>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e: any) {
      alert(e.message);
    }
    setBusy(null);
    reload();
  };

  return (
    <Card
      title="My records"
      sub="AES-256-GCM ciphertext on IPFS · key wrapped per grantee (ECIES secp256k1) · revoking re-encrypts the record so old keys die"
      right={
        <select className="input w-auto" value={hours} onChange={(e) => setHours(+e.target.value)}>
          <option value={1}>share for 1 hour</option>
          <option value={24}>share for 24 hours</option>
          <option value={168}>share for 7 days</option>
        </select>
      }
    >
      {!data?.length && <Empty>No records yet.</Empty>}
      <div className="space-y-3">
        {(data ?? []).map((r) => (
          <div key={r.id} className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">{r.kind === 'emergency-card' ? '🆘' : ''}</span>
                <div>
                  <div className="font-semibold capitalize">{r.kind.replace('-', ' ')}</div>
                  <div className="text-xs text-muted"> ipfs://<span className="mono">{r.cid.slice(0, 18)}…</span> · v{r.version}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button className="btn btn-ghost" onClick={() => act('o' + r.id, async () => setOpen({ ...open, [r.id]: open[r.id] ? null : await openRecord(who, r.id, 'owner') }))}>
                  {busy === 'o' + r.id ? <Spinner /> : ''} {open[r.id] ? 'Hide' : 'Decrypt'}
                </button>
                {r.kind !== 'emergency-card' && (
                  <button className="btn btn-ghost" onClick={() => act('s' + r.id, () => shareRecord(who, r.id, d.accounts.doctor.address, 1, hours))}>
                    {busy === 's' + r.id ? <Spinner /> : ''} Share with {d.names.doctor.split(' (')[0]}
                  </button>
                )}
              </div>
            </div>
            {r.grants.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {r.grants.map((g: any) => (
                  <div key={g.g} className="flex items-center gap-2 text-xs border border-line rounded-lg pl-3 pr-1 py-1">
                    <span>{nameOf(g.g)}</span>
                    <Chip tone={g.can ? 'mint' : 'gray'}>{g.can ? `${ROLE_NAMES[Number(g.role)]} · until ${new Date(Number(g.expiresAt) * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'no access'}</Chip>
                    {g.can && (
                      <button className="btn btn-danger !py-1 !px-2 !text-xs" onClick={() => act('r' + r.id, () => revokeAndRekey(who, r.id, g.g))}>
                        {busy === 'r' + r.id ? <Spinner /> : 'Revoke + re-key'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {open[r.id] && <div className="mt-3"><FhirView bundle={open[r.id]} /></div>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function AuditTrail({ who }: { who: Role }) {
  const d = getDemo();
  const addr = d.accounts[who].address;
  const { data } = useAsync(async () => {
    const ids: string[] = await c().vault.recordsOf(addr);
    const all: any[] = [];
    for (const n of ['RecordRegistered', 'RecordUpdated', 'AccessGranted', 'AccessRevoked', 'AccessLogged']) {
      for (const id of ids) all.push(...(await events('vault', n, id)).map((e) => ({ n, e })));
    }
    for (const n of ['EmergencyRequested', 'EmergencyUnlocked']) all.push(...(await events('breakGlass', n, null, addr)).map((e) => ({ n, e })));
    return all.sort((a, b) => b.e.blockNumber - a.e.blockNumber || b.e.index - a.e.index).slice(0, 30);
  }, [who], 4000);
  const text = ({ n, e }: any) => {
    const a = e.args;
    switch (n) {
      case 'RecordRegistered':
        return ['', `Record added (${a.kind})`];
      case 'RecordUpdated':
        return ['', `Record re-encrypted → v${a.version} · ${a.reason}`];
      case 'AccessGranted':
        return ['', `${nameOf(a.grantee)} granted ${ROLE_NAMES[Number(a.role)]} access until ${new Date(Number(a.expiresAt) * 1000).toLocaleString('en-IN')}`];
      case 'AccessRevoked':
        return ['', `${nameOf(a.grantee)} access revoked`];
      case 'AccessLogged':
        return ['', `${nameOf(a.viewer)} viewed a record — "${a.purpose}"`];
      case 'EmergencyRequested':
        return ['', `${nameOf(a.responder)} requested emergency access: "${a.reason}"`];
      case 'EmergencyUnlocked':
        return ['', `Emergency card unlocked for ${nameOf(a.responder)}`];
    }
    return ['·', n];
  };
  return (
    <Card title="Audit trail" sub="Every grant, revoke, view and change — written on-chain, readable by you forever.">
      {!data?.length && <Empty>Nothing yet.</Empty>}
      <ul className="space-y-2 max-h-80 overflow-auto pr-1">
        {(data ?? []).map((x: any, i: number) => {
          const [icon, t] = text(x);
          return (
            <li key={i} className="flex gap-3 text-sm">
              <span>{icon}</span>
              <span className="flex-1">{t}</span>
              <span className="text-xs text-muted mono">#{x.e.blockNumber}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function EmergencySetup({ who }: { who: Role }) {
  const d = getDemo();
  const addr = d.accounts[who].address;
  const { data } = useAsync(async () => c().breakGlass.getSetup(addr), [who]);
  const [qr, setQr] = useState('');
  useEffect(() => {
    QRCode.toDataURL(JSON.stringify({ app: 'kavach', patient: addr, chain: d.deployment.chainId, breakGlass: d.deployment.breakGlass }), {
      margin: 1,
      width: 180,
      color: { dark: '#0b0d12', light: '#ffffff' },
    }).then(setQr);
  }, [addr]);
  return (
    <Card title="Break-glass" sub="If you're unconscious, any 2 of these 3 guardians can release your emergency card to a responder.">
      {data?.active ? (
        <div className="flex gap-5 items-start">
          {qr && <img src={qr} className="rounded-lg w-36" alt="Emergency QR" />}
          <div className="space-y-2 text-sm">
            <div className="label">Guardians</div>
            {data.guardians.map((g: string) => (
              <div key={g}> {nameOf(g)}</div>
            ))}
            <p className="text-xs text-muted pt-2">Lock-screen QR for paramedics. Holds no medical data, only where to ask.</p>
          </div>
        </div>
      ) : (
        <Empty>No guardians configured for this patient.</Empty>
      )}
    </Card>
  );
}

function Identity({ who }: { who: Role }) {
  const { data, reload } = useAsync(() => aadhaarStatus(who), [who], 5000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<any>(null);
  return (
    <Card
      icon={<Fingerprint size={18} />}
      title="Identity · Anon Aadhaar"
      sub="Prove you hold a genuine UIDAI-signed Aadhaar and are 18+, revealing only your state. One Aadhaar backs exactly one account."
      right={
        data?.verified ? (
          <Chip tone="mint">verified · 18+ · {data.state}</Chip>
        ) : (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr('');
              try {
                setRes(await verifyAadhaar(who));
              } catch (e: any) {
                const r = revertReason(e);
                setErr(
                  r === 'DuplicateAadhaar'
                    ? `Blocked by the contract: DuplicateAadhaar. This Aadhaar already backs another Kavach account (${dupOwner(e)}). One Aadhaar = one account — the demo has a single UIDAI test Aadhaar, and it belongs to Asha.`
                    : r === 'InvalidAadhaarProof'
                      ? 'Blocked by the contract: InvalidAadhaarProof — the proof is bound to a different wallet.'
                      : r,
                );
              }
              setBusy(false);
              reload();
            }}
          >
            {busy ? <Spinner /> : <Fingerprint size={15} />} Verify with Anon Aadhaar
          </button>
        )
      }
    >
      <div className="grid sm:grid-cols-4 gap-3 text-[13px]">
        <div>
          <div className="label">Revealed</div>
          <div className="mt-1">age ≥ 18 · state</div>
        </div>
        <div>
          <div className="label">Hidden</div>
          <div className="mt-1 flex gap-1 flex-wrap">
            <Redacted text="Aadhaar no." /> <Redacted text="name" /> <Redacted text="DOB" /> <Redacted text="photo" />
          </div>
        </div>
        <div>
          <div className="label">Proof</div>
          <div className="mt-1">Groth16 over UIDAI RSA-2048 signature · made on this device</div>
        </div>
        <div>
          <div className="label">Mode</div>
          <div className="mt-1">UIDAI test key (demo QR)</div>
        </div>
      </div>
      {res && <div className="mt-3 text-[13px] text-mint fade-in">Verified on-chain · {res.gas.toLocaleString()} gas · nullifier {String(res.proof.nullifier).slice(0, 10)}…</div>}
      {err && <div className="mt-3 text-[13px] text-rose leading-relaxed">{err}</div>}
    </Card>
  );
}
