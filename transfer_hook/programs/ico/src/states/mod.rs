use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config{
    pub owner: Pubkey,
    pub fee:u64,
    pub bump:u8,
}

#[account]
#[derive(InitSpace)]
pub struct ICOVaultAccount{
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
    pub bump:u8,
}

#[account]
#[derive(InitSpace)]
pub struct ICOConfigAccount{
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub soft_cap: u64,
    pub hard_cap: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub token_vault: Pubkey,
    pub total_raised: u64,
    pub price_per_token: u64,
    pub bump:u8,
}

#[account]
#[derive(InitSpace)]
pub struct ICOPurchaseAccount{
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub soft_cap: u64,
    pub hard_cap: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub token_vault: Pubkey,
    pub total_raised: u64,
    pub price_per_token: u64,
    pub bump:u8,
}

