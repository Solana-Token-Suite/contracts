use crate::errors::ErrorCode;
use crate::states::{Config, ICOConfigAccount, ICOVaultAccount};
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

#[derive(Accounts)]
pub struct PurchaseToken<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account()]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    /// CHECK: Validated via address constraint to ensure SOL goes to the correct creator
    #[account(
        mut,
        address = ico_config_account.creator @ ErrorCode::CreatorMismatch
    )]
    pub creator: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"ico_config_account", mint.key().as_ref()],
        bump = ico_config_account.bump
    )]
    pub ico_config_account: Account<'info, ICOConfigAccount>,

    #[account(
        seeds = [b"ico_vault_account", mint.key().as_ref()],
        bump = ico_vault_account.bump
    )]
    pub ico_vault_account: Account<'info, ICOVaultAccount>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = ico_vault_account,
        associated_token::token_program = token_program
    )]
    pub vault_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program
    )]
    pub buyer_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> PurchaseToken<'info> {
    pub fn purchase_token(&mut self, amount: u64) -> Result<()> {
        let current_time = Clock::get()?.unix_timestamp;

        require!(
            current_time >= self.ico_config_account.start_time
                && current_time <= self.ico_config_account.end_time,
            ErrorCode::ICOIsNotActive
        );

        let total_sol_cost = amount
            .checked_mul(self.ico_config_account.price_per_token)
            .ok_or(ErrorCode::Overflow)?;
        let new_total_raised = self
            .ico_config_account
            .total_raised
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;

        require!(
            new_total_raised <= self.ico_config_account.hard_cap,
            ErrorCode::ICOHardCapReached
        );
        require!(self.vault_ata.amount >= amount, ErrorCode::NotEnoughTokens);
        require!(
            self.buyer.lamports() >= total_sol_cost,
            ErrorCode::NotEnoughSOL
        );

        let accounts_sol = Transfer {
            from: self.buyer.to_account_info(),
            to: self.creator.to_account_info(),
        };
        let ctx_sol = CpiContext::new(self.system_program.to_account_info(), accounts_sol);
        transfer(ctx_sol, total_sol_cost)?;

        let mint_key = self.mint.key();
        let seeds = &[
            b"ico_vault_account",
            mint_key.as_ref(),
            &[self.ico_vault_account.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let token_accounts = TransferChecked {
            from: self.vault_ata.to_account_info(),
            mint: self.mint.to_account_info(),
            to: self.buyer_ata.to_account_info(),
            authority: self.ico_vault_account.to_account_info(),
        };

        let token_ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            token_accounts,
            signer_seeds,
        );

        transfer_checked(token_ctx, amount, self.mint.decimals)?;

        self.ico_config_account.total_raised = new_total_raised;

        msg!(
            "Purchase successful: {} tokens for {} lamports",
            amount,
            total_sol_cost
        );
        Ok(())
    }
}
