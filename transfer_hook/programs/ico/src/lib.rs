use anchor_lang::prelude::*;

pub mod errors;
pub mod states;
pub mod instructions;
pub use instructions::*;

declare_id!("3YXfnw8Lk1PsuwbyRxSjHHVwxxDLiDH1BHohgbZcW4zb");

#[program]
pub mod ico {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, fee: u64) -> Result<()> {
       ctx.accounts.initialize(fee, &ctx.bumps)?;
       Ok(())
    }

    pub fn initialize_ico(ctx: Context<InitializeIco>, soft_cap: u64, hard_cap: u64, start_time: i64, end_time: i64, amount: u64, price_per_token: u64) -> Result<()> {
        ctx.accounts.initialize_ico(&ctx.bumps, soft_cap, hard_cap, start_time, end_time, amount, price_per_token)?;
        Ok(())
    }

    pub fn purchase_token(ctx: Context<PurchaseToken>, amount: u64) -> Result<()> {
        ctx.accounts.purchase_token(amount)?;
        Ok(())
    }
}
