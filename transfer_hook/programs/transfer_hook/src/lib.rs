use anchor_lang::{
    prelude::*,
    system_program::{transfer, create_account, CreateAccount, Transfer},
};
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList,
    solana_pubkey::Pubkey as SplPubkey,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

//bytes of the execute instruction 
const EXECUTE_IX_TAG_LE: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];

// Replace with your actual deployed program ID
declare_id!("AjNBZRCm6jsPjPRiZ3hbAitg9KEgCYqKmGm675Fpi6XU");


pub const TREASURY_ADDRESS: Pubkey = pubkey!("HtGXcunbPUU54wMa9ZiXdMXvv1b5ppT7DeFLJWdtH7Lr");

#[program]
pub mod transfer_hook {
    use super::*;

    pub fn initialize_registry(
        ctx: Context<InitializeRegistry>,
        open_minute: Option<u16>,
        close_minute: Option<u16>,
        max_transfer_amount: u64,
        min_transfer_amount: u64,
        nft_mint_address: Pubkey,
    ) -> Result<()> {
        
        let fee_lamports = 100_000_000;//0.1 SOL
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            fee_lamports,
        )?;

        let config = &mut ctx.accounts.config;
        config.owner = ctx.accounts.payer.key();
        config.mint = ctx.accounts.mint.key();
        
        config.whitelist_enabled = false;
        config.trading_time_enabled = false;
        config.max_transfer_enabled = false;
        config.nft_gated = false;
        
        config.open_minute = open_minute;
        config.close_minute = close_minute;
        config.max_transfer_amount = max_transfer_amount;
        config.min_transfer_amount = min_transfer_amount;
        config.nft_mint_address = nft_mint_address;

        let account_metas = vec![
            // Index 5: The Config Account
            ExtraAccountMeta::new_with_seeds(
                &[Seed::Literal { bytes: b"config".to_vec() }, Seed::AccountKey { index: 1 }],
                false, false,
            ).map_err(|_| error!(HookError::MetaListError))?,
            // Index 6: The Whitelist Marker 
            ExtraAccountMeta::new_with_seeds(
                &[Seed::Literal { bytes: b"whitelist".to_vec() }, Seed::AccountKey { index: 1 }, Seed::AccountKey { index: 3 }],
                false, false,
            ).map_err(|_| error!(HookError::MetaListError))?,
            // Index 7: NFT Mint Account 
            ExtraAccountMeta::new_with_pubkey(&SplPubkey::new_from_array(nft_mint_address.to_bytes()), false, false).map_err(|_| error!(HookError::MetaListError))?,
            // Index 8: SPL Token Program 
            ExtraAccountMeta::new_with_pubkey(&SplPubkey::new_from_array(anchor_spl::token::ID.to_bytes()), false, false).map_err(|_| error!(HookError::MetaListError))?,
            // Index 9: Associated Token Program 
            ExtraAccountMeta::new_with_pubkey(&SplPubkey::new_from_array(anchor_spl::associated_token::ID.to_bytes()), false, false).map_err(|_| error!(HookError::MetaListError))?,
            // Index 10: Senders Token Account
            ExtraAccountMeta::new_external_pda_with_seeds(
                9, // ATA Program index
                &[
                    Seed::AccountKey { index: 3 }, // Source Owner Wallet
                    Seed::AccountKey { index: 8 }, // SPL Token Program
                    Seed::AccountKey { index: 7 }, // NFT Mint
                ],
                false, false,
            ).map_err(|_| error!(HookError::MetaListError))?,
        ];

        let accounts_size = ExtraAccountMetaList::size_of(account_metas.len()).map_err(|_| error!(HookError::MetaListError))? as u64;
        let lamports = Rent::get()?.minimum_balance(accounts_size as usize);
        let mint = ctx.accounts.mint.key();
        
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"extra-account-metas",
            mint.as_ref(),
            &[ctx.bumps.extra_account_meta_list],
        ]];

        create_account(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.extra_account_meta_list.to_account_info(),
                },
            )
            .with_signer(signer_seeds),
            lamports,
            accounts_size,
            ctx.program_id,
        )?;

        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &account_metas,
        ).map_err(|_| error!(HookError::MetaListError))?;

        Ok(())
    }

    pub fn update_flags(
        ctx: Context<UpdateConfig>,
        whitelist_enabled: bool,
        trading_time_enabled: bool,
        max_transfer_enabled: bool,
        nft_gated: bool,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.whitelist_enabled = whitelist_enabled;
        config.trading_time_enabled = trading_time_enabled;
        config.max_transfer_enabled = max_transfer_enabled;
        config.nft_gated = nft_gated;
        Ok(())
    }

    pub fn add_to_whitelist(_ctx: Context<AddToWhitelist>) -> Result<()> {
        Ok(())
    }

    pub fn remove_from_whitelist(_ctx: Context<RemoveFromWhitelist>) -> Result<()> {
        Ok(())
    }

    #[instruction(discriminator = &EXECUTE_IX_TAG_LE)]
    pub fn execute(ctx: Context<ExecuteTransfer>, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;

        if config.nft_gated {
            let nft_ata = &ctx.accounts.nft_token_account;
            
            require!(!nft_ata.data_is_empty(), HookError::MissingNftAccount);
            require!(nft_ata.data_len() >= 72, HookError::MissingNftAccount);

            let data = nft_ata.try_borrow_data()?;
            let mut amount_bytes = [0u8; 8];
            amount_bytes.copy_from_slice(&data[64..72]);
            let nft_balance = u64::from_le_bytes(amount_bytes);

            require!(nft_balance > 0, HookError::MissingNftAccount);
        }

        if config.trading_time_enabled {
            if let (Some(open), Some(close)) = (config.open_minute, config.close_minute) {
                validate_trading_hours(open, close)?;
            }
        }

        if config.max_transfer_enabled {
            require!(amount <= config.max_transfer_amount, HookError::ExceedsMaxTransfer);
            require!(amount >= config.min_transfer_amount, HookError::BelowMinTransfer);
        }
        if config.whitelist_enabled {
            let marker_account = &ctx.accounts.whitelist_marker;
            
            let is_initialized = marker_account.lamports() > 0 && marker_account.owner == ctx.program_id;
            require!(is_initialized, HookError::NotWhitelisted);
        }

        Ok(())
    }
}

