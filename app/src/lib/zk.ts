import { ClaimProver, HOSP_DEPTH, MerkleTree, toHex32 } from '@kavach/sdk';
import { c } from './chain';
import { kb, trace } from './trace';

let prover: ClaimProver | null = null;
export async function getProver() {
  if (!prover) prover = new ClaimProver(await (await fetch('/claim.json')).json());
  return prover;
}

/** Rebuild the approved-hospital tree from chain and check it equals the published root. */
export async function hospitalTree() {
  const leaves: string[] = await c().regulator.approvedLeaves();
  const tree = await MerkleTree.build(HOSP_DEPTH, leaves.map((l) => BigInt(l)));
  const onchain: string = await c().regulator.currentRoot();
  trace({ kind: 'zk', title: 'Rebuilt approved-hospital Merkle tree', detail: `${leaves.length} licensed leaves · root ${toHex32(tree.root).slice(0, 12)}… ${toHex32(tree.root) === onchain ? '= on-chain root ✓' : '≠ on-chain root ✗'}`, vis: 'private' });
  return { tree, onchain, matches: toHex32(tree.root) === onchain };
}

export function claimStruct(pub: any) {
  return {
    hospitalRoot: toHex32(pub.hospitalRoot),
    policyCommitment: toHex32(pub.policyCommitment),
    nullifier: toHex32(pub.nullifier),
    claimDate: pub.claimDate,
    usedBefore: pub.usedBefore,
    payoutAmount: pub.payoutAmount,
    payoutRecipient: pub.payoutRecipient,
  };
}

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch('/api' + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

export async function ipfsPut(bytes: Uint8Array): Promise<string> {
  const r = await fetch('/api/ipfs', { method: 'PUT', body: bytes as BodyInit });
  const cid = (await r.json()).cid;
  trace({ kind: 'ipfs', title: 'Pinned ciphertext to IPFS', detail: `ipfs://${cid.slice(0, 20)}… · ${kb(bytes.length)} · AES-GCM, unreadable without the key`, wire: `${kb(bytes.length)} ciphertext`, vis: 'sealed' });
  return cid;
}
export async function ipfsGet(cid: string): Promise<Uint8Array> {
  const b = new Uint8Array(await (await fetch('/api/ipfs/' + cid)).arrayBuffer());
  trace({ kind: 'ipfs', title: 'Fetched ciphertext from IPFS', detail: `ipfs://${cid.slice(0, 20)}… · ${kb(b.length)}` });
  return b;
}
