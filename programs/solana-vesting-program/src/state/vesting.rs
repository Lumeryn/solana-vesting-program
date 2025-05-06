use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Vesting {
    pub beneficiary: Pubkey,
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub start_time: i64,
    pub end_time: i64,
    pub total_amount: u64,
    pub claimed_amount: u64,
    pub cliff_percentage: u8,
    pub payment_interval: i64,
    #[max_len(32)]
    pub name: String,
    pub revocable: bool,
    pub revoked_at: i64,
    pub last_claimed_at: i64,
    pub bump: u8,
}
