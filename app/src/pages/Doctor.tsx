import { useState } from 'react';
import { PageHeader } from '../App';
import { Card, Chip, Empty, Spinner, useAsync } from '../components/ui';
import { FhirView } from '../components/Fhir';
import { c, events, getDemo, nameOf, revertReason } from '../lib/chain';
import { openRecord } from '../lib/flow';

export function Doctor() {
  const d = getDemo();
  const me = d.accounts.doctor.address;
  const { data } = useAsync(
    async () => {
      const ev = await events('vault', 'AccessGranted', null, me);
      const ids = [...new Set(ev.map((e) => e.args.recordId as string))];
      return Promise.all(
        ids.map(async (id) => {
          const r = await c().vault.records(id);
          const g = await c().vault.getGrant(id, me);
          return { id, owner: r.owner, kind: r.kind, can: await c().vault.canAccess(id, me), expiresAt: Number(g.expiresAt) };
        }),
      );
    },
    [],
    4000,
  );
  const [doc, setDoc] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});

  return (
    <div className="space-y-6">
      <PageHeader icon="" title={d.names.doctor} sub="Sees only what patients share, only while the grant lasts. Opening a record writes an audit entry on-chain first." />
      <Card title="Shared with me">
        {!data?.length && <Empty>No patient has shared a record yet. Share one from  Vault.</Empty>}
        <div className="space-y-3">
          {(data ?? []).map((r) => (
            <div key={r.id} className="rounded-xl border border-line p-4">
              <div className="flex justify-between items-center flex-wrap gap-3">
                <div>
                  <div className="font-semibold">
                    {nameOf(r.owner)} · <span className="capitalize">{r.kind}</span>
                  </div>
                  <div className="text-xs text-muted">{r.can ? `access until ${new Date(r.expiresAt * 1000).toLocaleString('en-IN')}` : 'access revoked or expired'}</div>
                </div>
                <div className="flex gap-2 items-center">
                  <Chip tone={r.can ? 'mint' : 'rose'}>{r.can ? 'active' : 'no access'}</Chip>
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      setBusy(r.id);
                      setErr({ ...err, [r.id]: '' });
                      try {
                        setDoc({ ...doc, [r.id]: await openRecord('doctor', r.id, 'clinical review') });
                      } catch (e) {
                        setErr({ ...err, [r.id]: revertReason(e) });
                        setDoc({ ...doc, [r.id]: null });
                      }
                      setBusy('');
                    }}
                  >
                    {busy === r.id ? <Spinner /> : ''} Open (logged)
                  </button>
                </div>
              </div>
              {err[r.id] && <div className="text-sm text-rose mt-2"> Blocked: {err[r.id]}</div>}
              {doc[r.id] && <div className="mt-3"><FhirView bundle={doc[r.id]} /></div>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
