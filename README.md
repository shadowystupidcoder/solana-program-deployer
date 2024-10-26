# Solana Program Deployer

Deploy Solana programs with Node.js and optional Jito bundles.

## Usage

npm install solana-program-deployer

## Example

```
import { Connection, Keypair } from "@solana/web3.js"
import Deployer from "solana-program-deployer"
import bs58 from "bs58"

// This should be near bulletproof reliable, if you encounter any errors please report them.

// payer keypair
const payer = Keypair.fromSecretKey(Uint8Array.from([/* [ your keypair byte array ] */]))

// if you have a private key in base58 format, you can do this:
// const payer = Keypair.fromSecretKey(bs58.decode(/* " your private key string " */))

// you can set a program id keypair here if you need, or leave empty for random
const programKeypair = Keypair.generate()

// use your mainnet rpc or devnet here
const connection = new Connection("https://api.devnet.solana.com")

// initialize deployer, optionally batch deploy with jito bundles.
const deployer = new Deployer(connection, payer, {useJito: false})

// optionally close partially written buffer accounts
// await deployer.closeBuffers()

// if using jito you can set jito tip below or leave empty for default jito tip (1000 lamports). Jito tip has no effect if useJito = false.

// you should never need a jito tip higher than 1000 lamports as theres only 1 writable pubkey in the write ix, you compete against nobody for the auction

// assuming your compiled program is named test_program.so and is in the same directory you run this code from:

console.log("Starting program deploy...")
const deployed = await deployer.deploy("./test_program.so", {customProgramIdKeypair: programKeypair, jitoTipLamports: 1000})
console.log(deployed)
```

## License
MIT