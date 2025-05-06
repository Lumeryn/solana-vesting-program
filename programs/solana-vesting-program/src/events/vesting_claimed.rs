use anchor_lang::prelude::*;

#[event]
pub struct VestingClaimed {
    pub vesting: Pubkey,
    pub amount: u64,
    pub time: i64,
}
