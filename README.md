# Solana Token Suite: Transfer Hook

This project implements a Solana program suite for token management, focusing on transfer hooks and ICO functionality. It uses the Anchor framework for Solana smart contract development and includes Rust, TypeScript, and deployment scripts.

## Structure

- **migrations/**: Deployment scripts (TypeScript).
- **programs/**:
  - **ico/**: ICO program (Rust).
  - **transfer_hook/**: Transfer hook program (Rust).
- **runbooks/**: Deployment and usage guides.
- **target/**: Build outputs, keypairs, IDLs, and generated types.
- **tests/**: TypeScript tests for programs.

## Programs

### Transfer Hook

The transfer hook program integrates with the Solana Token Extensions (Token-2022) standard. It attaches custom on-chain logic that is automatically executed on every token transfer. When initialized, it registers an `ExtraAccountMetaList` on-chain so the SPL runtime knows which additional accounts to pass on each transfer.

The owner can independently enable or disable the following features via `update_flags`:

- **Whitelist**: When enabled, only wallets that have been explicitly added to the whitelist by the owner can send tokens. The owner can add or remove wallets at any time.
- **Trading Time Window**: When enabled, transfers are only permitted within a defined time window. The window is specified as an open and close minute-of-day (UTC), and supports overnight windows (e.g. open > close wraps midnight).
- **Max/Min Transfer Amount**: When enabled, each individual transfer must fall within a configured minimum and maximum token amount.
- **NFT Gated**: When enabled, the sender must hold at least one token from a specified NFT mint in their associated token account to be permitted to transfer.

All flags are independent and can be combined. The owner can also update the time window, transfer limits, and NFT mint address after initialization via `edit_config`.

---

### ICO (Initial Coin Offering)

The ICO program allows token creators to run a structured public token sale on-chain. SOL paid by buyers is sent directly to the creator's wallet, and tokens are distributed from a program-controlled vault.

Features:

- **Protocol Initialization**: A one-time global config is set up with a protocol fee, paid on first use.
- **ICO Setup**: The creator initializes an ICO for a specific mint by specifying:
  - Soft cap and hard cap (in SOL)
  - Start and end timestamps
  - Total token amount to sell
  - Price per token (in lamports)
  - An escrow vault ATA is created and funded with the creator's tokens at launch.
- **Token Purchase**: Buyers send SOL and receive tokens from the vault. The program enforces:
  - The ICO is active (current time is within start and end times)
  - The hard cap is not exceeded
  - Arithmetic overflow safety on cost calculations
- **Creator Payout**: SOL from purchases goes directly to the creator's wallet, not a program account.

---

## Key Files

- `Anchor.toml`, `Cargo.toml`, `rust-toolchain.toml`: Anchor and Rust configuration.
- `package.json`, `tsconfig.json`: TypeScript and Node.js configuration.
- `txtx.yml`: Transaction configuration for deployments.

## Getting Started

1. **Install dependencies**:
   - Rust (with Solana toolchain)
   - Node.js & npm
   - Anchor CLI
2. **Build programs**:
   - Run `anchor build` in the root directory.
3. **Deploy programs**:
   - Run `anchor deploy`
4. **Run tests**:
   - Use `anchor test` or run TypeScript tests in `tests/`.



## Notes

- The suite is modular: you can use only the transfer hook, only the ICO, or both.
- All smart contracts are written in Rust and use Anchor for Solana.
- TypeScript bindings are auto-generated for client-side integration.

