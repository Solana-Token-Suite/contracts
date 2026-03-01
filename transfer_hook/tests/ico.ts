import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Ico } from "../target/types/ico";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    createInitializeMintInstruction,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    createMintToInstruction,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getMintLen,
} from "@solana/spl-token";
import { expect } from "chai";

/** Extract a searchable error string from various Anchor / web3.js error formats. */
function getErrorString(err: any): string {
    const parts: string[] = [];
    if (typeof err === "string") return err;
    if (err.message) parts.push(err.message);
    if (err.transactionMessage) parts.push(err.transactionMessage);
    if (err.transactionLogs) parts.push(err.transactionLogs.join("\n"));
    const logs = err.logs ?? err.transactionError?.logs;
    if (Array.isArray(logs)) parts.push(logs.join("\n"));
    return parts.length > 0 ? parts.join("\n") : JSON.stringify(err);
}

/**
 * Retry wrapper for Anchor .rpc() calls that may fail with stale blockhash.
 * Only retries on "Blockhash not found"; all other errors are thrown immediately.
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err: any) {
            const msg = getErrorString(err);
            if (msg.includes("Blockhash not found") && i < retries - 1) {
                await new Promise(r => setTimeout(r, 500));
                continue;
            }
            throw err;
        }
    }
    throw new Error("Retry limit reached");
}

describe("ico", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.ico as Program<Ico>;
    const connection = provider.connection;
    const payer = provider.wallet as anchor.Wallet;

    // --- Keypairs ---
    const mint = Keypair.generate();
    const creator = Keypair.generate();
    const buyer = Keypair.generate();

    // --- PDAs ---
    const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        program.programId
    );

    const [icoConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ico_config_account"), mint.publicKey.toBuffer()],
        program.programId
    );

    const [icoVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ico_vault_account"), mint.publicKey.toBuffer()],
        program.programId
    );

    let creatorAta: PublicKey;
    let vaultAta: PublicKey;
    let buyerAta: PublicKey;

    // Parameters
    const decimals = 9;
    const initAmount = new BN(100_000 * Math.pow(10, decimals)); 
    const softCap = new BN(5_000);   // 5,000 base units soft cap
    const hardCap = new BN(10_000);  // 10,000 base units hard cap
    // 1,000 lamports per base unit → buying 5,000 costs 5,000,000 lamports (0.005 SOL)
    const pricePerBaseUnit = new BN(1_000);

    let startTime: number;
    let endTime: number;

    before(async () => {
        // Transfer 0.2 SOL from env wallet to keypairs that need funds
        const LAMPORTS_02_SOL = 0.2 * LAMPORTS_PER_SOL;
        const fundKeypairsTx = new Transaction()
            .add(
                SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: creator.publicKey,
                    lamports: LAMPORTS_02_SOL,
                }),
                SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: buyer.publicKey,
                    lamports: LAMPORTS_02_SOL,
                })
            );
        await sendAndConfirmTransaction(connection, fundKeypairsTx, [payer.payer], {
            commitment: "confirmed",
        });

        // Create Mint
        const mintLen = getMintLen([]);
        const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

        const createMintIx = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mint.publicKey,
            space: mintLen,
            lamports: mintLamports,
            programId: TOKEN_PROGRAM_ID,
        });

        const initMintIx = createInitializeMintInstruction(
            mint.publicKey,
            decimals,
            creator.publicKey, // mint authority
            null,
            TOKEN_PROGRAM_ID
        );

        const tx = new Transaction().add(createMintIx, initMintIx);
        await sendAndConfirmTransaction(connection, tx, [payer.payer, mint], { commitment: "confirmed" });

        // Create Creator ATA
        creatorAta = getAssociatedTokenAddressSync(mint.publicKey, creator.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
        const createCreatorAtaIx = createAssociatedTokenAccountInstruction(
            payer.publicKey, creatorAta, creator.publicKey, mint.publicKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const mintToIx = createMintToInstruction(
            mint.publicKey, creatorAta, creator.publicKey, initAmount.toNumber(), [], TOKEN_PROGRAM_ID
        );

        const ataTx = new Transaction().add(createCreatorAtaIx, mintToIx);
        await sendAndConfirmTransaction(connection, ataTx, [payer.payer, creator], { commitment: "confirmed" });


        vaultAta = getAssociatedTokenAddressSync(mint.publicKey, icoVaultPda, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
        buyerAta = getAssociatedTokenAddressSync(mint.publicKey, buyer.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    });

    describe("initialize config", () => {
        it("initializes global config", async () => {
            const fee = new BN(100);

            // Check if config PDA already exists (global singleton on devnet)
            let configExists = false;
            try {
                await program.account.config.fetch(configPda);
                configExists = true;
                console.log("    Config already exists, skipping initialization");
            } catch {}

            if (!configExists) {
                await program.methods.initialize(fee)
                    .accountsPartial({
                        owner: payer.publicKey,
                        config: configPda,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc({ commitment: "confirmed" });
            }

            const configAcc = await program.account.config.fetch(configPda);
            expect(configAcc.owner.toBase58()).to.equal(payer.publicKey.toBase58());
            expect(configAcc.fee.toNumber()).to.equal(100);
        });
    });

    describe("initialize ico", () => {
        it("initializes the ico account and vault", async () => {
            const slot = await connection.getSlot();
            const currentBlockTime = await connection.getBlockTime(slot) || Math.floor(Date.now() / 1000);

            startTime = currentBlockTime + 5;   // 5s buffer so "not started" test can run first
            endTime = startTime + 30;            // 30-second ICO window

            await withRetry(() =>
                program.methods.initializeIco(
                    softCap,
                    hardCap,
                    new BN(startTime),
                    new BN(endTime),
                    initAmount,
                    pricePerBaseUnit
                )
                    .accountsPartial({
                        creator: creator.publicKey,
                        mint: mint.publicKey,
                        config: configPda,
                        icoConfigAccount: icoConfigPda,
                        icoVaultAccount: icoVaultPda,
                        vaultAta: vaultAta,
                        creatorAta: creatorAta,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([creator])
                    .rpc({ skipPreflight: true, commitment: "confirmed" })
            );

            const vaultTokenAcc = await connection.getTokenAccountBalance(vaultAta);
            expect(vaultTokenAcc.value.uiAmount).to.equal(100_000);

            const icoConfig = await program.account.icoConfigAccount.fetch(icoConfigPda);
            expect(icoConfig.creator.toBase58()).to.equal(creator.publicKey.toBase58());
            expect(icoConfig.softCap.eq(softCap)).to.be.true;
            expect(icoConfig.hardCap.eq(hardCap)).to.be.true;
        });
    });

    describe("purchase tokens", () => {
        it("fails if ICO has not started yet", async () => {

            const amountToBuy = new BN(1_000);

            try {
                await withRetry(() =>
                    program.methods.purchaseToken(amountToBuy)
                        .accountsPartial({
                            buyer: buyer.publicKey,
                            mint: mint.publicKey,
                            config: configPda,
                            creator: creator.publicKey,
                            icoConfigAccount: icoConfigPda,
                            icoVaultAccount: icoVaultPda,
                            vaultAta: vaultAta,
                            buyerAta: buyerAta,
                            tokenProgram: TOKEN_PROGRAM_ID,
                            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                            systemProgram: SystemProgram.programId,
                        })
                        .signers([buyer])
                        .rpc({ commitment: "confirmed" })
                );

                expect.fail("Should fail because ICO hasn't started");
            } catch (err: any) {
                expect(getErrorString(err)).to.contain("ICOIsNotActive");
            }
        });

        it("purchases tokens successfully after waiting for start time", async () => {
            console.log("    Waiting for 6 seconds to reach start time...");
            await new Promise(r => setTimeout(r, 6000));

            const baseUnitsToBuy = new BN(5_000);

            const balanceBefore = await connection.getBalance(creator.publicKey);

            await withRetry(() =>
                program.methods.purchaseToken(baseUnitsToBuy)
                    .accountsPartial({
                        buyer: buyer.publicKey,
                        mint: mint.publicKey,
                        config: configPda,
                        creator: creator.publicKey,
                        icoConfigAccount: icoConfigPda,
                        icoVaultAccount: icoVaultPda,
                        vaultAta: vaultAta,
                        buyerAta: buyerAta,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([buyer])
                    .rpc({ skipPreflight: true, commitment: "confirmed" })
            );

            const balanceAfter = await connection.getBalance(creator.publicKey);
            const buyerTokenAcc = await connection.getTokenAccountBalance(buyerAta);

            // 5,000 base units with 9 decimals = 0.000005 tokens
            expect(buyerTokenAcc.value.uiAmount).to.equal(0.000005);

            const expectedProfit = baseUnitsToBuy.toNumber() * pricePerBaseUnit.toNumber();
            expect(balanceAfter - balanceBefore).to.equal(expectedProfit);
        });

        it("fails if hard cap is reached", async () => {
            // We bought 5,000 already; remaining = 5,000. Trying to buy 8,000 exceeds the 10,000 hardCap.
            const excessiveAmount = new BN(8_000);

            try {
                await withRetry(() =>
                    program.methods.purchaseToken(excessiveAmount)
                        .accountsPartial({
                            buyer: buyer.publicKey,
                            mint: mint.publicKey,
                            config: configPda,
                            creator: creator.publicKey,
                            icoConfigAccount: icoConfigPda,
                            icoVaultAccount: icoVaultPda,
                            vaultAta: vaultAta,
                            buyerAta: buyerAta,
                            tokenProgram: TOKEN_PROGRAM_ID,
                            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                            systemProgram: SystemProgram.programId,
                        })
                        .signers([buyer])
                        .rpc({ commitment: "confirmed" })
                );

                expect.fail("Should have failed crossing hard cap");
            } catch (err: any) {
                expect(getErrorString(err)).to.contain("ICOHardCapReached");
            }
        });

    });
});
