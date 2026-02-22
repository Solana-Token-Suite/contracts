use anchor_spl::{associated_token::AssociatedToken, token_interface::{Mint, TokenInterface, TransferChecked, transfer_checked, TokenAccount}};
use anchor_lang::prelude::*;
use crate::states::{Config, ICOConfigAccount, ICOVaultAccount};
use crate::errors::ErrorCode;


#[derive(Accounts)]
pub struct InitializeIco <'info>{
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account()]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config:Account<'info, Config>,


    #[account(
        init,
        payer = creator,
        space = ICOConfigAccount::DISCRIMINATOR.len() + ICOConfigAccount::INIT_SPACE,
        seeds = [b"ico_config_account", mint.key().as_ref()],
        bump 
    )]
    pub ico_config_account: Account<'info, ICOConfigAccount>,

    #[account(
        init,
        payer = creator,
        space = ICOVaultAccount::DISCRIMINATOR.len() + ICOVaultAccount::INIT_SPACE,
        seeds = [b"ico_vault_account", mint.key().as_ref()],
        bump 
    )]
    pub ico_vault_account: Account<'info, ICOVaultAccount>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = ico_vault_account,
        associated_token::token_program = token_program
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = creator,
        associated_token::token_program = token_program
    )]
    pub creator_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>
}

impl <'info> InitializeIco<'info>{
    pub fn initialize_ico( &mut self, bumps: &InitializeIcoBumps, _soft_cap:u64, _hard_cap:u64 , _start_time:i64, _end_time:i64, _amount:u64, _price_per_token:u64)-> Result<()>{
        self.initialize_ico_vault(bumps, _amount)?;
        self.initialize_ico_account(bumps, _soft_cap, _hard_cap , _start_time, _end_time, _price_per_token)?;
        Ok(())
    }


    pub fn initialize_ico_account(&mut self, bumps: &InitializeIcoBumps, _soft_cap:u64, _hard_cap:u64 , _start_time:i64, _end_time:i64, _price_per_token:u64)-> Result<()>{  
        require!(_soft_cap <= _hard_cap, ErrorCode::SoftCapExceedsHardCap);
        require!(_hard_cap > 0, ErrorCode::CapCannotBeZero);

        let current_time = Clock::get()?.unix_timestamp;

        require!(_start_time < _end_time, ErrorCode::StartTimeAfterEndTime);
        require!(_end_time > current_time, ErrorCode::EndTimeInPast);

        self.ico_config_account.set_inner(ICOConfigAccount 
            { creator: self.creator.key(),
              mint: self.mint.key(), 
              soft_cap: _soft_cap, 
              hard_cap: _hard_cap, 
              start_time: _start_time, 
              end_time: _end_time, 
              token_vault: self.vault_ata.key(),
              total_raised: 0,
              price_per_token: _price_per_token,
              bump: bumps.ico_config_account });
        Ok(())
    }

    pub fn initialize_ico_vault(&mut self, bumps: &InitializeIcoBumps, _amount:u64)-> Result<()>{
        self.ico_vault_account.set_inner(ICOVaultAccount { 
            mint: self.mint.key(), 
            creator: self.creator.key(), 
            amount: _amount, 
            bump: bumps.ico_vault_account });
            let accounts = TransferChecked{
                from: self.creator_ata.to_account_info(),
                mint:self.mint.to_account_info(),
                to: self.vault_ata.to_account_info(),
                authority: self.creator.to_account_info()
            };

            let context = CpiContext::new(self.token_program.to_account_info(), accounts);

            transfer_checked(context, _amount, self.mint.decimals)?;
        Ok(())
    }
}