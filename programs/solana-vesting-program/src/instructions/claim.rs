use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::TransferChecked,
    token_interface::{self, Mint, TokenAccount, TokenInterface},
};

use crate::{error::*, events::VestingClaimed, utils, Vesting};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut,  has_one = beneficiary)]
    pub vesting: Account<'info, Vesting>,

    #[account(mut, seeds = [b"vault", vesting.key().as_ref()], bump,
        token::authority = vesting,
        token::mint = mint,
        token::token_program = token_program,)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = beneficiary,
     associated_token::authority = beneficiary,
        associated_token::mint = mint,
        associated_token::token_program = token_program,)]
    pub beneficiary_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub beneficiary: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

impl Claim<'_> {
    fn claim_tokens(&self, amount: u64) -> Result<()> {
        let cpi_accounts = TransferChecked {
            from: self.vault.to_account_info(),
            to: self.beneficiary_token_account.to_account_info(),
            mint: self.mint.to_account_info(),
            authority: self.vesting.to_account_info(),
        };

        let signer_seeds: &[&[u8]] = &[
            b"vesting",
            self.beneficiary.key.as_ref(),
            self.vault.mint.as_ref(),
            self.vesting.name.as_bytes(),
            // Add other seeds used to derive the vesting PDA
            &[self.vesting.bump],
        ];
        let s = &[signer_seeds];
        let cpi_ctx =
            CpiContext::new_with_signer(self.token_program.to_account_info(), cpi_accounts, s);
        token_interface::transfer_checked(cpi_ctx, amount, self.mint.decimals)
    }
}

pub fn claim_handler(ctx: Context<Claim>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let vesting = &mut ctx.accounts.vesting;

    require!(vesting.revoked_at == 0, VestingError::VestingRevoked);

    if now < vesting.start_time {
        return Err(error!(VestingError::CliffNotReached));
    }

    let claimable = utils::calculate_claimable_amount(vesting, now)?;
    require!(claimable > 0, VestingError::NothingToClaim);

    vesting.claimed_amount = vesting
        .claimed_amount
        .checked_add(claimable)
        .ok_or(VestingError::MathOverflow)?;
    vesting.last_claimed_at = now;
    ctx.accounts.claim_tokens(claimable)?;

    emit!(VestingClaimed {
        vesting: ctx.accounts.vesting.key(),
        amount: claimable,
        time: now,
    });

    Ok(())
}
