use anchor_lang::prelude::*;

#[event]
pub struct VestingInitialized {
    pub vesting: Pubkey,
    pub beneficiary: Pubkey,
    pub creator: Pubkey,
    pub total_amount: u64,
}
