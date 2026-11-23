import { useEffect, useState } from 'react';
import { ArrowRight, ExternalLink, KeyRound, QrCode, ScanLine, Smartphone } from 'lucide-react';
import { getDemo, short } from '../lib/chain';
import { identities, Identity, KIND_META, Kind, signIn } from '../lib/session';
import { api } from '../lib/zk';
import { QrImage, QrScanner } from '../components/Qr';
import { Spinner } from '../components/ui';

const GROUPS: { title: string; kinds: Kind[]; note: string }[] = [
  { title: 'The claim — Patient → Hospital → Insurer', kinds: ['patient', 'hospital', 'insurer'], note: 'The three-role workflow from the problem statement.' },
  { title: 'Care team — shared records', kinds: ['doctor', 'lab', 'pharmacy'], note: 'Sees only what a patient grants, only while it lasts, and every view is logged on-chain.' },
  { title: 'Governance & emergencies', kinds: ['regulator', 'responder', 'guardian'], note: 'Licensing, and break-glass access when a patient can’t consent.' },
];

export function appBase(lan: string | null) {
  const { protocol, port, hostname } = location;
  if (lan && (hostname === 'localhost' || hostname === '127.0.0.1')) return `${protocol}//${lan}${port ? ':' + port : ''}`;
  return location.origin;
}

export function useLan() {
  const [lan, setLan] = useState<string | null>(null);
  useEffect(() => {
    api('/lan')
      .then((r) => setLan(r.publicUrl ? null : r.ips?.[0] ?? null))
      .catch(() => {});
  }, []);
  return lan;
}

export const roleUrl = (base: string, i: Identity) => `${base}/?as=${i.id}#/${i.page}`;

export function Login({ go }: { go: (p: string) => void }) {
  const d = getDemo();
  const all = identities();
  const [busy, setBusy] = useState('');
  const [qrFor, setQrFor] = useState<Identity | null>(null);
  const [scan, setScan] = useState(false);
  const lan = useLan();
  const base = appBase(lan);

  async function enter(i: Identity) {
    setBusy(i.id);
    await signIn(i);
    setBusy('');
    go(i.page);
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-end justify-between gap-6 flex-wrap mb-7">
        <div>
          <div className="label mb-2">Live demo · sign in</div>
          <h1 className="serif text-[44px] leading-[1.05] tracking-tight">Who are you today?</h1>
          <p className="text-muted mt-2 max-w-2xl text-[15px] leading-relaxed">
            Every role is a real wallet on the local chain. Signing in signs a fresh challenge with that wallet’s key. Each browser tab keeps its own role, so open
            Patient, Hospital and Insurer in three windows side by side — or scan a QR to open a role on your phone.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => setScan(true)}>
          <ScanLine size={15} /> Scan a sign-in QR
        </button>
      </div>

      <div className="space-y-8">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <div className="flex items-baseline gap-3 mb-3">
              <h2 className="font-semibold text-[15px]">{g.title}</h2>
              <span className="text-[12.5px] text-muted">{g.note}</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {all
                .filter((i) => g.kinds.includes(i.kind))
                .map((i) => {
                  const m = KIND_META[i.kind];
                  const addr = i.role ? d.accounts[i.role]?.address : null;
                  return (
                    <div key={i.id} className="card p-4 flex flex-col gap-3 hover:border-text/40 transition group" style={{ boxShadow: `inset 3px 0 0 ${m.color}` }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: m.color }}>
                            {m.label}
                          </div>
                          <div className="font-semibold text-[15.5px] leading-snug mt-0.5">{i.name}</div>
                          <div className="text-[12.5px] text-muted">{i.sub}</div>
                        </div>
                        <button className="text-muted hover:text-fg p-1" title="Open on another device" onClick={() => setQrFor(i)}>
                          <QrCode size={17} />
                        </button>
                      </div>
                      <div className="text-[12px] text-muted leading-snug flex-1">{m.blurb}</div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="mono text-[11px] text-muted inline-flex items-center gap-1">
                          <KeyRound size={11} /> {addr ? short(addr, 4) : 'no on-chain wallet'}
                        </span>
                        <div className="flex gap-1.5">
                          <a className="btn btn-ghost !px-2.5 !py-1.5" title="Open in a new window" href={roleUrl(location.origin, i)} target="_blank" rel="noreferrer">
                            <ExternalLink size={14} />
                          </a>
                          <button className="btn btn-primary !py-1.5" onClick={() => enter(i)} disabled={!!busy}>
                            {busy === i.id ? <Spinner size={13} /> : null} Sign in <ArrowRight size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        ))}
      </div>

      {qrFor && (
        <div className="fixed inset-0 z-50 bg-text/50 grid place-items-center p-4" onClick={() => setQrFor(null)}>
          <div className="card p-6 w-[420px] max-w-full text-center" onClick={(e) => e.stopPropagation()}>
            <Smartphone className="mx-auto text-muted" />
            <div className="serif text-[26px] mt-1">Open as {qrFor.name}</div>
            <p className="text-[13px] text-muted mt-1">Scan with a phone on the same Wi-Fi. It signs in straight into this role.</p>
            <div className="mt-4">
              <QrImage value={roleUrl(base, qrFor)} size={220} label={`${KIND_META[qrFor.kind].label} · ${qrFor.name}`} />
            </div>
            <div className="mono text-[11px] text-muted mt-3 break-all">{roleUrl(base, qrFor)}</div>
            {location.protocol === 'http:' && (
              <p className="text-[11.5px] text-amber mt-3 leading-snug">
                Phones need HTTPS for WebCrypto and the camera: start with <span className="mono">HTTPS=1 ./scripts/demo.sh</span> and accept the self-signed certificate.
              </p>
            )}
          </div>
        </div>
      )}

      <QrScanner
        open={scan}
        onClose={() => setScan(false)}
        title="Scan a sign-in QR"
        hint="Point the camera at a role’s QR (the QR icon on any card) — e.g. from another laptop or a printed badge."
        onResult={(t) => {
          const m = /[?&]as=([\w-]+)/.exec(t);
          const i = m && all.find((x) => x.id === m[1]);
          if (i) enter(i);
          else alert('Not a Mohar sign-in QR.');
        }}
      />
    </div>
  );
}
