import { ClaimProver, HOSP_DEPTH, MerkleTree, toHex32 } from '@kavach/sdk';
import { c } from './chain';

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
  return (await r.json()).cid;
}
export async function ipfsGet(cid: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch('/api/ipfs/' + cid)).arrayBuffer());
}