pub fn validate_trading_hours(open_minute: u16, close_minute: u16) -> Result<()> {
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp; 

    let seconds_in_day: i64 = 86_400;
    let seconds_since_midnight = current_timestamp % seconds_in_day;
    let current_minute = (seconds_since_midnight / 60) as u16; 

    let is_open = if open_minute < close_minute {
        current_minute >= open_minute && current_minute < close_minute
    } else if open_minute > close_minute {
        current_minute >= open_minute || current_minute < close_minute
    } else {
        false 
    };

    require!(is_open, HookError::TradingIsClosed);
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Protocol Treasury
    #[account(mut, address = TREASURY_ADDRESS)]
    pub treasury: AccountInfo<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = 8 + ConfigAccount::INIT_SPACE,
        seeds = [b"config", mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, ConfigAccount>,

    /// CHECK: ExtraAccountMetaList Account
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()], 
        bump
    )]
    pub extra_account_meta_list: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub owner: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"config", mint.key().as_ref()],
        bump,
        has_one = owner @ HookError::Unauthorized 
    )]
    pub config: Account<'info, ConfigAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
}

#[derive(Accounts)]
pub struct AddToWhitelist<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub owner: Signer<'info>,

    #[account(
        seeds = [b"config", mint.key().as_ref()],
        bump,
        has_one = owner @ HookError::Unauthorized 
    )]
    pub config: Account<'info, ConfigAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: The user's wallet address to whitelist
    pub user_pubkey: AccountInfo<'info>,

    #[account(
        init,
        payer = payer,
        space = 8,
        seeds = [b"whitelist", mint.key().as_ref(), user_pubkey.key().as_ref()],
        bump
    )]
    pub whitelist_marker: Account<'info, WhitelistMarker>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveFromWhitelist<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub owner: Signer<'info>,

    #[account(
        seeds = [b"config", mint.key().as_ref()],
        bump,
        has_one = owner @ HookError::Unauthorized 
    )]
    pub config: Account<'info, ConfigAccount>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: The user's wallet address to revoke
    pub user_pubkey: AccountInfo<'info>,

    #[account(
        mut,
        close = payer,
        seeds = [b"whitelist", mint.key().as_ref(), user_pubkey.key().as_ref()],
        bump
    )]
    pub whitelist_marker: Account<'info, WhitelistMarker>,
}

#[derive(Accounts)]
pub struct ExecuteTransfer<'info> {
    #[account(
        token::mint = mint,
        token::authority = owner,
    )]
    pub source_token: InterfaceAccount<'info, TokenAccount>,               // Index 0
    pub mint: InterfaceAccount<'info, Mint>,                               // Index 1
    #[account(
        token::mint = mint,
    )]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,          // Index 2
    /// CHECK: source token account owner
    pub owner: UncheckedAccount<'info>,                                    // Index 3
    /// CHECK: ExtraAccountMetaList Account
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,                  // Index 4
    
    #[account(
        seeds = [b"config", mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, ConfigAccount>,                             // Index 5

    /// CHECK: Validated dynamically
    #[account(
        seeds = [b"whitelist", mint.key().as_ref(), owner.key().as_ref()],
        bump
    )]                                                                                                          
    pub whitelist_marker: UncheckedAccount<'info>,                         // Index 6

    /// CHECK: NFT Mint Account (Static Pubkey via MetaList)
    pub nft_mint: UncheckedAccount<'info>,                                 // Index 7

    /// CHECK: SPL Token Program
    pub token_program: UncheckedAccount<'info>,                            // Index 8

    /// CHECK: Associated Token Program
    pub associated_token_program: UncheckedAccount<'info>,                 // Index 9

    /// CHECK: User's NFT ATA (Dynamically Resolved via MetaList)
    pub nft_token_account: UncheckedAccount<'info>,                        // Index 10
}

#[account]
#[derive(InitSpace)]
pub struct ConfigAccount {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub nft_mint_address: Pubkey,
    pub whitelist_enabled: bool,
    pub trading_time_enabled: bool,
    pub max_transfer_enabled: bool,
    pub nft_gated: bool,
    pub open_minute: Option<u16>, 
    pub close_minute: Option<u16>,
    pub max_transfer_amount: u64, 
    pub min_transfer_amount: u64, 
}

#[account]
pub struct WhitelistMarker {
    
}

#[error_code]
pub enum HookError {
    #[msg("Trading is currently closed for this token")]
    TradingIsClosed,
    #[msg("Transfer amount exceeds maximum limit")]
    ExceedsMaxTransfer,
    #[msg("Transfer amount is below minimum limit")]
    BelowMinTransfer,
    #[msg("Sender is not whitelisted")]
    NotWhitelisted,
    #[msg("Sender does not hold the required NFT")]
    MissingNftAccount,
    #[msg("Unauthorized action")]
    Unauthorized,
    #[msg("Failed to initialize extra account meta list")]
    MetaListError,
}