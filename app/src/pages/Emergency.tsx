import { useState } from 'react';
import { getBytes, hexlify, toUtf8Bytes, keccak256 } from 'ethers';
import { combineShares, openJSON, unwrapKey, wrapKey } from '@kavach/sdk';
import { PageHeader } from '../App';
import { Card, Chip, Empty, Field, Spinner, useAsync } from '../components/ui';
import { FhirView } from '../components/Fhir';
import { c, getDemo, nameOf, revertReason, Role } from '../lib/chain';
import { ipfsGet } from '../lib/zk';

const dec = (b: string) => JSON.parse(new TextDecoder().decode(getBytes(b)));

async function allRequests() {
  const n = Number(await c().breakGlass.requestCount());
  return Promise.all(
    [...Array(n).keys()].map(async (i) => {
      const r = (await c().breakGlass.requests(i)).toObject();
      return { id: i, ...r, approvers: (await c().breakGlass.approversOf(i)) as string[] };
    }),
  );
}

export function Emergency() {
  const d = getDemo();
  const { data, reload } = useAsync(allRequests, [], 3000);
  const [reason, setReason] = useState('Unconscious after road accident on NH-53, suspected internal bleeding');
  const [busy, setBusy] = useState('');
  const [cards, setCards] = useState<Record<number, any>>({});
  const [msg, setMsg] = useState<Record<number, string>>({});

  async function act(k: string, fn: () => Promise<any>) {
    setBusy(k);
    try {
      await fn();
    } catch (e) {
      alert(revertReason(e));
    }
    setBusy('');
    reload();
  }

  const responder = d.accounts.responder;

  async function requestAccess() {
    await (await c('responder').breakGlass.request(d.accounts.patient.address, hexlify(await c().vault.encryptionKey(responder.address)), reason, 'CG-108-AMB-0417')).wait();
  }

  async function approve(g: Role, req: any) {
    const setup = await c().breakGlass.getSetup(req.patient);
    const idx = setup.guardians.findIndex((x: string) => x.toLowerCase() === d.accounts[g].address.toLowerCase());
    const mine = dec(setup.wrappedShares[idx]);
    const share = await unwrapKey(mine.w, d.accounts[g].privateKey); // only this guardian can do this
    const forResponder = await wrapKey(share, hexlify(req.responderPubKey));
    await (await c(g).breakGlass.approve(req.id, toUtf8Bytes(JSON.stringify({ x: mine.x, w: forResponder })))).wait();
  }

  async function openCard(req: any) {
    const shares: { x: number; y: string }[] = [];
    for (const g of req.approvers) {
      const s = dec(await c().breakGlass.responderShares(req.id, g));
      shares.push({ x: s.x, y: hexlify(await unwrapKey(s.w, responder.privateKey)) });
    }
    if (shares.length < 2) {
      setMsg({ ...msg, [req.id]: `Holding ${shares.length} of 2 shares. With one Shamir share the key is information-theoretically hidden, so there is nothing to decrypt yet.` });
      return;
    }
    const key = combineShares(shares.slice(0, 2));
    await (await c('responder').breakGlass.logView(req.id)).wait();
    const setup = await c().breakGlass.getSetup(req.patient);
    const rec = await c().vault.records(setup.emergencyRecordId);
    const bytes = await ipfsGet(rec.cid);
    if (keccak256(bytes) !== rec.contentHash) throw new Error('content hash mismatch');
    setCards({ ...cards, [req.id]: await openJSON(key, JSON.parse(new TextDecoder().decode(bytes))) });
    setMsg({ ...msg, [req.id]: '' });
  }

  const reqs = (data ?? []).slice().reverse();

  return (
    <div className="space-y-6">
      <PageHeader
        icon=""
        title="Break-glass emergency access"
        sub="Asha is unconscious. A paramedic scans the QR on her phone. Her emergency card's key is split 2-of-3 among her guardians. Any two can release it, and every step is logged on-chain."
      />
      <div className="grid lg:grid-cols-2 gap-6">
        <Card title={` ${d.names.responder}`} sub="Responder device">
          <Field label="Reason (written on-chain)">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <button className="btn btn-primary mt-3" onClick={() => act('req', requestAccess)}>
            {busy === 'req' ? <Spinner /> : ''} Scan Asha's emergency QR & request access
          </button>
          <div className="space-y-3 mt-5">
            {reqs.filter((r) => r.responder.toLowerCase() === responder.address.toLowerCase()).length === 0 && <Empty>No requests yet.</Empty>}
            {reqs
              .filter((r) => r.responder.toLowerCase() === responder.address.toLowerCase())
              .map((r) => (
                <div key={r.id} className="rounded-xl border border-line p-4">
                  <div className="flex justify-between items-center gap-2">
                    <div className="text-sm"> Request #{r.id} · {nameOf(r.patient)}
                    </div>
                    <Chip tone={r.unlocked ? 'mint' : 'amber'}>{r.unlocked ? 'unlocked · 24h' : `${Number(r.approvals)}/2 guardians`}</Chip>
                  </div>
                  <button className="btn btn-ghost mt-3" onClick={() => act('o' + r.id, () => openCard(r))}>
                    {busy === 'o' + r.id ? <Spinner /> : ''} Reconstruct key & open card
                  </button>
                  {msg[r.id] && <div className="text-sm text-amber mt-2">{msg[r.id]}</div>}
                  {cards[r.id] && <div className="mt-3"><FhirView bundle={cards[r.id]} /></div>}
                </div>
              ))}
          </div>
        </Card>
        <div className="space-y-4">
          {(['guardian1', 'guardian2', 'guardian3'] as Role[]).map((g) => {
            const pending = reqs.filter((r) => !r.approvers.map((a: string) => a.toLowerCase()).includes(d.accounts[g].address.toLowerCase()));
            return (
              <Card key={g} title={` ${d.names[g]}`} sub="Guardian phone · holds 1 of 3 key shares">
                {pending.length === 0 ? (
                  <div className="text-sm text-muted">Nothing to approve.</div>
                ) : (
                  pending.map((r) => (
                    <div key={r.id} className="flex justify-between items-center gap-3 text-sm border-t border-line pt-3 first:border-0 first:pt-0">
                      <div>
                        <b>{nameOf(r.responder)}</b> wants {nameOf(r.patient).split(' ')[0]}'s emergency card
                        <div className="text-muted text-xs">“{r.reason}” · {r.responderId}</div>
                      </div>
                      <button className="btn btn-primary !py-1.5" onClick={() => act(g + r.id, () => approve(g, r))}>
                        {busy === g + r.id ? <Spinner /> : 'Release my share'}
                      </button>
                    </div>
                  ))
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
