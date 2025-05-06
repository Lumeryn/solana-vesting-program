#!npx esrun
import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { Command } from "commander";
import fs from "fs";

import IDL from "../target/idl/solana_vesting_program.json";
async function loadKeypair(p: string): Promise<Keypair> {
  const secret = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

async function makeProvider(rpcUrl: string, wallet: Keypair) {
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const walletAdapter = new anchor.Wallet(wallet);
  return new anchor.AnchorProvider(connection, walletAdapter, anchor.AnchorProvider.defaultOptions());
}

async function derivePdas(
  programId: PublicKey,
  beneficiary: PublicKey,
  mint: PublicKey,
  name: string
): Promise<{ vesting: PublicKey; vault: PublicKey; bumpVault: number }> {
  const [vesting, bumpVesting] = PublicKey.findProgramAddressSync(
    [Buffer.from("vesting"), beneficiary.toBuffer(), mint.toBuffer(), Buffer.from(name)],
    programId
  );
  const [vault, bumpVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), vesting.toBuffer()],
    programId
  );
  return { vesting, vault, bumpVault };
}

async function main() {
  const program = new Command();
  program
    .name("vesting-cli")
    .option("--rpc-url <url>", "RPC endpoint", process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com")
    .option("--keypair <path>", "local wallet keypair file", process.env.HOME + "/.config/solana/id.json")
    .option("--dry-run", "print instructions instead of sending")
    .hook("preAction", async (thisCommand: any) => {
      // bootstrap Anchor provider
      const opts = thisCommand.opts();
      if (!opts.keypair) {
        opts.keypair = process.env.HOME + "/.config/solana/id.json";
      }
      const wallet = await loadKeypair(opts.keypair);
      const provider = await makeProvider(opts.rpcUrl, wallet);
      anchor.setProvider(provider);

      thisCommand.programId = new PublicKey(IDL.address);
      thisCommand.anchorProgram = new anchor.Program(IDL, provider);
    });

  // ----- init subcommand -----
  program
    .command("init")
    .description("Initialize a new vesting schedule and fund the vault")
    .requiredOption("--beneficiary <string>", "beneficiary public key")
    .requiredOption("--mint <string>", "token mint public key")
    .requiredOption("--amount <number>", "total amount to vest")
    .requiredOption(
      "--cliff-time <string>",
      "cliff/start datetime (ISO 8601 format, e.g., '2023-01-01T00:00:00Z')"
    )
    .requiredOption("--end-time <string>", "end datetime (ISO 8601 format, e.g., '2023-12-31T23:59:59Z')")
    .option("--cliff-percentage <number>", "0-100 percent unlocked at start", "0")
    .option("--payment-interval <number>", "in seconds;", "1")
    .requiredOption("--name <string>", "human-readable label")
    .option("--revocable", "allow creator to revoke unvested tokens", false)
    .action(async (opts, cmd) => {
      const p: any = cmd.parent; // grab from preAction hook
      const anchorProgram: anchor.Program = p.anchorProgram;
      const programId: PublicKey = p.programId;
      const beneficiary = new PublicKey(opts.beneficiary);
      const mint = new PublicKey(opts.mint);
      const payer = (anchor.getProvider() as anchor.AnchorProvider).wallet.publicKey;

      // Validate and convert start and end time from ISO 8601 to Unix timestamp
      const startTime = Date.parse(opts.cliffTime);
      const endTime = Date.parse(opts.endTime);

      if (isNaN(startTime) || isNaN(endTime)) {
        console.error("Invalid date format. Please use ISO 8601 format, e.g., '2023-01-01T00:00:00Z'.");
        process.exit(1);
      }

      const startTimestamp = Math.floor(startTime / 1000);
      const endTimestamp = Math.floor(endTime / 1000);

      // derive PDAs
      const { vesting, vault, bumpVault } = await derivePdas(programId, beneficiary, mint, opts.name);

      // find the source token account of the payer
      const sourceTokenAccount = await anchor.utils.token.associatedAddress({
        mint,
        owner: payer,
      });
      console.log("Payer:", payer.toBase58());
      console.log("Source token account:", sourceTokenAccount.toBase58());
      console.log("Beneficiary token account:", beneficiary.toBase58());
      console.log("Mint:", mint.toBase58());
      console.log("Vesting name:", opts.name);
      console.log("Vesting Account:", vesting.toBase58());
      if (opts.paymentInterval == 0) {
        opts.paymentInterval = 1;
      }
      const tx = await anchorProgram.methods
        .initialize(
          new BN(opts.amount),
          new BN(startTimestamp),
          new BN(endTimestamp),
          Number(opts.cliffPercentage),
          new BN(opts.paymentInterval),
          opts.name,
          Boolean(opts.revocable)
        )
        .accounts({
          sourceTokenAccount,
          beneficiary,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        });

      if (p.dryRun) {
        let ix = await tx.instruction();
        console.log(
          JSON.stringify(
            {
              programId: ix.programId.toBase58(),
              keys: ix.keys.map((k) => ({
                pubkey: k.pubkey.toBase58(),
                isSigner: k.isSigner,
                isWritable: k.isWritable,
              })),
              data: ix.data.toString("base64"),
            },
            null,
            2
          )
        );
      } else {
        const sig = await tx.rpc();
        console.log("Transaction sent:", sig);
      }
    });

  // ----- claim subcommand -----
  program
    .command("claim")
    .description("Claim your vested tokens")
    // .requiredOption("--beneficiary-token-account <string>", "your token account for the mint")
    .requiredOption("--mint <string>", "token mint public key")
    .requiredOption("--name <string>", "human-readable label")
    .action(async (opts, cmd) => {
      const p: any = cmd.parent;
      const anchorProgram: anchor.Program = p.anchorProgram;
      const programId: PublicKey = p.programId;
      const beneficiary = (anchor.getProvider() as anchor.AnchorProvider).wallet.publicKey;
      const mint = new PublicKey(opts.mint);

      // derive PDAs
      const { vesting, vault, bumpVault } = await derivePdas(programId, beneficiary, mint, opts.name);

      // const beneficiaryTokenAccount = new PublicKey(opts.beneficiaryTokenAccount);

      const ix = await anchorProgram.methods
        .claim()
        .accounts({
          vesting,
          mint,
          // beneficiaryTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      if (p.dryRun) {
        console.log(
          JSON.stringify(
            {
              programId: ix.programId.toBase58(),
              keys: ix.keys.map((k) => ({
                pubkey: k.pubkey.toBase58(),
                isSigner: k.isSigner,
                isWritable: k.isWritable,
              })),
              data: ix.data.toString("base64"),
            },
            null,
            2
          )
        );
      } else {
        const tx = new anchor.web3.Transaction().add(ix);
        const sig = await anchor.getProvider().sendAndConfirm(tx, []);
        console.log("Claim tx:", sig);
      }
    });

  program
    .command("address")
    .description("Get the vasting account address")
    .requiredOption("--beneficiary <string>", "beneficiary public key")
    .requiredOption("--mint <string>", "token mint public key")
    .requiredOption("--name <string>", "human-readable label")
    .action(async (opts, cmd) => {
      const p: any = cmd.parent; // grab from preAction hook
      const programId: PublicKey = p.programId;
      const beneficiary = new PublicKey(opts.beneficiary);
      const mint = new PublicKey(opts.mint);

      // derive PDAs
      const { vesting, vault, bumpVault } = await derivePdas(programId, beneficiary, mint, opts.name);
      console.log(vesting.toBase58());
      // find the source token account of the payer
    });
  program
    .command("account")
    .description("Print the deserialized vesting account")
    .requiredOption("--beneficiary <string>", "beneficiary public key")
    .requiredOption("--mint <string>", "token mint public key")
    .requiredOption("--name <string>", "human-readable label")
    .action(async (opts, cmd) => {
      const p: any = cmd.parent; // grab from preAction hook
      const programId: PublicKey = p.programId;
      const anchorProgram: anchor.Program = p.anchorProgram;
      const beneficiary = new PublicKey(opts.beneficiary);
      const mint = new PublicKey(opts.mint);

      // derive PDAs
      const { vesting } = await derivePdas(programId, beneficiary, mint, opts.name);

      // fetch and deserialize the vesting account
      const vestingAccount = await anchorProgram.account["vesting"].fetch(vesting);

      console.log("Vesting Account:", vesting.toBase58());

      console.log("Deserialized Vesting Account:", {
        ...vestingAccount,
        totalAmount: vestingAccount.totalAmount.toNumber(),
        claimedAmount: vestingAccount.claimedAmount.toNumber(),
        startTime: new Date(vestingAccount.startTime.toNumber() * 1000).toISOString(),
        endTime: new Date(vestingAccount.endTime.toNumber() * 1000).toISOString(),
      });
    });

  program
    .command("current")
    .description("The current amount of tokens `beneficiary` can claim")
    .requiredOption("--beneficiary <string>", "beneficiary public key")
    .requiredOption("--mint <string>", "token mint public key")
    .requiredOption("--name <string>", "human-readable label")
    .action(async (opts, cmd) => {
      const p: any = cmd.parent; // grab from preAction hook
      const programId: PublicKey = p.programId;
      const beneficiary = new PublicKey(opts.beneficiary);
      const mint = new PublicKey(opts.mint);
      const anchorProgram: anchor.Program = p.anchorProgram;

      const { vesting, vault, bumpVault } = await derivePdas(programId, beneficiary, mint, opts.name);

      const claimable = await anchorProgram.methods
        .estimate()
        .accounts({
          vesting,
          beneficiary,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .view();

      console.log("Claimable amount:", claimable.toString());
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
