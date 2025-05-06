use crate::error::*;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked};

#[derive(Accounts)]
#[instruction(amount: u64, start_time: i64, end_time: i64, cliff_percentage: u8, payment_interval: Option<i64>, name: String, revocable: bool)]
pub struct InitializeVesting<'info> {
    #[account(
        init,
        seeds = [b"vesting", beneficiary.key().as_ref(), mint.key().as_ref(),name.as_bytes()],
        bump,
        payer = payer,
        space = 8 + Vesting::INIT_SPACE,
    )]
    pub vesting: Account<'info, Vesting>,

    #[account(
        init,
        seeds = [b"vault", vesting.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vesting,
        token::token_program = token_program,

        payer = payer,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut, token::mint = mint, token::authority = payer, token::token_program = token_program,)]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Only used as a key
    pub beneficiary: AccountInfo<'info>,
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
#[allow(clippy::too_many_arguments)]
pub fn initialize_handler(
    ctx: Context<InitializeVesting>,
    amount: u64,
    start_time: i64,
    end_time: i64,
    cliff_percentage: u8,
    payment_interval: Option<i64>,
    name: String,
    revocable: bool,
) -> Result<()> {
    require!(end_time > start_time, VestingError::InvalidTimeRange);
    require!(cliff_percentage <= 100, VestingError::InvalidCliff);
    if let Some(interval) = payment_interval {
        require!(interval > 0, VestingError::InvalidInterval);
    }

    let vesting_key = ctx.accounts.vesting.key();

    let vesting = &mut ctx.accounts.vesting;
    vesting.beneficiary = ctx.accounts.beneficiary.key();
    vesting.creator = ctx.accounts.payer.key();
    vesting.mint = ctx.accounts.mint.key();
    vesting.start_time = start_time;
    vesting.end_time = end_time;
    vesting.total_amount = amount;
    vesting.claimed_amount = 0;
    vesting.cliff_percentage = cliff_percentage;
    vesting.payment_interval = payment_interval.unwrap_or(0);
    vesting.name = name;
    vesting.revocable = revocable;
    vesting.revoked_at = 0;
    vesting.last_claimed_at = 0;
    vesting.bump = ctx.bumps.vesting;

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.source_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        authority: ctx.accounts.payer.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    anchor_spl::token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    emit!(VestingInitialized {
        vesting: vesting_key,
        beneficiary: vesting.beneficiary,
        creator: vesting.creator,
        total_amount: amount,
    });

    Ok(())
}
