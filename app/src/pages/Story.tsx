// Story mode — the presenter's stage. Patient phone · Hospital desk · Insurer screen, side by side.
// Every step runs the REAL action (chain txs, IPFS, in-browser proof); nothing here is a canned animation.
// Keys: → / Space = run step & advance · ← back · 1 2 3 zoom a device · X x-ray · R restart · ? help
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Eye,
  FileLock2,
  Fingerprint,
  Globe,
  Hospital,
  IdCard,
  Keyboard,
  Landmark,
  Lock,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  ShieldX,
  Smartphone,
  Stamp,
  Swords,
  Wallet,
} from 'lucide-react';
import { BILL_TEMPLATES, DIAGNOSES, PROCEDURES, computePayout, formatINR } from '@kavach/sdk';
import { Check, CountUp, Hex, Redacted, Spinner, Tag } from '../components/ui';
import { getDemo, revertReason } from '../lib/chain';
import { api } from '../lib/zk';
import { aadhaarStatus, hospitalProve, hospitalRequestConsent, hospitalSubmit, patientApprove, patientOpenRequest, policyFor, verifyAadhaar } from '../lib/flow';
import { scanChain, ScanRow } from '../lib/leakscan';

type Actor = 'patient' | 'hospital' | 'insurer';
const HOSP = 1; // Balco Medical Centre — oncology (the "leaky" hospital)
const DIAG = 'C50.9';
const PROC = 'MO012';

const STEPS: { id: string; label: string; icon: any; actor: Actor; say: string; pub: string; cta: string }[] = [
  { id: 'intro', label: 'Meet Asha', icon: Smartphone, actor: 'patient', say: 'Asha has a ₹5 lakh health policy. She has just been diagnosed with breast cancer and needs chemotherapy.', pub: 'nothing yet', cta: 'Begin' },
  { id: 'identity', label: 'Anon Aadhaar', icon: Fingerprint, actor: 'patient', say: 'First, Asha proves she is a real Aadhaar holder over 18 — without revealing her Aadhaar number, name, photo or date of birth.', pub: 'nullifier · age ≥ 18 · state', cta: 'Verify identity on-chain' },
  { id: 'admit', label: 'Encounter', icon: Hospital, actor: 'hospital', say: 'Balco Medical Centre, an oncology hospital, writes the encounter. The FHIR record is encrypted and pinned to IPFS; the consent request is sealed to Asha.', pub: 'nothing — ciphertext only', cta: 'Seal record & ask consent' },
  { id: 'consent', label: 'Consent', icon: FileLock2, actor: 'patient', say: 'Asha’s phone independently re-derives the payout and claim ID from her own policy, then she signs the exact terms. No phantom-patient claims.', pub: 'nothing — signature goes to the hospital', cta: 'Approve & sign' },
  { id: 'prove', label: 'Prove', icon: ShieldCheck, actor: 'hospital', say: 'The hospital proves seven statements in zero knowledge — in this browser. Licensed, policy active, covered, within limit, unique, consented, recipient bound.', pub: 'nothing — proving is local', cta: 'Generate proof' },
  { id: 'settle', label: 'Settle', icon: Stamp, actor: 'hospital', say: 'A relayer submits it, so the hospital’s wallet never touches the chain. The contract verifies and pays a fresh one-time address.', pub: '7 numbers + an 8.8 KB proof', cta: 'Submit via relayer' },
  { id: 'insurer', label: 'Insurer view', icon: Landmark, actor: 'insurer', say: 'The insurer sees an amount and six green checks. Not the diagnosis, not the procedure, not the bill — and not which hospital it paid.', pub: 'amount · policy commitment · nullifier · one-time address', cta: 'Show insurer' },
  { id: 'leak', label: 'Leak scan', icon: ScanSearch, actor: 'insurer', say: 'Don’t trust us: scan every transaction and event on the chain for anything private.', pub: 'everything on-chain, searched', cta: 'Scan the chain' },
  { id: 'end', label: 'Try to cheat', icon: Swords, actor: 'insurer', say: 'Hiding the diagnosis in the proof isn’t enough if the payment leaks it. Kavach hides it everywhere.', pub: '—', cta: 'Open the Attack Lab' },
];

