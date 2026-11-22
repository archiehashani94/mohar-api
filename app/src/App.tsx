import { ReactNode, useEffect, useState } from 'react';
import { Building2, FlaskConical, Hospital, Landmark, Play, ScanEye, ScrollText, Siren, Smartphone, Stethoscope } from 'lucide-react';
import { Story } from './pages/Story';
import { Vault } from './pages/Vault';
import { Seal } from './pages/Seal';
import { Doctor } from './pages/Doctor';
import { BlindDesk } from './pages/BlindDesk';
import { RegulatorPage } from './pages/Regulator';
import { Emergency } from './pages/Emergency';
import { AttackLab } from './pages/AttackLab';
import { XRay } from './pages/XRay';

const ROLES = [
  { id: 'vault', label: 'Patient', icon: Smartphone, color: '#5b3fd6' },
  { id: 'seal', label: 'Hospital', icon: Hospital, color: '#0f7c86' },
  { id: 'desk', label: 'Insurer', icon: Landmark, color: '#16181d' },
  { id: 'doctor', label: 'Doctor', icon: Stethoscope, color: '#1f8a4c' },
  { id: 'regulator', label: 'Regulator', icon: ScrollText, color: '#b7791f' },
  { id: 'emergency', label: 'Emergency', icon: Siren, color: '#d8432b' },
] as const;
const SECURITY = [
  { id: 'attack', label: 'Attack Lab', icon: FlaskConical },
  { id: 'xray', label: 'X-Ray', icon: ScanEye },
] as const;
const ALL = ['story', ...ROLES.map((r) => r.id), ...SECURITY.map((r) => r.id)] as const;
type Page = (typeof ALL)[number];
const pageFromHash = (): Page => (ALL.find((n) => '#/' + n === location.hash) ?? 'story') as Page;

export function App() {
  const [page, setPage] = useState<Page>(pageFromHash());
  useEffect(() => {
    const f = () => setPage(pageFromHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const go = (p: string) => (location.hash = '/' + p);
  const group = page === 'story' ? 'story' : SECURITY.some((s) => s.id === page) ? 'security' : 'roles';
  const lab = group === 'security';
  const role = ROLES.find((r) => r.id === page);

  return (
    <div className={`min-h-screen ${lab ? 'lab' : ''}`}>
      <header className="sticky top-0 z-40 h-[57px] border-b border-line bg-ink/85 backdrop-blur flex items-center px-6 gap-6">
        <button onClick={() => go('story')} className="flex items-center gap-2.5 shrink-0">
          <Logo />
          <span className="serif text-[22px] leading-none tracking-tight">Kavach</span>
        </button>
        <nav className="flex items-center gap-1 p-1 rounded-xl border border-line bg-panel shrink-0">
          <Seg on={group === 'story'} onClick={() => go('story')} icon={<Play size={14} />}>
            Story
          </Seg>
          <Seg on={group === 'roles'} onClick={() => go(role?.id ?? 'vault')} icon={<Building2 size={14} />}>
            Roles
          </Seg>
          <Seg on={group === 'security'} onClick={() => go(lab ? page : 'attack')} icon={<FlaskConical size={14} />}>
            Proof &amp; Security
          </Seg>
        </nav>
        <div className="flex items-center gap-1 overflow-x-auto">
          {group === 'roles' &&
            ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => go(r.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] transition ${page === r.id ? 'bg-panel border border-line font-semibold' : 'text-muted hover:text-fg'}`}
                style={page === r.id ? { boxShadow: `inset 3px 0 0 ${r.color}` } : undefined}
              >
                <r.icon size={14} strokeWidth={1.7} /> {r.label}
              </button>
            ))}
          {group === 'security' &&
            SECURITY.map((r) => (
              <button
                key={r.id}
                onClick={() => go(r.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] ${page === r.id ? 'bg-panel border border-line font-semibold' : 'text-muted hover:text-fg'}`}
              >
                <r.icon size={14} strokeWidth={1.7} /> {r.label}
              </button>
            ))}
        </div>
        <div className="ml-auto text-[11px] text-muted mono hidden xl:block">Noir · UltraHonk · EVM · IPFS · Anon Aadhaar</div>
      </header>
      {page === 'story' ? (
        <Story go={go} />
      ) : (
        <main className="px-6 md:px-10 py-8">
          <div className="max-w-6xl mx-auto">
            {page === 'vault' && <Vault />}
            {page === 'seal' && <Seal />}
            {page === 'doctor' && <Doctor />}
            {page === 'desk' && <BlindDesk />}
            {page === 'regulator' && <RegulatorPage />}
            {page === 'emergency' && <Emergency />}
            {page === 'attack' && <AttackLab />}
            {page === 'xray' && <XRay />}
          </div>
        </main>
      )}
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

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <rect width="100" height="100" rx="24" fill="var(--color-text)" />
      <rect x="10" y="40" width="80" height="20" rx="4" fill="var(--color-ink)" />
      <path d="M84 50 L96 41 M84 50 L96 60" stroke="var(--color-ink)" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

const ICONS: Record<string, any> = { '🗝': Smartphone, '🏥': Hospital, '👁': Landmark, '🩺': Stethoscope, '⚖': ScrollText, '🚑': Siren, '🧪': FlaskConical, '🩻': ScanEye };

export function PageHeader({ icon, title, sub, right }: { icon: ReactNode; title: string; sub: string; right?: ReactNode }) {
  const BY_PAGE: Record<string, any> = { vault: Smartphone, seal: Hospital, desk: Landmark, doctor: Stethoscope, regulator: ScrollText, emergency: Siren, attack: FlaskConical, xray: ScanEye };
  const I = typeof icon === 'string' ? (ICONS[icon] ?? BY_PAGE[location.hash.slice(2)]) : null;
  return (
    <header className="flex items-end justify-between gap-6 mb-8 flex-wrap">
      <div className="flex gap-4 items-start">
        <div className="w-11 h-11 rounded-xl border border-line bg-panel grid place-items-center shrink-0 mt-1">{I ? <I size={20} strokeWidth={1.6} /> : icon}</div>
        <div>
          <h1 className="serif text-[40px] leading-[1.05] tracking-tight">{title}</h1>
          <p className="text-muted mt-1.5 max-w-2xl text-[15px] leading-relaxed">{sub}</p>
        </div>
      </div>
      {right}
    </header>
  );
}
