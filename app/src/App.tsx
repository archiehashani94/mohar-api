import { ReactNode, useEffect, useState } from 'react';
import { ChevronDown, Cpu, ExternalLink, FlaskConical, ListChecks, LogOut, PanelRightClose, PanelRightOpen, Play, QrCode, ScanEye, Users } from 'lucide-react';
import { Story } from './pages/Story';
import { Vault } from './pages/Vault';
import { Seal } from './pages/Seal';
import { Provider } from './pages/Doctor';
import { BlindDesk } from './pages/BlindDesk';
import { RegulatorPage } from './pages/Regulator';
import { Responder, GuardianPage } from './pages/Emergency';
import { AttackLab } from './pages/AttackLab';
import { XRay } from './pages/XRay';
import { Login, appBase, roleUrl, useLan } from './pages/Login';
import { ActivityLog, useTrace } from './components/Activity';
import { DemoGuide } from './components/DemoGuide';
import { QrImage } from './components/Qr';
import { identities, Identity, KIND_META, Kind, setIdentity, signIn, useIdentity } from './lib/session';
import { getDemo, short } from './lib/chain';

const ROLE_PAGES: Record<string, Kind[]> = {
  vault: ['patient'],
  seal: ['hospital'],
  desk: ['insurer'],
  provider: ['doctor', 'lab', 'pharmacy'],
  regulator: ['regulator'],
  responder: ['responder'],
  guardian: ['guardian'],
};
const ALIASES: Record<string, string> = { doctor: 'provider', emergency: 'responder', roles: 'login' };
const SECURITY = [
  { id: 'attack', label: 'Attack Lab', icon: FlaskConical },
  { id: 'xray', label: 'X-Ray', icon: ScanEye },
] as const;
const ALL = ['story', 'login', ...Object.keys(ROLE_PAGES), 'attack', 'xray'];
const pageFromHash = (): string => {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  const p = ALIASES[h] ?? h;
  return ALL.includes(p) ? p : 'story';
};


