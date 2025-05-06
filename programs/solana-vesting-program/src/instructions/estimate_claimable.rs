use anchor_lang::prelude::*;

use crate::Vesting;

#[derive(Accounts)]
pub struct ReadOnlyClaim<'info> {
    #[account()]
    pub vesting: Account<'info, Vesting>,
    pub signer: Signer<'info>,
}

pub fn estimate_claimable_handler(ctx: Context<ReadOnlyClaim>) -> Result<u64> {
    let vesting = &ctx.accounts.vesting;
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let claimable_amount = crate::utils::calculate_claimable_amount(vesting, now)?;
    Ok(claimable_amount)
}
