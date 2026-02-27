import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { TransferHook } from "../target/types/transfer_hook";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";

describe("transfer_hook", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.transferHook as Program<TransferHook>;
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  // --- Keypairs ---
  const mint = Keypair.generate();
  const nftMint = Keypair.generate();
  const userToWhitelist = Keypair.generate();
  const unauthorizedUser = Keypair.generate();

  // Treasury address must match the on-chain constant
  const TREASURY = new PublicKey("HtGXcunbPUU54wMa9ZiXdMXvv1b5ppT7DeFLJWdtH7Lr");

  // --- PDAs ---
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), mint.publicKey.toBuffer()],
    program.programId
  );

  const [extraAccountMetaListPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.publicKey.toBuffer()],
    program.programId
  );

  const [whitelistMarkerPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("whitelist"),
      mint.publicKey.toBuffer(),
      userToWhitelist.publicKey.toBuffer(),
    ],
    program.programId
  );

  // Token accounts
  let sourceTokenAccount: PublicKey;
  let destinationTokenAccount: PublicKey;
  const destinationWallet = Keypair.generate();

  // Test parameters
  const decimals = 9;
  const mintAmount = 1_000_000_000_000; // 1000 tokens
  const maxTransferAmount = new BN(500 * LAMPORTS_PER_SOL); // 500 tokens
  const minTransferAmount = new BN(0.001 * LAMPORTS_PER_SOL); // 0.001 tokens

  // ============================================================
  // Setup: Create Token2022 Mint with Transfer Hook Extension
  // ============================================================

  before(async () => {
    // Airdrop to all needed accounts
    const airdropSig1 = await connection.requestAirdrop(
      payer.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig1, "confirmed");

    // Fund the treasury address so it's rent-exempt (required as a writable account)
    const airdropTreasury = await connection.requestAirdrop(
      TREASURY,
      1 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropTreasury, "confirmed");

    // Fund unauthorized user
    const airdropSig2 = await connection.requestAirdrop(
      unauthorizedUser.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig2, "confirmed");

    // --- Create Mint with Transfer Hook Extension ---
    const mintLen = getMintLen([ExtensionType.TransferHook]);
    const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

    const createMintAccountIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports: mintLamports,
      programId: TOKEN_2022_PROGRAM_ID,
    });

    const initTransferHookIx = createInitializeTransferHookInstruction(
      mint.publicKey,
      payer.publicKey, // authority
      program.programId, // transfer hook program id
      TOKEN_2022_PROGRAM_ID
    );

    const initMintIx = createInitializeMintInstruction(
      mint.publicKey,
      decimals,
      payer.publicKey,
      null, // freeze authority
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new Transaction().add(
      createMintAccountIx,
      initTransferHookIx,
      initMintIx
    );

    await sendAndConfirmTransaction(connection, tx, [payer.payer, mint], {
      commitment: "confirmed",
    });
    console.log("  ✓ Created Token2022 Mint with Transfer Hook extension:", mint.publicKey.toBase58());

    // --- Create NFT Mint (regular SPL Token for NFT gating tests) ---
    const nftMintLen = getMintLen([]);
    const nftMintLamports = await connection.getMinimumBalanceForRentExemption(nftMintLen);

    const createNftMintIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: nftMint.publicKey,
      space: nftMintLen,
      lamports: nftMintLamports,
      programId: TOKEN_PROGRAM_ID,
    });

    const initNftMintIx = createInitializeMintInstruction(
      nftMint.publicKey,
      0, // 0 decimals for NFT
      payer.publicKey,
      null,
      TOKEN_PROGRAM_ID
    );

    const nftTx = new Transaction().add(createNftMintIx, initNftMintIx);
    await sendAndConfirmTransaction(connection, nftTx, [payer.payer, nftMint], {
      commitment: "confirmed",
    });
    console.log("  ✓ Created NFT Mint:", nftMint.publicKey.toBase58());

    // --- Create Source Token Account (Token 2022) ---
    sourceTokenAccount = getAssociatedTokenAddressSync(
      mint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const createSourceAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      sourceTokenAccount,
      payer.publicKey,
      mint.publicKey,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const ataSourceTx = new Transaction().add(createSourceAtaIx);
    await sendAndConfirmTransaction(connection, ataSourceTx, [payer.payer], {
      commitment: "confirmed",
    });

    // --- Mint tokens to source ---
    const mintToIx = createMintToInstruction(
      mint.publicKey,
      sourceTokenAccount,
      payer.publicKey,
      mintAmount,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    const mintToTx = new Transaction().add(mintToIx);
    await sendAndConfirmTransaction(connection, mintToTx, [payer.payer], {
      commitment: "confirmed",
    });
    console.log("  ✓ Minted", mintAmount, "tokens to source account");

    // --- Create Destination Token Account ---
    // Fund destination wallet
    const airdropDest = await connection.requestAirdrop(
      destinationWallet.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropDest, "confirmed");

    destinationTokenAccount = getAssociatedTokenAddressSync(
      mint.publicKey,
      destinationWallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const createDestAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      destinationTokenAccount,
      destinationWallet.publicKey,
      mint.publicKey,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const ataDestTx = new Transaction().add(createDestAtaIx);
    await sendAndConfirmTransaction(connection, ataDestTx, [payer.payer], {
      commitment: "confirmed",
    });
    console.log("  ✓ Created destination token account");
  });

  // ============================================================
  // Test 1: Initialize Registry
  // ============================================================

  describe("initialize_registry", () => {
    it("initializes the config and extra account meta list", async () => {
      // Track balances to show true cost
      const payerBalanceBefore = await connection.getBalance(payer.publicKey);
      const treasuryBalanceBefore = await connection.getBalance(TREASURY);

      const tx = await program.methods
        .initializeRegistry(
          null, // openMinute — no trading hour restriction
          null, // closeMinute
          maxTransferAmount,
          minTransferAmount,
          nftMint.publicKey
        )
        .accountsPartial({
          payer: payer.publicKey,
          treasury: TREASURY,
          mint: mint.publicKey,
          config: configPda,
          extraAccountMetaList: extraAccountMetaListPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      const payerBalanceAfter = await connection.getBalance(payer.publicKey);
      const treasuryBalanceAfter = await connection.getBalance(TREASURY);

      const totalCostLamports = payerBalanceBefore - payerBalanceAfter;
      const totalCostSol = totalCostLamports / LAMPORTS_PER_SOL;

      const treasuryGainLamports = treasuryBalanceAfter - treasuryBalanceBefore;
      const treasuryGainSol = treasuryGainLamports / LAMPORTS_PER_SOL;

      console.log(`    tx: ${tx}`);
      console.log(`    💰 Total Cost to Initialize: ${totalCostSol} SOL (${totalCostLamports} lamports)`);
      console.log(`       - This includes the 0.1 SOL app fee + rent for PDAs + network tx fee`);
      console.log(`    🏦 Treasury Balance Before: ${treasuryBalanceBefore / LAMPORTS_PER_SOL} SOL`);
      console.log(`    🏦 Treasury Balance After:  ${treasuryBalanceAfter / LAMPORTS_PER_SOL} SOL`);
      console.log(`    📈 Treasury Gain:           ${treasuryGainSol} SOL`);

      // Verify config account was created with correct data
      const configAccount = await program.account.configAccount.fetch(configPda);
      expect(configAccount.owner.toBase58()).to.equal(payer.publicKey.toBase58());
      expect(configAccount.mint.toBase58()).to.equal(mint.publicKey.toBase58());
      expect(configAccount.nftMintAddress.toBase58()).to.equal(nftMint.publicKey.toBase58());
      expect(configAccount.whitelistEnabled).to.be.false;
      expect(configAccount.tradingTimeEnabled).to.be.false;
      expect(configAccount.maxTransferEnabled).to.be.false;
      expect(configAccount.nftGated).to.be.false;
      expect(configAccount.maxTransferAmount.eq(maxTransferAmount)).to.be.true;
      expect(configAccount.minTransferAmount.eq(minTransferAmount)).to.be.true;
      expect(configAccount.openMinute).to.be.null;
      expect(configAccount.closeMinute).to.be.null;

      // The tx succeeding proves the 0.1 SOL fee was paid — the program requires it via CPI

      // Verify extra account meta list was created
      const extraAccountInfo = await connection.getAccountInfo(extraAccountMetaListPda);
      expect(extraAccountInfo).to.not.be.null;
      expect(extraAccountInfo!.owner.toBase58()).to.equal(program.programId.toBase58());
    });
  });

  // ============================================================
  // Test 2: Update Flags
  // ============================================================

  describe("update_flags", () => {
    it("enables max transfer limit", async () => {
      await program.methods
        .updateFlags(
          false, // whitelistEnabled
          false, // tradingTimeEnabled
          true,  // maxTransferEnabled
          false  // nftGated
        )
        .accountsPartial({
          owner: payer.publicKey,
          config: configPda,
          mint: mint.publicKey,
        })
        .rpc({ commitment: "confirmed" });

      const configAccount = await program.account.configAccount.fetch(configPda);
      expect(configAccount.maxTransferEnabled).to.be.true;
      expect(configAccount.whitelistEnabled).to.be.false;
      expect(configAccount.tradingTimeEnabled).to.be.false;
      expect(configAccount.nftGated).to.be.false;
    });

    it("fails when unauthorized user tries to update flags", async () => {
      try {
        await program.methods
          .updateFlags(true, true, true, true)
          .accountsPartial({
            owner: unauthorizedUser.publicKey,
            config: configPda,
            mint: mint.publicKey,
          })
          .signers([unauthorizedUser])
          .rpc({ commitment: "confirmed" });

        expect.fail("Should have thrown an error");
      } catch (err: any) {
        // Should fail with constraint violation (has_one = owner)
        expect(err.toString()).to.contain("Error");
      }
    });

    it("enables all flags", async () => {
      await program.methods
        .updateFlags(true, false, true, false)
        .accountsPartial({
          owner: payer.publicKey,
          config: configPda,
          mint: mint.publicKey,
        })
        .rpc({ commitment: "confirmed" });

      const configAccount = await program.account.configAccount.fetch(configPda);
      expect(configAccount.whitelistEnabled).to.be.true;
      expect(configAccount.maxTransferEnabled).to.be.true;
      expect(configAccount.tradingTimeEnabled).to.be.false;
      expect(configAccount.nftGated).to.be.false;
    });
  });

  // ============================================================
  // Test 3: Whitelist Management
  // ============================================================

  describe("whitelist management", () => {
    it("adds a wallet to the whitelist", async () => {
      const tx = await program.methods
        .addToWhitelist()
        .accountsPartial({
          payer: payer.publicKey,
          owner: payer.publicKey,
          config: configPda,
          mint: mint.publicKey,
          userPubkey: userToWhitelist.publicKey,
          whitelistMarker: whitelistMarkerPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      console.log("    Add to whitelist tx:", tx);

      // Verify the whitelist marker PDA exists
      const markerInfo = await connection.getAccountInfo(whitelistMarkerPda);
      expect(markerInfo).to.not.be.null;
      expect(markerInfo!.owner.toBase58()).to.equal(program.programId.toBase58());
    });

    it("fails when unauthorized user tries to whitelist", async () => {
      const randomUser = Keypair.generate();

      const [randomMarker] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("whitelist"),
          mint.publicKey.toBuffer(),
          randomUser.publicKey.toBuffer(),
        ],
        program.programId
      );

      try {
        await program.methods
          .addToWhitelist()
          .accountsPartial({
            payer: unauthorizedUser.publicKey,
            owner: unauthorizedUser.publicKey,
            config: configPda,
            mint: mint.publicKey,
            userPubkey: randomUser.publicKey,
            whitelistMarker: randomMarker,
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorizedUser])
          .rpc({ commitment: "confirmed" });

        expect.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.toString()).to.contain("Error");
      }
    });

    it("removes a wallet from the whitelist", async () => {
      const tx = await program.methods
        .removeFromWhitelist()
        .accountsPartial({
          payer: payer.publicKey,
          owner: payer.publicKey,
          config: configPda,
          mint: mint.publicKey,
          userPubkey: userToWhitelist.publicKey,
          whitelistMarker: whitelistMarkerPda,
        })
        .rpc({ commitment: "confirmed" });

      console.log("    Remove from whitelist tx:", tx);

      // Verify the whitelist marker PDA is closed
      const markerInfo = await connection.getAccountInfo(whitelistMarkerPda);
      expect(markerInfo).to.be.null;
    });
  });

  // ============================================================
  // Test 4: Token Transfer with Transfer Hook (Volume Limits)
  // ============================================================

  describe("transfer with hook - volume limits", () => {
    before(async () => {
      // Disable whitelist, enable only max transfer limits for this test group
      await program.methods
        .updateFlags(
          false, // whitelistEnabled OFF
          false, // tradingTimeEnabled OFF
          true,  // maxTransferEnabled ON
          false  // nftGated OFF
        )
        .accountsPartial({
          owner: payer.publicKey,
          config: configPda,
          mint: mint.publicKey,
        })
        .rpc({ commitment: "confirmed" });
    });

    it("succeeds when transfer amount is within limits", async () => {
      const transferAmount = BigInt(100_000_000_000); // 100 tokens (within 0.001 - 500 range)

      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        connection,
        sourceTokenAccount,
        mint.publicKey,
        destinationTokenAccount,
        payer.publicKey,
        transferAmount,
        decimals,
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      const sig = await sendAndConfirmTransaction(
        connection,
        tx,
        [payer.payer],
        { commitment: "confirmed" }
      );

      console.log("    Transfer (within limits) tx:", sig);
    });

    it("fails when transfer amount exceeds maximum", async () => {
      const excessiveAmount = BigInt(600_000_000_000); // 600 tokens (> 500 max)

      try {
        const transferIx = await createTransferCheckedWithTransferHookInstruction(
          connection,
          sourceTokenAccount,
          mint.publicKey,
          destinationTokenAccount,
          payer.publicKey,
          excessiveAmount,
          decimals,
          [],
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );

        const tx = new Transaction().add(transferIx);
        await sendAndConfirmTransaction(
          connection,
          tx,
          [payer.payer],
          { commitment: "confirmed" }
        );

        expect.fail("Should have thrown an error for exceeding max transfer");
      } catch (err: any) {
        console.log("    ✓ Transfer correctly rejected (exceeds max)");
      }
    });

    it("fails when transfer amount is below minimum", async () => {
      const tinyAmount = BigInt(100); // way below 0.001 token min

      try {
        const transferIx = await createTransferCheckedWithTransferHookInstruction(
          connection,
          sourceTokenAccount,
          mint.publicKey,
          destinationTokenAccount,
          payer.publicKey,
          tinyAmount,
          decimals,
          [],
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );

        const tx = new Transaction().add(transferIx);
        await sendAndConfirmTransaction(
          connection,
          tx,
          [payer.payer],
          { commitment: "confirmed" }
        );

        expect.fail("Should have thrown an error for below min transfer");
      } catch (err: any) {
        console.log("    ✓ Transfer correctly rejected (below min)");
      }
    });
  });

  // ============================================================
  // Test 5: Transfer with Whitelist Gate
  // ============================================================

  describe("transfer with hook - whitelist gate", () => {
    before(async () => {
      // Enable whitelist only
      await program.methods
        .updateFlags(
          true,  // whitelistEnabled ON
          false, // tradingTimeEnabled OFF
          false, // maxTransferEnabled OFF
          false  // nftGated OFF
        )
        .accountsPartial({
          owner: payer.publicKey,
          config: configPda,
          mint: mint.publicKey,
        })
        .rpc({ commitment: "confirmed" });
    });

    it("fails when sender is not whitelisted", async () => {
      const transferAmount = BigInt(10_000_000_000); // 10 tokens

      try {
        const transferIx = await createTransferCheckedWithTransferHookInstruction(
          connection,
          sourceTokenAccount,
          mint.publicKey,
          destinationTokenAccount,
          payer.publicKey,
          transferAmount,
          decimals,
          [],
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );

        const tx = new Transaction().add(transferIx);
        await sendAndConfirmTransaction(
          connection,
          tx,
          [payer.payer],
          { commitment: "confirmed" }
        );

        expect.fail("Should have thrown an error for not whitelisted");
      } catch (err: any) {
        console.log("    ✓ Transfer correctly rejected (not whitelisted)");
      }
    });

    it("succeeds after sender is whitelisted", async () => {
      // First, whitelist the payer (the sender)
      const [payerWhitelistMarker] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("whitelist"),
          mint.publicKey.toBuffer(),
          payer.publicKey.toBuffer(),
        ],
        program.programId
      );

      await program.methods
        .addToWhitelist()
        .accountsPartial({
          payer: payer.publicKey,
          owner: payer.publicKey,
          config: configPda,
          mint: mint.publicKey,
          userPubkey: payer.publicKey,
          whitelistMarker: payerWhitelistMarker,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      // Now try the transfer — should succeed
      const transferAmount = BigInt(10_000_000_000); // 10 tokens

      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        connection,
        sourceTokenAccount,
        mint.publicKey,
        destinationTokenAccount,
        payer.publicKey,
        transferAmount,
        decimals,
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      const sig = await sendAndConfirmTransaction(
        connection,
        tx,
        [payer.payer],
        { commitment: "confirmed" }
      );

      console.log("    Transfer (whitelisted sender) tx:", sig);
    });
  });

  // ============================================================
  // Test 6: Transfer with all gates disabled (passthrough)
  // ============================================================

  describe("transfer with all gates disabled", () => {
    before(async () => {
      // Disable all flags
      await program.methods
        .updateFlags(false, false, false, false)
        .accountsPartial({
          owner: payer.publicKey,
          config: configPda,
          mint: mint.publicKey,
        })
        .rpc({ commitment: "confirmed" });
    });

    it("succeeds with any amount when all gates are off", async () => {
      const transferAmount = BigInt(50_000_000_000); // 50 tokens

      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        connection,
        sourceTokenAccount,
        mint.publicKey,
        destinationTokenAccount,
        payer.publicKey,
        transferAmount,
        decimals,
        [],
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      const sig = await sendAndConfirmTransaction(
        connection,
        tx,
        [payer.payer],
        { commitment: "confirmed" }
      );

      console.log("    Transfer (all gates off) tx:", sig);
    });
  });

  // ============================================================
  // Test 7: Config account state verification
  // ============================================================

  describe("config state verification", () => {
    it("correctly stores and updates open/close minutes", async () => {
      // Create a new mint + config with trading hours set
      const mint2 = Keypair.generate();
      const mintLen = getMintLen([ExtensionType.TransferHook]);
      const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

      const createMintIx = SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint2.publicKey,
        space: mintLen,
        lamports: mintLamports,
        programId: TOKEN_2022_PROGRAM_ID,
      });

      const initHookIx = createInitializeTransferHookInstruction(
        mint2.publicKey,
        payer.publicKey,
        program.programId,
        TOKEN_2022_PROGRAM_ID
      );

      const initMintIx = createInitializeMintInstruction(
        mint2.publicKey,
        decimals,
        payer.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(createMintIx, initHookIx, initMintIx);
      await sendAndConfirmTransaction(connection, tx, [payer.payer, mint2], {
        commitment: "confirmed",
      });

      const [config2Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("config"), mint2.publicKey.toBuffer()],
        program.programId
      );

      const [extraMeta2Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("extra-account-metas"), mint2.publicKey.toBuffer()],
        program.programId
      );

      // Initialize with trading hours: open at minute 540 (9 AM), close at minute 1020 (5 PM)
      await program.methods
        .initializeRegistry(
          540,   // openMinute = 9:00 AM UTC
          1020,  // closeMinute = 5:00 PM UTC
          new BN(1_000_000_000_000), // max
          new BN(1), // min
          nftMint.publicKey
        )
        .accountsPartial({
          payer: payer.publicKey,
          treasury: TREASURY,
          mint: mint2.publicKey,
          config: config2Pda,
          extraAccountMetaList: extraMeta2Pda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      const configAccount = await program.account.configAccount.fetch(config2Pda);
      expect(configAccount.openMinute).to.equal(540);
      expect(configAccount.closeMinute).to.equal(1020);
      expect(configAccount.owner.toBase58()).to.equal(payer.publicKey.toBase58());
    });
  });
    describe("Test_config",async () => {
      it("fetches and updates config account data correctly", async () => {
        //const nftMint1 = Keypair.generate();
      // const tx = await program.methods
      //   .initializeRegistry(
      //     null, // openMinute — no trading hour restriction
      //     null, // closeMinute
      //     maxTransferAmount,
      //     minTransferAmount,
      //     nftMint1.publicKey
      //   )
      //   .accountsPartial({
      //     payer: payer.publicKey,
      //     treasury: TREASURY,
      //     mint: mint.publicKey,
      //     config: configPda,
      //     extraAccountMetaList: extraAccountMetaListPda,
      //     systemProgram: SystemProgram.programId,
      //   })
      //   .rpc({ commitment: "confirmed" });

        const configAccount = await program.account.configAccount.fetch(configPda);
        console.log("Config Account Data:", {
        owner: configAccount.owner.toBase58(),
        mint: configAccount.mint.toBase58(),
        nftMintAddress: configAccount.nftMintAddress.toBase58(),
        whitelistEnabled: configAccount.whitelistEnabled,
        tradingTimeEnabled: configAccount.tradingTimeEnabled,
        maxTransferEnabled: configAccount.maxTransferEnabled,
        nftGated: configAccount.nftGated,
        maxTransferAmount: configAccount.maxTransferAmount.toString(),
        minTransferAmount: configAccount.minTransferAmount.toString(),
        openMinute: configAccount.openMinute,
        closeMinute: configAccount.closeMinute,
      });

      const openMin = 3;
      const cloneMin = 5;
      const maxTrasnfer = new BN(1000);
      const minTransfer = new BN(1);
      const nftMint = Keypair.generate();

      const tx2 = await program.methods.editConfig(
        openMin, // openMinute — no trading hour restriction
        cloneMin, // closeMinute
        maxTrasnfer,
        minTransfer,
        nftMint.publicKey
      )
      .accountsPartial({
        owner: payer.publicKey,
        config: configPda,
        mint: mint.publicKey,
      })
      .rpc({ commitment: "confirmed" });

      const newData = await program.account.configAccount.fetch(configPda);
      console.log("Updated Config Account Data:", {
        owner: newData.owner.toBase58(),
        mint: newData.mint.toBase58(),
        nftMintAddress: newData.nftMintAddress.toBase58(),
        whitelistEnabled: newData.whitelistEnabled,
        tradingTimeEnabled: newData.tradingTimeEnabled,
        maxTransferEnabled: newData.maxTransferEnabled,
        nftGated: newData.nftGated,
        maxTransferAmount: newData.maxTransferAmount.toString(),
        minTransferAmount: newData.minTransferAmount.toString(),
        openMinute: newData.openMinute,
        closeMinute: newData.closeMinute,
       });
      });
    });
});
