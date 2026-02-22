use anchor_lang::prelude::*;

use crate::states::Config;


#[derive(Accounts)]
pub struct Initialize<'info>{
    #[account(mut)]
    pub owner:Signer<'info>,

    #[account(
        init,
        payer = owner,
        seeds = [b"config"],
        space = Config::DISCRIMINATOR.len() + Config::INIT_SPACE,
        bump
    )]
    pub config: Account<'info, Config>,

    pub system_program:Program<'info, System>
}

impl <'info> Initialize<'info> {
    pub fn initialize(&mut self , _fee:u64, bumps:&InitializeBumps)->Result<()>{
        self.config.set_inner(Config { owner: self.owner.key(), fee: _fee, bump:bumps.config});
        Ok(())
    }
}
