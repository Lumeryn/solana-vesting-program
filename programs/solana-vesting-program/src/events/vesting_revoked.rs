use anchor_lang::prelude::*;

#[event]
pub struct RevokedEvent {
    /// The vesting account that was revoked
    pub vesting: Pubkey,
    /// Amount of tokens returned to the creator
    pub unvested: u64,
    /// When the revocation occurred
    pub timestamp: i64,
}
