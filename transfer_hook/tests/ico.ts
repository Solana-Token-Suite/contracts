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
    const initAmount = new BN(100_000 * Math.pow(10, decimals)); // 100,000 tokens
    const softCap = new BN(10_000 * Math.pow(10, decimals));
    const hardCap = new BN(50_000 * Math.pow(10, decimals));
    const pricePerToken = new BN(LAMPORTS_PER_SOL / 100);
    // User wants 1,000_000 lamports per base unit
    const pricePerBaseUnit = new BN(1_000_000);

    let startTime: number;
    let endTime: number;

    before(async () => {
        // Fund accounts
        const sig1 = await connection.requestAirdrop(creator.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig1, "confirmed");

        const sig2 = await connection.requestAirdrop(buyer.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig2, "confirmed");

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
            await program.methods.initialize(fee)
                .accountsPartial({
                    owner: payer.publicKey,
                    config: configPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            const configAcc = await program.account.config.fetch(configPda);
            expect(configAcc.owner.toBase58()).to.equal(payer.publicKey.toBase58());
            expect(configAcc.fee.toNumber()).to.equal(100);
        });
    });

    describe("initialize ico", () => {
        it("initializes the ico account and vault", async () => {
            const slot = await connection.getSlot();
            const currentBlockTime = await connection.getBlockTime(slot) || Math.floor(Date.now() / 1000);

            startTime = currentBlockTime + 2;
            endTime = currentBlockTime + 6;

            await program.methods.initializeIco(
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
                .rpc({ commitment: "confirmed" });

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
                await program.methods.purchaseToken(amountToBuy)
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
                    .rpc({ commitment: "confirmed" });

                expect.fail("Should fail because ICO hasn't started");
            } catch (err: any) {
                expect(err.toString()).to.contain("ICOIsNotActive");
            }
        });

        it("purchases tokens successfully after waiting for start time", async () => {
            console.log("    Waiting for 3 seconds to reach start time...");
            await new Promise(r => setTimeout(r, 3000));

            const baseUnitsToBuy = new BN(5_000);

            const balanceBefore = await connection.getBalance(creator.publicKey);

            await program.methods.purchaseToken(baseUnitsToBuy)
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
                .rpc({ commitment: "confirmed" });

            const balanceAfter = await connection.getBalance(creator.publicKey);
            const buyerTokenAcc = await connection.getTokenAccountBalance(buyerAta);

            expect(buyerTokenAcc.value.uiAmount).to.equal(0.000005);

            const expectedProfit = baseUnitsToBuy.toNumber() * pricePerBaseUnit.toNumber();
            expect(balanceAfter - balanceBefore).to.equal(expectedProfit);
        });

        it("fails if hard cap is reached", async () => {
            const excessiveAmount = hardCap.add(new BN(1));

            try {
                await program.methods.purchaseToken(excessiveAmount)
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
                    .rpc({ commitment: "confirmed" });

                expect.fail("Should have failed crossing hard cap");
            } catch (err: any) {
                expect(err.toString()).to.contain("ICOHardCapReached");
            }
        });

        it("fails if ICO has expired", async () => {
            console.log("    Waiting for 4 seconds to reach end time...");
            await new Promise(r => setTimeout(r, 4000));

            const amountToBuy = new BN(100);

            try {
                await program.methods.purchaseToken(amountToBuy)
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
                    .rpc({ commitment: "confirmed" });

                expect.fail("Should fail because ICO has expired");
            } catch (err: any) {
                expect(err.toString()).to.contain("ICOIsNotActive");
            }
        });
    });
});