export function App() {
  const [page, setPage] = useState<string>(pageFromHash());
  const me = useIdentity();
  const [panel, setPanel] = useState(() => {
    try {
      return localStorage.getItem('kavach.panel') !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    const f = () => setPage(pageFromHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const go = (p: string) => (location.hash = '/' + p);
  const isRolePage = page in ROLE_PAGES;
  const group = page === 'story' ? 'story' : SECURITY.some((s) => s.id === page) ? 'security' : 'live';
  const lab = group === 'security';
  const togglePanel = () => {
    setPanel(!panel);
    try {
      localStorage.setItem('kavach.panel', panel ? '0' : '1');
    } catch {}
  };

  // Role guard: a role screen needs a signed-in identity of the right kind.
  let body: ReactNode;
  if (page === 'story') body = <Story go={go} />;
  else if (page === 'login' || (isRolePage && !me)) body = <Login go={go} />;
  else if (isRolePage && me && !ROLE_PAGES[page].includes(me.kind)) body = <WrongRole me={me} page={page} go={go} />;
  else
    body = (
      <>
        {page === 'vault' && <Vault />}
        {page === 'seal' && <Seal />}
        {page === 'provider' && <Provider />}
        {page === 'desk' && <BlindDesk />}
        {page === 'regulator' && <RegulatorPage />}
        {page === 'responder' && <Responder />}
        {page === 'guardian' && <GuardianPage />}
        {page === 'attack' && <AttackLab />}
        {page === 'xray' && <XRay />}
      </>
    );

  const showPanel = group === 'live' && panel;

  return (
    <div className={`min-h-screen ${lab ? 'lab' : ''}`}>
      <header className="sticky top-0 z-40 h-[57px] border-b border-line bg-ink/85 backdrop-blur flex items-center px-5 gap-4">
        <button onClick={() => go('story')} className="flex items-center gap-2.5 shrink-0">
          <Logo />
          <span className="serif text-[22px] leading-none tracking-tight">Mohar</span>
        </button>
        <nav className="flex items-center gap-1 p-1 rounded-xl border border-line bg-panel shrink-0">
          <Seg on={group === 'story'} onClick={() => go('story')} icon={<Play size={14} />}>
            Story
          </Seg>
          <Seg on={group === 'live'} onClick={() => go(me ? me.page : 'login')} icon={<Users size={14} />}>
            Live demo
          </Seg>
          <Seg on={group === 'security'} onClick={() => go(lab ? page : 'attack')} icon={<FlaskConical size={14} />}>
            Security lab
          </Seg>
        </nav>
        {group === 'security' && (
          <div className="flex items-center gap-1">
            {SECURITY.map((r) => (
              <button
                key={r.id}
                onClick={() => go(r.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] ${page === r.id ? 'bg-panel border border-line font-semibold' : 'text-muted hover:text-fg'}`}
              >
                <r.icon size={14} strokeWidth={1.7} /> {r.label}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {group === 'live' && (
            <button className="btn btn-ghost !py-1.5 !px-2.5 !text-[12.5px]" onClick={togglePanel} title="Demo guide & what's happening under the hood">
              {panel ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />} {panel ? 'Hide' : 'Guide & activity'}
            </button>
          )}
          {me ? <RoleChip me={me} go={go} /> : group === 'live' ? null : (
            <button className="btn btn-ghost !py-1.5 !text-[12.5px]" onClick={() => go('login')}>
              Sign in
            </button>
          )}
        </div>
      </header>
      {page === 'story' ? (
        body
      ) : (
        <div className={`flex ${showPanel ? '' : ''}`}>
          <main className="flex-1 min-w-0 px-6 md:px-10 py-8">
            <div className="max-w-6xl mx-auto">{body}</div>
          </main>
          {showPanel && <SidePanel go={go} />}
        </div>
      )}
    </div>
  );
}

function SidePanel({ go }: { go: (p: string) => void }) {
  const [tab, setTab] = useState<'guide' | 'hood'>('guide');
  const ev = useTrace();
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    if (tab === 'hood') setSeen(ev.length);
  }, [tab, ev.length]);
  const unread = tab === 'guide' ? ev.length - seen : 0;
  return (
    <aside className="w-[340px] shrink-0 border-l border-line bg-panel/70 sticky top-[57px] h-[calc(100vh-57px)] flex flex-col">
      <div className="flex p-2 gap-1 border-b border-line">
        <button onClick={() => setTab('guide')} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12.5px] ${tab === 'guide' ? 'bg-text text-ink font-semibold' : 'text-muted hover:text-fg'}`}>
          <ListChecks size={14} /> Demo guide
        </button>
        <button onClick={() => setTab('hood')} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12.5px] ${tab === 'hood' ? 'bg-text text-ink font-semibold' : 'text-muted hover:text-fg'}`}>
          <Cpu size={14} /> Under the hood
          {unread > 0 && <span className="chip bg-violet text-white !py-0 !px-1.5 !text-[10px]">{unread}</span>}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {tab === 'guide' ? (
          <>
            <p className="text-[12px] text-muted mb-2 leading-snug">The full workflow, step by step. Ticks come from the live chain. Each step tells you which role to sign in as.</p>
            <DemoGuide go={go} />
          </>
        ) : (
          <>
            <p className="text-[12px] text-muted mb-3 leading-snug">
              Every real operation in this tab — encryption, IPFS, proofs, transactions — and whether its data <b className="text-violet">stays on the device</b>,{' '}
              <b className="text-amber">leaves encrypted</b> or is <b className="text-sky">public</b>.
            </p>
            <ActivityLog empty="Do something in this role — it shows up here." />
          </>
        )}
      </div>
    </aside>
  );
}

function RoleChip({ me, go }: { me: Identity; go: (p: string) => void }) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState(false);
  const lan = useLan();
  const m = KIND_META[me.kind];
  const d = getDemo();
  const addr = me.role ? d.accounts[me.role]?.address : null;
  const quick = identities().filter((i) => ['patient', 'hospital-1', 'insurer', 'doctor', 'lab', 'pharmacy', 'regulator', 'responder', 'guardian1', 'guardian2', 'patient2'].includes(i.id));
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 pl-2.5 pr-2 py-1 rounded-xl border border-line bg-panel hover:border-text/40" style={{ boxShadow: `inset 3px 0 0 ${m.color}` }}>
        <div className="text-left leading-tight">
          <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: m.color }}>
            {m.label}
          </div>
          <div className="text-[12.5px] font-semibold max-w-[200px] truncate">{me.name}</div>
        </div>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 z-50 card p-2 w-[300px] shadow-xl">
            <div className="px-2 py-1.5 text-[11.5px] text-muted">
              Signed in{addr ? <> · wallet <span className="mono">{short(addr, 4)}</span></> : ' · no on-chain wallet (hospital staff key)'}
            </div>
            <div className="flex gap-1 px-1 pb-2 border-b border-line">
              <button className="btn btn-ghost !py-1 !px-2 !text-[12px] flex-1 justify-center" onClick={() => (setQr(true), setOpen(false))}>
                <QrCode size={13} /> On phone
              </button>
              <a className="btn btn-ghost !py-1 !px-2 !text-[12px] flex-1 justify-center" href={roleUrl(location.origin, me)} target="_blank" rel="noreferrer">
                <ExternalLink size={13} /> New window
              </a>
              <button
                className="btn btn-ghost !py-1 !px-2 !text-[12px]"
                title="Sign out"
                onClick={() => {
                  setIdentity(null);
                  setOpen(false);
                  go('login');
                }}
              >
                <LogOut size={13} />
              </button>
            </div>
            <div className="label px-2 pt-2 pb-1">Switch role</div>
            <div className="max-h-[50vh] overflow-auto">
              {quick.map((i) => (
                <button
                  key={i.id}
                  className={`w-full text-left px-2 py-1.5 rounded-lg hover:bg-panel2 flex items-center gap-2 text-[12.5px] ${i.id === me.id ? 'bg-panel2' : ''}`}
                  onClick={async () => {
                    setOpen(false);
                    await signIn(i);
                    go(i.page);
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: KIND_META[i.kind].color }} />
                  <span className="font-medium truncate">{i.name}</span>
                  <span className="ml-auto text-[10.5px] text-muted">{KIND_META[i.kind].label}</span>
                </button>
              ))}
              <button className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-panel2 text-[12.5px] text-muted" onClick={() => (setOpen(false), go('login'))}>
                All roles…
              </button>
            </div>
          </div>
        </>
      )}
      {qr && (
        <div className="fixed inset-0 z-50 bg-text/50 grid place-items-center p-4" onClick={() => setQr(false)}>
          <div className="card p-6 text-center w-[380px]" onClick={(e) => e.stopPropagation()}>
            <div className="serif text-[24px]">Open as {me.name}</div>
            <div className="mt-3">
              <QrImage value={roleUrl(appBase(lan), me)} size={220} label={me.name} />
            </div>
            <div className="mono text-[11px] text-muted mt-2 break-all">{roleUrl(appBase(lan), me)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function WrongRole({ me, page, go }: { me: Identity; page: string; go: (p: string) => void }) {
  const want = ROLE_PAGES[page];
  const options = identities().filter((i) => want.includes(i.kind));
  return (
    <div className="max-w-xl mx-auto card p-6 mt-10 text-center">
      <div className="serif text-[28px]">This screen belongs to the {want.map((k) => KIND_META[k].label).join(' / ')}</div>
      <p className="text-muted mt-2 text-[14px]">
        You’re signed in as <b>{me.name}</b> ({KIND_META[me.kind].label}). Each role only sees its own app — that’s the point.
      </p>
      <div className="flex flex-wrap gap-2 justify-center mt-5">
        <button className="btn btn-ghost" onClick={() => go(me.page)}>
          Back to my screen
        </button>
        {options.slice(0, 3).map((i) => (
          <button key={i.id} className="btn btn-primary" onClick={async () => (await signIn(i), go(i.page))}>
            Sign in as {i.name.split(' (')[0]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Seg({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition whitespace-nowrap ${on ? 'bg-text text-ink' : 'text-muted hover:text-fg'}`}>
      {icon}
      {children}
    </button>
  );
}

/** Mohar mark: a wax seal (scalloped) with a redaction bar across it — proven, but sealed. */
export function Logo({ size = 30 }: { size?: number }) {
  let d = '';
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const r = 46 + 3.4 * Math.cos(a * 14);
    d += `${i ? 'L' : 'M'}${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <path d={d + 'Z'} fill="var(--color-text)" />
      <circle cx="50" cy="50" r="34" fill="none" stroke="#c9a227" strokeWidth="3" />
      <rect x="22" y="43" width="56" height="14" rx="3" fill="var(--color-ink)" />
    </svg>
  );
}

export function PageHeader({ icon, title, sub, right }: { icon?: ReactNode; title: string; sub: string; right?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-6 mb-7 flex-wrap">
      <div className="flex gap-4 items-start">
        {icon && typeof icon !== 'string' && <div className="w-11 h-11 rounded-xl border border-line bg-panel grid place-items-center shrink-0 mt-1">{icon}</div>}
        <div>
          <h1 className="serif text-[38px] leading-[1.05] tracking-tight">{title}</h1>
          <p className="text-muted mt-1.5 max-w-2xl text-[15px] leading-relaxed">{sub}</p>
        </div>
      </div>
      {right}
    </header>
  );
}
