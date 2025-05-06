use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::TransferChecked,
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface},
};

use crate::error::*;
use crate::{events::RevokedEvent, state::Vesting};

#[derive(Accounts)]
pub struct Revoke<'info> {
    #[account(mut, has_one = creator)]
    pub vesting: Account<'info, Vesting>,
    #[account(
        mut,
        seeds = [b"vault", vesting.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vesting,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// Where unvested tokens go back to
    #[account(mut,
        token::mint = mint,
        token::token_program = token_program,
        token::authority = creator,
    )]
    pub recipient_account: InterfaceAccount<'info, TokenAccount>,

    /// Authority allowed to revoke (the original creator)
    pub creator: Signer<'info>,
    #[account()]
    /// CHECKED:
    // pub beneficiary: AccountInfo<'info>,
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}
impl Revoke<'_> {
    fn revoke_tokens(&self, unvested: u64, signer_seeds: &[&[&[u8]]; 1]) -> Result<()> {
        let cpi_accounts = TransferChecked {
            from: self.vault.to_account_info(),
            to: self.recipient_account.to_account_info(),
            mint: self.mint.to_account_info(),
            authority: self.vesting.to_account_info(),
        };
        let cpi_context = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );

        token_interface::transfer_checked(cpi_context, unvested, self.mint.decimals)
    }

    fn close_ata(&self, signer_seeds: &[&[&[u8]]; 1]) -> Result<()> {
        let cpi_accounts = CloseAccount {
            account: self.vault.to_account_info(),
            destination: self.creator.to_account_info(),
            authority: self.vesting.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token_interface::close_account(cpi_ctx)
    }
}

pub fn revoke_handler(ctx: Context<Revoke>) -> Result<()> {
    let vesting = &ctx.accounts.vesting;

    // Only revocable schedules can be revoked
    require!(vesting.revocable, VestingError::NotRevocable);
    // Prevent double-revocation -- although as the vault is closed the transaction even doesn't get to here
    require!(vesting.revoked_at == 0, VestingError::AlreadyRevoked);

    // Compute unvested remainder
    let unvested = vesting
        .total_amount
        .checked_sub(vesting.claimed_amount)
        .ok_or(VestingError::MathOverflow)?;

    // Derive vault bump for signing
    let seeds: &[&[u8]] = &[
        b"vesting",
        vesting.beneficiary.as_ref(),
        ctx.accounts.vault.mint.as_ref(),
        vesting.name.as_bytes(),
        // Add other seeds used to derive the vesting PDA
        &[vesting.bump],
    ];
    let signer_seeds = &[seeds];
    ctx.accounts.revoke_tokens(unvested, signer_seeds)?;

    // 2️⃣ Close the vault and refund its rent to the creator
    ctx.accounts.close_ata(signer_seeds)?;

    let vesting = &mut ctx.accounts.vesting;
    // 3️⃣ Mark the vesting as revoked and emit event
    vesting.revoked_at = Clock::get()?.unix_timestamp;
    emit!(RevokedEvent {
        vesting: vesting.key(),
        unvested,
        timestamp: vesting.revoked_at,
    });

    Ok(())
}
