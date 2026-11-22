// Fixed-depth Poseidon2 Merkle tree. Node = H(DOM_NODE, left, right). Empty leaf = 0.
import { DOM, poseidon2 } from './hash.js';

export interface MerkleProof {
  root: bigint;
  index: number;
  path: bigint[];
}

export class MerkleTree {
  readonly depth: number;
  readonly leaves: bigint[];
  private layers: bigint[][] = [];

  private constructor(depth: number, leaves: bigint[]) {
    if (leaves.length > 2 ** depth) throw new Error('tree full');
    this.depth = depth;
    this.leaves = leaves;
  }

  static async build(depth: number, leaves: bigint[]): Promise<MerkleTree> {
    const t = new MerkleTree(depth, [...leaves]);
    await t.recompute();
    return t;
  }

  private async recompute() {
    // Precompute empty-subtree hashes so we only hash the populated part.
    const zeros: bigint[] = [0n];
    for (let i = 0; i < this.depth; i++) zeros.push(await poseidon2([DOM.NODE, zeros[i], zeros[i]]));
    let layer = [...this.leaves];
    this.layers = [layer];
    for (let d = 0; d < this.depth; d++) {
      const next: bigint[] = [];
      const width = Math.max(1, Math.ceil(layer.length / 2));
      for (let i = 0; i < width; i++) {
        const l = layer[2 * i] ?? zeros[d];
        const r = layer[2 * i + 1] ?? zeros[d];
        next.push(await poseidon2([DOM.NODE, l, r]));
      }
      if (layer.length === 0) next[0] = zeros[d + 1];
      layer = next;
      this.layers.push(layer);
      (this as any)._zeros = zeros;
    }
  }

  get root(): bigint {
    return this.layers[this.depth][0];
  }

  indexOf(leaf: bigint): number {
    return this.leaves.findIndex((l) => l === leaf);
  }

  proof(index: number): MerkleProof {
    if (index < 0 || index >= this.leaves.length) throw new Error('leaf not in tree');
    const zeros: bigint[] = (this as any)._zeros;
    const path: bigint[] = [];
    let idx = index;
    for (let d = 0; d < this.depth; d++) {
      const sib = idx ^ 1;
      path.push(this.layers[d][sib] ?? zeros[d]);
      idx >>= 1;
    }
    return { root: this.root, index, path };
  }
}