type Packet = { id: number; from: Actor | 'chain'; to: Actor | 'chain'; label: string };
const X: Record<string, string> = { patient: '13%', hospital: '48%', insurer: '84%', chain: '84%' };

export function Story({ go }: { go: (p: string) => void }) {
  const d = getDemo();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [xray, setXray] = useState(false);
  const [zoom, setZoom] = useState<Actor | null>(null);
  const [help, setHelp] = useState(false);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [lastWire, setLastWire] = useState<string>('');
  const s = useRef<any>({}); // results of real actions
  const [, force] = useState(0);
  const rerender = () => force((x) => x + 1);

  const send = (from: Packet['from'], to: Packet['to'], label: string) => {
    setPacket({ id: Date.now(), from, to, label });
    setLastWire(label);
  };

  // Restore identity status (chain state persists across restarts of the story)
  useEffect(() => {
    aadhaarStatus('patient').then((st) => {
      s.current.identity = st.verified ? { already: true, state: st.state } : undefined;
      rerender();
    });
  }, []);

  const actions: Record<string, () => Promise<void>> = {
    intro: async () => {},
    identity: async () => {
      if (s.current.identity) return;
      send('patient', 'chain', 'Groth16 proof · 256 B · age≥18, state');
      const r = await verifyAadhaar('patient');
      s.current.identity = { ...r, state: r.state };
    },
    admit: async () => {
      const bill = BILL_TEMPLATES[PROC];
      const local = await hospitalRequestConsent({ hospitalIdx: HOSP, patient: 'patient', diagnosis: DIAG, procedure: PROC, bill, rail: 'stealth' });
      s.current.local = local;
      send('hospital', 'patient', 'sealed consent request · ECIES');
      // phone opens the request (patient's device decrypts + verifies)
      const item = await api(`/consent/${local.id}`);
      s.current.inbox = item;
      s.current.open = await patientOpenRequest('patient', item);
    },
    consent: async () => {
      await patientApprove('patient', s.current.inbox);
      send('patient', 'hospital', 'signature · 64 B');
    },
    prove: async () => {
      s.current.stage = 'tree';
      s.current.t0 = performance.now();
      rerender();
      const r = await hospitalProve(s.current.local.id, (st, extra) => {
        s.current.stage = st;
        if (st === 'proved') s.current.proof = extra;
        rerender();
      });
      s.current.proved = r;
    },
    settle: async () => {
      send('hospital', 'chain', `proof ${(s.current.proved.proof.proof.length / 1024).toFixed(1)} KB + 7 numbers`);
      const res = await hospitalSubmit(s.current.local.id, s.current.proved.proof, s.current.proved.claim);
      if (!res.ok) throw new Error(res.reason);
      s.current.settled = res;
      setTimeout(() => send('chain', 'insurer', `₹ → one-time ${s.current.proved.claim.payoutRecipient.slice(0, 8)}…`), 900);
    },
    insurer: async () => {},
    leak: async () => {
      s.current.scan = { rows: [] as ScanRow[] };
      rerender();
      const cl = { ...s.current.local, result: s.current.settled, pub: s.current.proved.claim };
      const r = await scanChain(cl, (row) => {
        s.current.scan.rows = [...s.current.scan.rows, row];
        rerender();
      });
      s.current.scan = { ...r };
    },
    end: async () => go('attack'),
  };

  const runAndAdvance = useCallback(async () => {
    if (busy) return;
    const st = STEPS[step];
    if (done[st.id] && step < STEPS.length - 1) return setStep(step + 1);
    setBusy(true);
    setErr('');
    try {
      await actions[st.id]();
      setDone((x) => ({ ...x, [st.id]: true }));
      if (step < STEPS.length - 1 && !['admit', 'prove', 'leak'].includes(st.id)) setStep(step + 1);
    } catch (e) {
      setErr(revertReason(e));
    }
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, busy, done]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === ' ') (e.preventDefault(), runAndAdvance());
      else if (e.key === 'ArrowLeft') setStep((x) => Math.max(0, x - 1));
      else if (e.key === '1') setZoom((z) => (z === 'patient' ? null : 'patient'));
      else if (e.key === '2') setZoom((z) => (z === 'hospital' ? null : 'hospital'));
      else if (e.key === '3') setZoom((z) => (z === 'insurer' ? null : 'insurer'));
      else if (e.key.toLowerCase() === 'x') setXray((x) => !x);
      else if (e.key.toLowerCase() === 'r') restart();
      else if (e.key === '?') setHelp((h) => !h);
      else if (e.key === 'Escape') (setZoom(null), setHelp(false));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  function restart() {
    const id = s.current.identity;
    s.current = { identity: id ? { ...id, already: true } : undefined };
    setDone({});
    setStep(0);
    setErr('');
    setPacket(null);
    setLastWire('');
  }

  const cur = STEPS[step];
  const active = cur.actor;
  const policy = policyFor('patient');
  const bill = BILL_TEMPLATES[PROC];
  const payout = computePayout(bill.map((b) => b.amount), policy);
  const ctx = { step, done, xray, s: s.current, busy, policy, bill, payout, d };

  const frame = (who: Actor, el: ReactNode, width: string) => {
    const isActive = active === who || (who === 'insurer' && cur.actor === 'insurer');
    const hidden = zoom && zoom !== who;
    if (hidden) return null;
    return (
      <div
        className="transition-all duration-500 min-w-0 h-full"
        style={{ width: zoom ? '100%' : width, opacity: zoom || isActive ? 1 : 0.55, transform: zoom || isActive ? 'none' : 'scale(0.97)' }}
      >
        {el}
      </div>
    );
  };

  return (
    <div className="h-[calc(100vh-57px)] flex flex-col overflow-hidden">
      {/* status strip */}
      <div className="flex items-center justify-between px-6 h-11 border-b border-line bg-panel/70 text-[13px]">
        <div className="flex items-center gap-3 text-muted">
          <span className="mono">Claim · Asha Verma · {formatINR(payout)}</span>
          <span className="w-1 h-1 rounded-full bg-line" />
          <span>
            Step {step + 1} of {STEPS.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className={`chip ${xray ? 'bg-text text-ink' : 'bg-text/5 text-muted'} !py-1 cursor-pointer`} onClick={() => setXray(!xray)}>
            <Eye size={12} /> X-ray {xray ? 'on' : 'off'} <kbd className="mono opacity-60">X</kbd>
          </button>
          <button className="chip bg-text/5 text-muted !py-1 cursor-pointer" onClick={restart}>
            <RotateCcw size={12} /> Restart <kbd className="mono opacity-60">R</kbd>
          </button>
          <button className="chip bg-text/5 text-muted !py-1 cursor-pointer" onClick={() => setHelp(!help)}>
            <Keyboard size={12} /> Keys <kbd className="mono opacity-60">?</kbd>
          </button>
        </div>
      </div>

      {/* stage */}
      <div className="flex-1 min-h-0 flex gap-5 px-6 pt-5 pb-2">
        {frame('patient', <PhoneFrame {...ctx} />, '25%')}
        {frame('hospital', <DeskFrame {...ctx} />, '43%')}
        {frame('insurer', <InsurerFrame {...ctx} />, '32%')}
      </div>

      {/* wire */}
      <div className="relative h-9 mx-6 border-y border-dashed border-line">
        <div className="absolute inset-y-0 left-0 flex items-center text-[11px] text-muted label">wire</div>
        {packet && (
          <div
            key={packet.id}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 chip bg-text text-ink mono shadow-lg"
            style={{ ['--from' as any]: X[packet.from], ['--to' as any]: X[packet.to], animation: 'packet 1.4s cubic-bezier(.6,0,.3,1) both' }}
          >
            {packet.label}
          </div>
        )}
        {!packet && <div className="absolute inset-0 grid place-items-center text-[11px] text-muted">only what crosses this line leaves a device</div>}
        {lastWire && <div className="absolute right-0 inset-y-0 flex items-center text-[11px] text-muted mono">last: {lastWire}</div>}
      </div>

      {/* stepper + narration */}
      <div className="grid grid-cols-[1.45fr_1fr] gap-6 px-6 py-4 border-t border-line bg-panel/80">
        <ol className="flex items-start">
          {STEPS.map((st, i) => {
            const Icon = st.icon;
            const isDone = done[st.id];
            const isCur = i === step;
            return (
              <li key={st.id} className="flex-1 flex flex-col items-center relative">
                {i > 0 && <span className={`absolute top-[17px] right-1/2 w-full h-px ${done[STEPS[i - 1].id] ? 'bg-text' : 'bg-line'}`} />}
                <button
                  onClick={() => setStep(i)}
                  className={`relative z-10 w-9 h-9 rounded-full grid place-items-center border transition ${
                    isCur ? 'bg-text text-ink border-text pulse' : isDone ? 'bg-mint/12 text-mint border-mint/40' : 'bg-panel text-muted border-line'
                  }`}
                >
                  {isDone && !isCur ? <BadgeCheck size={16} /> : <Icon size={16} strokeWidth={1.6} />}
                </button>
                <span className={`mt-1.5 text-[11.5px] text-center leading-tight ${isCur ? 'font-semibold' : 'text-muted'}`}>{st.label}</span>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-col justify-between gap-3">
          <p className="serif text-[21px] leading-snug">{cur.say}</p>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] text-muted min-w-0">
              <span className="label mr-2">on-chain</span>
              <span className="mono text-sky">{cur.pub}</span>
            </div>
            <button className="btn btn-primary shrink-0" onClick={runAndAdvance} disabled={busy}>
              {busy ? <Spinner /> : null}
              {done[cur.id] && step < STEPS.length - 1 ? 'Next' : cur.cta}
              <ArrowRight size={15} />
              <kbd className="mono text-[10px] opacity-60 ml-1">→</kbd>
            </button>
          </div>
          {err && <div className="text-[13px] text-rose mono">⛔ {err}</div>}
        </div>
      </div>

      {help && (
        <div className="fixed inset-0 bg-text/40 grid place-items-center z-50" onClick={() => setHelp(false)}>
          <div className="card p-6 w-[420px] text-sm space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="serif text-2xl mb-2">Presenter keys</div>
            {[
              ['→ / Space', 'run this step, then advance'],
              ['←', 'previous step'],
              ['1 · 2 · 3', 'zoom patient / hospital / insurer'],
              ['X', 'x-ray: tag every field private or public'],
              ['R', 'restart the story (chain state is kept)'],
              ['Esc', 'close / unzoom'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <kbd className="mono">{k}</kbd>
                <span className="text-muted">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================ devices
type Ctx = { step: number; done: Record<string, boolean>; xray: boolean; s: any; busy: boolean; policy: any; bill: { label: string; amount: number }[]; payout: number; d: any };
const at = (c: Ctx, id: string) => STEPS.findIndex((x) => x.id === id) <= c.step;

function Boundary({ icon, title, sub, children, tone = 'violet' }: { icon: ReactNode; title: string; sub: string; children: ReactNode; tone?: 'violet' | 'sky' }) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 mb-2 text-[12px]">
        <span className="text-muted">{icon}</span>
        <span className="font-semibold">{title}</span>
        <span className={`chip ${tone === 'violet' ? 'bg-violet/10 text-violet' : 'bg-sky/10 text-sky'}`}>
          {tone === 'violet' ? <Lock size={10} /> : <Globe size={10} />} {sub}
        </span>
      </div>
      <div className="flex-1 min-h-0 boundary p-2.5">{children}</div>
    </div>
  );
}

function BrowserChrome({ url, children }: { url: string; children: ReactNode }) {
  return (
    <div className="h-full card overflow-hidden flex flex-col shadow-[0_18px_50px_-20px_rgba(22,24,29,.35)]">
      <div className="h-8 shrink-0 flex items-center gap-1.5 px-3 border-b border-line bg-panel2">
        <span className="w-2.5 h-2.5 rounded-full bg-line" />
        <span className="w-2.5 h-2.5 rounded-full bg-line" />
        <span className="w-2.5 h-2.5 rounded-full bg-line" />
        <span className="ml-3 mono text-[11px] text-muted truncate">{url}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">{children}</div>
    </div>
  );
}

function PhoneFrame(c: Ctx) {
  const id = c.s.identity;
  const open = c.s.open;
  return (
    <Boundary icon={<Smartphone size={14} />} title="Asha’s phone" sub="private">
      <div className="h-full mx-auto max-w-[300px] rounded-[34px] border-[6px] border-text bg-panel flex flex-col overflow-hidden shadow-[0_18px_50px_-20px_rgba(22,24,29,.45)]">
        <div className="h-6 flex justify-center items-end">
          <span className="w-20 h-4 rounded-b-xl bg-text" />
        </div>
        <div className="px-4 pt-2 pb-2 flex items-center justify-between">
          <span className="font-semibold text-[13px]">Vault</span>
          <span className="text-[11px] text-muted">Asha Verma</span>
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-3 pb-3 space-y-2.5 text-[12.5px]">
          <div className="rounded-xl bg-text text-ink p-3">
            <div className="text-[10px] uppercase tracking-wider opacity-70">{c.policy.insurerName}</div>
            <div className="serif text-[18px] leading-tight mt-0.5">{c.policy.planName}</div>
            <div className="flex justify-between mt-2 mono text-[12px]">
              <span>{formatINR(c.policy.sumInsured)}</span>
              <span className="opacity-70">co-pay {c.policy.copayBps / 100}%</span>
            </div>
          </div>

          {/* identity */}
          <div className={`rounded-xl border p-3 ${c.step === 1 ? 'border-text' : 'border-line'}`}>
            <div className="flex items-center gap-2 font-semibold">
              <IdCard size={14} /> Anon Aadhaar
              {id ? <span className="ml-auto chip bg-mint/12 text-mint">verified</span> : <span className="ml-auto chip bg-text/5 text-muted">not verified</span>}
            </div>
            {(c.step === 1 || id) && (
              <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11.5px]">
                <span className="text-muted">Age</span>
                <span>{id ? '18+ ✓' : '…'}</span>
                <span className="text-muted">State</span>
                <span>{id ? id.state : '…'}</span>
                <span className="text-muted">Aadhaar no.</span>
                <Redacted text="XXXX XXXX 4321" />
                <span className="text-muted">Name · DOB</span>
                <Redacted text="Asha · 1991" />
                <span className="text-muted">Photo</span>
                <Redacted text="████████" />
              </div>
            )}
            {id?.gas && <div className="mt-2 text-[10.5px] text-muted mono">on-chain Groth16 verify · {id.gas.toLocaleString()} gas</div>}
            {id?.already && <div className="mt-2 text-[10.5px] text-muted">verified earlier on this chain</div>}
          </div>

          {/* consent sheet */}
          {open && (
            <div className={`rounded-xl border p-3 fade-in ${c.step === 3 ? 'border-text' : 'border-line'}`}>
              <div className="text-[11px] text-muted">{open.payload.hospital} requests consent</div>
              <div className="font-semibold mt-0.5">{open.payload.procedure.display}</div>
              <div className="mt-1 text-[11.5px]">
                Insurer pays <b className="text-mint">{formatINR(open.payload.claim.payoutAmount)}</b> to a one-time address
              </div>
              <div className="mt-2 space-y-1">
                <Check ok={open.checks.payoutMatchesPolicy}>payout = my policy maths</Check>
                <Check ok={open.checks.covered}>covered by my plan</Check>
                <Check ok={open.checks.nullifierMatches}>claim ID from my record</Check>
                <Check ok={open.checks.digestMatches}>signing these exact terms</Check>
              </div>
              <div className={`mt-2.5 rounded-lg text-center py-2 text-[12px] font-semibold ${c.done.consent ? 'bg-mint/12 text-mint' : 'bg-text text-ink'}`}>
                {c.done.consent ? '✓ Signed with consent key' : c.busy && c.step === 3 ? 'Signing…' : 'Hold to sign'}
              </div>
            </div>
          )}
          {c.done.settle && (
            <div className="rounded-xl border border-line p-3 fade-in flex items-center gap-2">
              <BadgeCheck size={14} className="text-mint" /> Claim settled. Nothing to pay at discharge.
            </div>
          )}
        </div>
      </div>
    </Boundary>
  );
}

function DeskFrame(c: Ctx) {
  const h = c.d.hospitals[HOSP];
  const diag = DIAGNOSES.find((x) => x.code === DIAG)!;
  const proc = PROCEDURES.find((x) => x.code === PROC)!;
  const total = c.bill.reduce((a, b) => a + b.amount, 0);
  const stage = c.s.stage;
  return (
    <Boundary icon={<Building2 size={14} />} title={`${h.name} · ${h.specialty}`} sub="hospital device · private">
      <BrowserChrome url="seal.balco-hospital.in / claims / new">
        {!at(c, 'admit') ? (
          <div className="h-full grid place-items-center text-center text-muted text-sm">
            <div>
              <Hospital size={28} className="mx-auto mb-2 opacity-50" />
              Admissions · Oncology ward
              <div className="text-[12px] mt-1">Asha Verma admitted for chemotherapy</div>
            </div>
          </div>
        ) : !at(c, 'prove') ? (
          <div className="space-y-3 fade-in">
            <div className="serif text-[22px] leading-tight">Encounter · Asha Verma</div>
            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <Fld k="Diagnosis (ICD-10)" v={`${diag.code} · ${diag.display}`} x={c.xray} />
              <Fld k="Procedure" v={`${proc.code} · ${proc.display}`} x={c.xray} />
            </div>
            <div className="rounded-lg border border-line">
              {c.bill.map((b) => (
                <div key={b.label} className="flex justify-between px-3 py-1.5 text-[13px] border-b border-line last:border-0">
                  <span>{b.label}</span>
                  <span className="mono">{formatINR(b.amount)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center text-[13px]">
              <span className="text-muted">
                {formatINR(total)} − {formatINR(c.policy.deductible)} deductible − {c.policy.copayBps / 100}% co-pay
              </span>
              <span>
                payout <b className="mono text-mint text-[15px]">{formatINR(c.payout)}</b>
              </span>
            </div>
            {c.s.local && (
              <div className="text-[12px] text-muted flex items-center gap-2 fade-in">
                <FileLock2 size={13} /> FHIR record encrypted → <span className="mono">ipfs://{c.s.local.cid.slice(0, 16)}…</span>
                {c.xray && <Tag kind="private" />}
              </div>
            )}
            {c.done.admit && !c.done.consent && (
              <div className="text-[12.5px] text-amber flex items-center gap-2">
                <Spinner size={12} /> waiting for Asha’s signature
              </div>
            )}
            {c.done.consent && <div className="text-[12.5px] text-mint flex items-center gap-2"><BadgeCheck size={14} /> consent signature received</div>}
          </div>
        ) : (
          <ProofLoom c={c} stage={stage} />
        )}
      </BrowserChrome>
    </Boundary>
  );
}

function ProofLoom({ c, stage }: { c: Ctx; stage: string }) {
  const proof = c.s.proof;
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (proof || !c.s.t0) return;
    const i = setInterval(() => setNow(performance.now()), 80);
    return () => clearInterval(i);
  }, [proof, c.s.t0]);
  const elapsed = proof ? proof.proveMs + (proof.witnessMs ?? 0) : c.s.t0 ? now - c.s.t0 : 0;
  const filled = proof ? 64 : Math.min(60, Math.floor((elapsed / 9000) * 64));
  const stmts = ['Licensed hospital (Merkle)', 'Policy active on claim date', 'Procedure covered, not excluded', 'Payout = policy maths ≤ limit', 'Nullifier is unique', 'Patient consent signature', 'Payout recipient bound'];
  const stages = [
    ['tree', 'Rebuild hospital tree · match root'],
    ['witness', 'Witness · check 7 statements'],
    ['prove', 'UltraHonk proof (bb.js, WASM)'],
  ];
  const order = ['tree', 'witness', 'prove', 'proved'];
  return (
    <div className="space-y-3 fade-in">
      <div className="flex items-center justify-between">
        <div className="serif text-[22px]">Zero-knowledge proof</div>
        <span className="mono text-[13px]">{(elapsed / 1000).toFixed(2)}s</span>
      </div>
      <div className="text-[12px] text-muted flex items-center gap-1.5">
        <Lock size={12} /> running in this browser — nothing is sent while proving
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-4">
        <div className="space-y-1.5">
          {stages.map(([k, label]) => {
            const idx = order.indexOf(stage ?? '');
            const me = order.indexOf(k);
            const st = !stage ? null : idx > me ? true : idx === me ? null : null;
            return (
              <div key={k} className={`flex items-center gap-2 text-[13px] ${idx < me ? 'text-muted' : ''}`}>
                {idx === me && !proof ? <Spinner size={12} /> : <Check ok={idx > me || !!proof ? true : null}>{''}</Check>}
                <span>{label}</span>
                {st}
              </div>
            );
          })}
          <div className="perforated pt-2 mt-2 space-y-1">
            {stmts.map((t) => (
              <Check key={t} ok={order.indexOf(stage ?? '') >= 2 || !!proof ? true : null}>
                <span className="text-[12.5px]">{t}</span>
              </Check>
            ))}
          </div>
        </div>
        <div className="relative">
          <div className="grid grid-cols-8 gap-[3px] w-[136px]">
            {Array.from({ length: 64 }).map((_, i) => (
              <span key={i} className={`w-[14px] h-[14px] rounded-[3px] transition-colors duration-300 ${i < filled ? 'bg-text' : 'bg-text/8'}`} />
            ))}
          </div>
          <div className="mono text-[10px] text-muted mt-1.5 text-center">45,596 gates</div>
          {proof && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="stamp rounded-lg border-2 border-mint text-mint bg-panel px-3 py-1.5 text-center">
                <div className="text-[13px] font-bold tracking-wider">PROVEN</div>
                <div className="mono text-[10px]">{(proof.proof.length / 1024).toFixed(1)} KB</div>
              </div>
            </div>
          )}
        </div>
      </div>
      {c.s.settled && (
        <div className="perforated pt-3 text-[12.5px] fade-in space-y-1">
          <div className="flex justify-between">
            <span className="text-muted">relayed tx</span>
            <Hex v={c.s.settled.txHash} />
          </div>
          <div className="flex justify-between">
            <span className="text-muted">block · gas</span>
            <span className="mono">
              #{c.s.settled.block} · {Number(c.s.settled.gasUsed).toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">paid to</span>
            <span>
              <Hex v={c.s.proved.claim.payoutRecipient} /> <span className="chip bg-violet/10 text-violet">one-time</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function InsurerFrame(c: Ctx) {
  const settled = c.s.settled;
  const claim = c.s.proved?.claim;
  const scan = c.s.scan;
  return (
    <Boundary icon={<Landmark size={14} />} title="Suraksha Health · Blind Desk" sub="sees only the chain" tone="sky">
      <BrowserChrome url="desk.suraksha.in / claims">
        <div className="space-y-3 text-[13px]">
          {c.s.identity && (
            <div className="rounded-lg border border-line p-2.5 fade-in">
              <div className="label">New verified customer</div>
              <div className="flex items-center gap-2 mt-1">
                <Fingerprint size={14} className="text-mint" /> Anon Aadhaar · age 18+ · {c.s.identity.state}
              </div>
              <div className="text-[11.5px] text-muted mt-1">
                Name <Redacted text="Asha Verma" /> · Aadhaar <Redacted text="0000 0000" />
              </div>
            </div>
          )}
          {!settled && (
            <div className="text-muted text-center py-6">
              <Wallet size={22} className="mx-auto mb-1.5 opacity-50" />
              No claims in queue
            </div>
          )}
          {settled && (!at(c, 'leak') || !scan) && (
            <div className="rounded-lg border border-line p-3 fade-in">
              <div className="flex items-baseline justify-between">
                <div className="serif text-[30px] leading-none">
                  {at(c, 'insurer') ? <CountUp to={claim.payoutAmount} format={formatINR} /> : formatINR(claim.payoutAmount)}
                </div>
                <span className="chip bg-mint/12 text-mint">auto-settled</span>
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mt-3 text-[12px]">
                <span className="text-muted">policy</span>
                <span>
                  <Hex v={claim.policyCommitment} n={5} /> {c.xray && <Tag kind="public" />}
                </span>
                <span className="text-muted">nullifier</span>
                <Hex v={claim.nullifier} n={5} />
                <span className="text-muted">paid to</span>
                <span>
                  <Hex v={claim.payoutRecipient} n={5} />
                </span>
              </div>
              {at(c, 'insurer') && (
                <>
                  <div className="perforated mt-3 pt-2 space-y-1">
                    <Check ok>Licensed hospital</Check>
                    <Check ok>Active policy, past waiting period</Check>
                    <Check ok>Covered, not excluded</Check>
                    <Check ok>Within remaining limit</Check>
                    <Check ok>Not a duplicate</Check>
                    <Check ok>Patient signed</Check>
                  </div>
                  <div className="perforated mt-3 pt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px] items-center">
                    <span className="text-muted">diagnosis</span>
                    <Redacted text="C50.9 Breast cancer" />
                    <span className="text-muted">procedure</span>
                    <Redacted text="Chemotherapy cycle" />
                    <span className="text-muted">hospital</span>
                    <Redacted text="Balco Medical Centre" />
                    <span className="text-muted">patient</span>
                    <Redacted text="Asha Verma" />
                  </div>
                  <div className="mt-2 text-[11.5px] text-mint flex items-center gap-1.5">
                    <ShieldCheck size={13} /> recipient unlinkable to any hospital
                  </div>
                </>
              )}
            </div>
          )}
          {scan && (
            <div className="fade-in">
              <div className="flex items-center justify-between mb-2">
                <span className="serif text-[20px]">Leak scan</span>
                {scan.txCount && (
                  <span className={`chip ${scan.rows.every((r: ScanRow) => r.hits === 0) ? 'bg-mint/12 text-mint' : 'bg-rose/12 text-rose'}`}>
                    {scan.rows.every((r: ScanRow) => r.hits === 0) ? '0 leaks' : 'leak'}
                  </span>
                )}
              </div>
              {scan.txCount && (
                <div className="text-[11.5px] text-muted mb-1.5">
                  {scan.txCount} txs · {scan.logCount} events · {scan.kb.toFixed(1)} KB searched
                </div>
              )}
              <div className="space-y-1">
                {scan.rows.map((r: ScanRow) => (
                  <div key={r.label} className="flex justify-between items-center text-[12px] fade-in">
                    <span>{r.label}</span>
                    {r.hits === 0 ? <span className="text-mint mono">0 matches</span> : <span className="text-rose mono flex items-center gap-1"><ShieldX size={12} /> {r.hits}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </BrowserChrome>
    </Boundary>
  );
}

function Fld({ k, v, x }: { k: string; v: string; x: boolean }) {
  return (
    <div>
      <div className="label flex items-center gap-1.5">
        {k} {x && <Tag kind="private" />}
      </div>
      <div className="mt-0.5">{v}</div>
    </div>
  );
}
