import { ReactNode, useEffect, useState } from 'react';
import { Check as CheckIcon, Globe, Lock, X as XIcon } from 'lucide-react';

export function Card({ title, sub, right, children, className = '', icon }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || right) && (
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex gap-3">
            {icon && <div className="mt-0.5 text-muted">{icon}</div>}
            <div>
              {title && <h3 className="font-semibold text-[15px] tracking-tight">{title}</h3>}
              {sub && <p className="text-[13px] text-muted mt-0.5 leading-relaxed">{sub}</p>}
            </div>
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

const tones: Record<string, string> = {
  violet: 'bg-violet/10 text-violet',
  mint: 'bg-mint/10 text-mint',
  rose: 'bg-rose/10 text-rose',
  amber: 'bg-amber/12 text-amber',
  sky: 'bg-sky/10 text-sky',
  gray: 'bg-text/5 text-muted',
  ink: 'bg-text text-ink',
};
export const Chip = ({ tone = 'gray', children }: { tone?: string; children: ReactNode }) => <span className={`chip ${tones[tone]}`}>{children}</span>;

/** Lock (private) / Globe (public) provenance tag. */
export function Tag({ kind }: { kind: 'private' | 'public' }) {
  return kind === 'private' ? (
    <span className="chip bg-violet/10 text-violet">
      <Lock size={11} strokeWidth={2.2} /> private
    </span>
  ) : (
    <span className="chip bg-sky/10 text-sky">
      <Globe size={11} strokeWidth={2.2} /> public
    </span>
  );
}

/** An ink bar the width of the hidden text. */
export function Redacted({ text, show = false, hint }: { text: string; show?: boolean; hint?: string }) {
  if (show) return <span className="sweep">{text}</span>;
  return (
    <span className="redact px-1 sweep" title={hint ?? 'hidden'}>
      {text}
    </span>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  const color = tone === 'mint' ? 'text-mint' : tone === 'rose' ? 'text-rose' : tone === 'violet' ? 'text-violet' : tone === 'sky' ? 'text-sky' : '';
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`serif text-[28px] leading-tight mt-1 tracking-tight ${color}`}>{value}</div>
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="label mb-1.5">{label}</div>
      {children}
    </label>
  );
}

export function Hex({ v, n = 6, tone = 'sky' }: { v: string; n?: number; tone?: string }) {
  const s = v && v.length > 2 * n + 2 ? `${v.slice(0, n + 2)}…${v.slice(-n)}` : v;
  return (
    <span className={`mono text-[12.5px] ${tone === 'sky' ? 'text-sky' : 'text-muted'}`} title={v}>
      {s}
    </span>
  );
}

export function Check({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13.5px]">
      <span className={`w-[18px] h-[18px] shrink-0 grid place-items-center rounded-full ${ok === null ? 'bg-text/5 text-muted' : ok ? 'bg-mint/15 text-mint' : 'bg-rose/15 text-rose'}`}>
        {ok === null ? <span className="w-1 h-1 rounded-full bg-current" /> : ok ? <CheckIcon size={11} strokeWidth={3} /> : <XIcon size={11} strokeWidth={3} />}
      </span>
      <span className={ok === false ? 'text-rose' : ''}>{children}</span>
    </div>
  );
}

export function Spinner({ size = 15 }: { size?: number }) {
  return <span style={{ width: size, height: size }} className="inline-block border-2 border-current/25 border-t-current rounded-full animate-spin" />;
}

export function useAsync<T>(fn: () => Promise<T>, deps: any[] = [], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fn()
      .then((d) => alive && (setData(d), setErr(null)))
      .catch((e) => alive && setErr(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(() => setTick((x) => x + 1), pollMs);
    return () => clearInterval(t);
  }, [pollMs]);
  return { data, err, reload: () => setTick((x) => x + 1) };
}

export function Timer({ running, ms }: { running: boolean; ms?: number }) {
  const [t0] = useState(() => performance.now());
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => setNow(performance.now()), 50);
    return () => clearInterval(i);
  }, [running]);
  const v = ms ?? now - t0;
  return <span className="mono">{(v / 1000).toFixed(2)}s</span>;
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-sm text-muted boundary p-6 text-center">
      {children}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Steps({ steps }: { steps: { label: string; state: 'todo' | 'doing' | 'done' | 'fail'; detail?: ReactNode }[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3 items-start fade-in">
          <span
            className={`mt-0.5 w-6 h-6 shrink-0 grid place-items-center rounded-full text-[11px] font-semibold border ${
              s.state === 'done'
                ? 'bg-mint/12 text-mint border-mint/30'
                : s.state === 'doing'
                  ? 'bg-text text-ink border-text pulse'
                  : s.state === 'fail'
                    ? 'bg-rose/10 text-rose border-rose/30'
                    : 'text-muted border-line'
            }`}
          >
            {s.state === 'done' ? <CheckIcon size={12} strokeWidth={3} /> : s.state === 'fail' ? <XIcon size={12} strokeWidth={3} /> : i + 1}
          </span>
          <div className="text-sm">
            <div className={s.state === 'todo' ? 'text-muted' : 'font-medium'}>{s.label}</div>
            {s.detail && <div className="text-xs text-muted mt-0.5">{s.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Count-up animation for amounts (the payoff moment). */
export function CountUp({ to, format, ms = 900 }: { to: number; format: (n: number) => string; ms?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <>{format(v)}</>;
}
