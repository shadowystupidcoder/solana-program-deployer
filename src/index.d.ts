import { Connection, Keypair, PublicKey } from "@solana/web3.js";

export class Deployer {
  constructor(connection: Connection, payerKeypair: Keypair);

  deploy(programPath: string, customProgramIdKeypair?: Keypair, jitoTipLamports?: number): Promise<{
    programId: string;
    programDataAccount: string;
    signature: string;
  }>;

  closeBuffers(): Promise<void>;
}

export default Deployer;
