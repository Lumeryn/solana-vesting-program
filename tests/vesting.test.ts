// tests/vesting.test.ts
import * as anchor from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as assert from "assert";

import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import IDLz from "../target/idl/solana_vesting_program.json";
import { SolanaVestingProgram } from "../target/types/solana_vesting_program";

const PROGRAM_ID = new PublicKey(IDLz.address);
const TOKENID = TOKEN_2022_PROGRAM_ID;
let creatorTokenAccountCreated = false;
let mint: anchor.web3.PublicKey;
let program: anchor.Program<SolanaVestingProgram>;
let creator: NodeWallet;
let connection: anchor.web3.Connection;
let creatorTokenAccount: anchor.web3.PublicKey;

describe("vesting", () => {
  const totalAmount = new anchor.BN(1_000_000);
  const interval = 2; // seconds

  async function setupVesting(cliffPercentage: number, cliffDelay: number) {
    let beneficiary: anchor.web3.Keypair;
    let beneficiaryTokenAccount: anchor.web3.PublicKey;
    let vault, vesting: anchor.web3.PublicKey;
    const name = `Vesting Cliff ${cliffPercentage}%`;
    // let vault: anchor.web3.PublicKey;
    try {
      beneficiary = anchor.web3.Keypair.generate();
      beneficiaryTokenAccount = await createAssociatedTokenAccount(
        connection,
        creator.payer,
        mint,
        beneficiary.publicKey,
        {},
        TOKENID
      );

      if (!creatorTokenAccountCreated) {
        creatorTokenAccount = await createAssociatedTokenAccount(
          connection,
          creator.payer,
          mint,
          creator.publicKey,
          {},
          TOKENID
        );
        creatorTokenAccountCreated = true;

        await mintTo(
          connection,
          creator.payer,
          mint,
          creatorTokenAccount,
          creator.publicKey,
          totalAmount.toNumber() * 100,
          undefined,
          undefined,
          TOKENID
        );
      }
      let _Bump: number;
      [vesting, _Bump] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vesting"), beneficiary.publicKey.toBuffer(), mint.toBuffer(), Buffer.from(name)],
        program.programId
      );
      [vault, _Bump] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), vesting.toBuffer()],
        program.programId
      );

      const now = Math.floor(Date.now() / 1000);

      await program.methods
        .initialize(
          totalAmount,
          new anchor.BN(now + cliffDelay),
          new anchor.BN(now + cliffDelay + 10),
          cliffPercentage,
          new anchor.BN(interval),
          name,
          true
        )
        .accounts({
          // payer: creator.publicKey,
          sourceTokenAccount: creatorTokenAccount,
          beneficiary: beneficiary.publicKey,
          mint,
          tokenProgram: TOKENID,
        })
        .signers([])
        .rpc();
    } catch (e) {
      console.error("Error initializing vesting:", e);
      throw e;
    }

    return { beneficiary, beneficiaryTokenAccount, vesting, vault };
  }

  async function airdropTokens(to: PublicKey) {
    const airdropSignature = await connection.requestAirdrop(to, LAMPORTS_PER_SOL * 5);
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature: airdropSignature,
      ...latestBlockhash,
    });
  }
  async function estimateClaimable(vesting: anchor.web3.PublicKey, beneficiary: anchor.web3.Keypair) {
    let claimable;

    claimable = await program.methods
      .estimate()
      .accounts({
        vesting,
      })
      .view();

    return claimable;
  }

  beforeAll(async () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    connection = provider.connection;
    creator = provider.wallet as NodeWallet;
    program = anchor.workspace.SolanaVestingProgram as anchor.Program<SolanaVestingProgram>;
    mint = await createMint(
      connection,
      creator.payer,
      creator.publicKey,
      null,
      6,
      undefined, // keypair (use random if undefined)
      undefined, // confirmation options
      TOKENID // program ID
    );
  });

  it("Initializes all required accounts correctly", async () => {
    const { beneficiary, beneficiaryTokenAccount, vesting, vault } = await setupVesting(20, 0);

    // Fetch the vesting account and verify its state
    let vestingAccount;
    try {
      vestingAccount = await program.account["vesting"].fetch(vesting);
    } catch (e) {
      console.error("Error fetching vesting account:", e);
      throw e;
    }
    expect(vestingAccount.beneficiary.toBase58()).toBe(beneficiary.publicKey.toBase58());
    expect(vestingAccount.creator.toBase58()).toBe(creator.publicKey.toBase58());
    expect(vestingAccount.totalAmount.toString()).toBe(totalAmount.toString());
    expect(vestingAccount.claimedAmount.toString()).toBe("0");
    expect(vestingAccount.cliffPercentage).toBe(20);
    expect(vestingAccount.revocable).toBe(true);

    // Fetch the vault account and verify its state
    const vaultAccount = await getAccount(connection, vault, undefined, TOKENID);
    expect(vaultAccount.amount.toString()).toBe(totalAmount.toString());
    expect(vaultAccount.mint.toBase58()).toBe(mint.toBase58());
    expect(vaultAccount.owner.toBase58()).toBe(vesting.toBase58());
  });

  it("Claims until vault is empty with 20% cliff", async () => {
    const { beneficiary, beneficiaryTokenAccount, vesting, vault } = await setupVesting(20, 0);
    let claimed = new anchor.BN(0);
    for (let i = 0; i < 10; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      try {
        const programWithBeneficiary = await newPayerProgram(airdropTokens, beneficiary);
        await programWithBeneficiary.methods
          .claim()
          .accounts({
            vesting,
            mint,
            // beneficiaryTokenAccount,

            tokenProgram: TOKENID,
            // beneficiary: beneficiary.publicKey,
          } as any)
          .rpc();
      } catch (_) {}

      const account = await getAccount(connection, beneficiaryTokenAccount, undefined, TOKENID);
      const current = new anchor.BN(account.amount.toString());
      if (current.eq(claimed)) {
        console.log("No new tokens claimable");
      }
      claimed = current;
      if (claimed.gte(totalAmount)) break;
    }
    expect(claimed.toNumber()).toBeGreaterThanOrEqual(totalAmount.toNumber());
  });

  it("Prevents premature claims before 3 second cliff", async () => {
    const { beneficiary, beneficiaryTokenAccount, vesting, vault } = await setupVesting(30, 3);
    let caughtEarly = false;

    try {
      const programWithBeneficiary = await newPayerProgram(airdropTokens, beneficiary);
      await programWithBeneficiary.methods
        .claim()
        .accounts({
          vesting,
          mint,
          // beneficiaryTokenAccount,

          tokenProgram: TOKENID,
        } as any)
        .rpc();
    } catch (e) {
      caughtEarly = true;
    }

    if (!caughtEarly) {
      throw new Error("Claim should fail before cliff is reached");
    }
    await new Promise((res) => setTimeout(res, 5000));
    let claimAttempted = false;
    try {
      const programWithBeneficiary = await newPayerProgram(airdropTokens, beneficiary);
      await programWithBeneficiary.methods
        .claim()
        .accounts({
          vesting,
          mint,
          // beneficiaryTokenAccount,
          tokenProgram: TOKENID,
        } as any)
        .signers([])
        .rpc();
      claimAttempted = true;
    } catch (e) {
      console.log("Claim failed:", e);
    }

    expect(claimAttempted).toBe(true);
    const account = await getAccount(connection, beneficiaryTokenAccount, undefined, TOKENID);
    expect(account.amount.toString()).toBe("440000");
  });

  it("Fails to claim again immediately after a successful claim", async () => {
    const { beneficiary, beneficiaryTokenAccount, vesting, vault } = await setupVesting(50, 0);
    await new Promise((res) => setTimeout(res, 1000));

    let success = false;
    //todo check if we use any and pass a beneficiary that is not the same as signer
    try {
      const programWithBeneficiary = await newPayerProgram(airdropTokens, beneficiary);
      await programWithBeneficiary.methods
        .claim()
        .accounts({
          vesting,
          mint,
          // beneficiaryTokenAccount,

          tokenProgram: TOKENID,
        })
        .rpc();
      success = true;
    } catch (e) {
      assert.fail("Initial claim should succeed");
    }

    expect(success).toBe(true);
    let failedSecondClaim = false;
    try {
      await program.methods
        .claim()
        .accounts({
          vesting,
          mint,
          // beneficiaryTokenAccount,

          tokenProgram: TOKENID,
        } as any)
        .signers([beneficiary])
        .rpc();
    } catch (e) {
      failedSecondClaim = true;
    }

    assert.ok(failedSecondClaim, "Subsequent claim with no new tokens should fail");
  });

  it("Fails to initialize vesting with an uninitialized (fake) mint", async () => {
    const fakeMint = anchor.web3.Keypair.generate();
    const beneficiary = anchor.web3.Keypair.generate();

    let threw = false;
    try {
      await program.methods
        .initialize(
          totalAmount,
          new anchor.BN(Math.floor(Date.now() / 1000)),
          new anchor.BN(Math.floor(Date.now() / 1000) + 10),
          20,
          new anchor.BN(2),
          "Invalid Mint",
          true
        )
        .accounts({
          payer: creator.publicKey,
          sourceTokenAccount: anchor.web3.Keypair.generate().publicKey, // fake token account
          beneficiary: beneficiary.publicKey,
          mint: fakeMint.publicKey,
        })
        .signers([])
        .rpc();
    } catch (e) {
      threw = true;
    }

    assert.ok(threw, "Should fail with an uninitialized mint public key");
  });

  it("Estimate claimable returns non-zero after cliff", async () => {
    const { beneficiary, vesting } = await setupVesting(25, 5);
    await new Promise((res) => setTimeout(res, 7000));
    try {
      const claimable = await estimateClaimable(vesting, beneficiary);
      assert.ok(claimable.gt(new anchor.BN(0)), "Should have claimable amount after cliff");
    } catch (e) {
      console.error("Error estimating claimable:", e);
      throw e;
    }
  });

  it("Estimate claimable returns zero before cliff", async () => {
    const { beneficiary, vesting } = await setupVesting(25, 3);
    const claimable = await estimateClaimable(vesting, beneficiary);
    assert.ok(claimable.eq(new anchor.BN(0)), "Should not have claimable amount before cliff");
  });

  it("Fails if claim is signed by anyone but the beneficiary", async () => {
    const { beneficiary, beneficiaryTokenAccount, vesting, vault } = await setupVesting(20, 0);

    // Wait a moment so start_time≤now and there is something to claim (the cliff payout).
    await new Promise((res) => setTimeout(res, 2000));

    let threw = false;
    try {
      // Use the default `program` (creator as signer), not the beneficiary wallet
      await program.methods
        .claim()
        .accounts({
          vesting,
          // vault,
          // beneficiaryTokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          mint,
          // beneficiary: beneficiary.publicKey,
        } as any)
        .rpc();
    } catch (e) {
      threw = true;
    }
    assert.ok(threw, "Expected `claim` to fail when the transaction is not signed by the beneficiary");
  });
  it("Succeeds to revoke unvested tokens as creator", async () => {
    const { beneficiary, beneficiaryTokenAccount, vesting, vault } = await setupVesting(20, 0);
    // Record pre-revoke balances
    const vaultAccountBefore = await getAccount(connection, vault, undefined, TOKENID);
    const creatorAccountBefore = await getAccount(connection, creatorTokenAccount, undefined, TOKENID);
    const vaultBalance = vaultAccountBefore.amount;

    // Perform revoke
    await program.methods
      .revoke()
      .accounts({
        vesting,
        // vault,
        recipientAccount: creatorTokenAccount,
        // creator: creator.publicKey,
        mint,
        tokenProgram: TOKENID,
      })
      .rpc();

    // Vault should be closed (account deleted) or zeroed out
    let vaultClosed = false;
    try {
      await getAccount(connection, vault, undefined, TOKENID);
    } catch (e) {
      vaultClosed = true;
    }
    expect(vaultClosed).toBe(true);

    // Creator should get back the unvested tokens
    const creatorAccountAfter = await getAccount(connection, creatorTokenAccount, undefined, TOKENID);
    expect(creatorAccountAfter.amount).toBe(creatorAccountBefore.amount + vaultBalance);

    // Vesting account should have its `revokedAt` timestamp set
    const vestingAcc = await program.account.vesting.fetch(vesting);
    expect(vestingAcc.revokedAt.toNumber()).toBeGreaterThan(0);
  });

  it("Fails to revoke if already revoked", async () => {
    const { beneficiary, beneficiaryTokenAccount, vesting, vault } = await setupVesting(20, 0);

    // First revoke succeeds
    await program.methods
      .revoke()
      .accounts({
        vesting,
        recipientAccount: creatorTokenAccount,
        mint,
        tokenProgram: TOKENID,
      })
      .rpc();

    // Second revoke must fail with AlreadyRevoked
    let failed = false;
    try {
      await program.methods
        .revoke()
        .accounts({
          vesting,
          recipientAccount: creatorTokenAccount,
          mint,
          tokenProgram: TOKENID,
        })
        .rpc();
    } catch (e) {
      failed = true;
    }
    assert.ok(failed, "Expected a second revoke to error with AlreadyRevoked");
  });
});
async function newPayerProgram(
  airdropTokens: (to: PublicKey) => Promise<void>,
  beneficiary: anchor.web3.Keypair
) {
  await airdropTokens(beneficiary.publicKey);
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(beneficiary));
  const programWithBeneficiary = new anchor.Program(IDLz as SolanaVestingProgram, provider);
  return programWithBeneficiary;
}
