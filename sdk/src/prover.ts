// Proof generation with noir_js (witness) + bb.js UltraHonk (proof), targeting the EVM verifier.
import { Noir } from '@noir-lang/noir_js';
import { UltraHonkBackend } from '@aztec/bb.js';
import { getBarretenberg } from './hash.js';

export interface ProofResult {
  proof: Uint8Array;
  publicInputs: string[];
  witnessMs: number;
  proveMs: number;
}

export class ClaimProver {
  private noir: Noir;
  private backend: UltraHonkBackend | null = null;
  constructor(private circuit: { bytecode: string; abi: any }) {
    this.noir = new Noir(circuit as any);
  }

  private async be() {
    if (!this.backend) this.backend = new UltraHonkBackend(this.circuit.bytecode, await getBarretenberg());
    return this.backend;
  }

  /** Runs the circuit on the inputs. Throws with the failing assertion message if a statement is false. */
  async witness(input: Record<string, unknown>) {
    const { witness } = await this.noir.execute(input as any);
    return witness;
  }

  async prove(input: Record<string, unknown>): Promise<ProofResult> {
    const t0 = performance.now();
    const witness = await this.witness(input);
    const t1 = performance.now();
    const be = await this.be();
    const { proof, publicInputs } = await be.generateProof(witness, { verifierTarget: 'evm' });
    const t2 = performance.now();
    return { proof, publicInputs, witnessMs: t1 - t0, proveMs: t2 - t1 };
  }

  async verify(p: ProofResult) {
    return (await this.be()).verifyProof({ proof: p.proof, publicInputs: p.publicInputs }, { verifierTarget: 'evm' });
  }
}

/** Pull the human-readable reason out of a noir_js execution error. */
export function circuitFailureReason(e: unknown): string {
  const msg = (e as any)?.message ?? String(e);
  const m = msg.match(/Circuit execution failed: (.*)/) ?? msg.match(/Failed constraint:? (.*)/) ?? msg.match(/'(.+?)'/);
  return (m ? m[1] : msg).toString().slice(0, 200);
}
