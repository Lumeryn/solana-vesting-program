use anchor_lang::prelude::*;

#[error_code]
pub enum VestingError {
    #[msg("Invalid time range.")]
    InvalidTimeRange,
    #[msg("Cliff not reached.")]
    CliffNotReached,
    #[msg("Nothing to claim.")]
    NothingToClaim,
    #[msg("Math overflow.")]
    MathOverflow,
    #[msg("Cliff percentage must be between 0 and 100.")]
    InvalidCliff,
    #[msg("Payment interval must be positive.")]
    InvalidInterval,
    #[msg("Vesting is not revocable.")]
    NotRevocable,
    #[msg("Vesting has been revoked.")]
    VestingRevoked,
    #[msg("beneficiary_token_account is not the same token type as the token in vault.")]
    TokenMintMismatch,
    #[msg("Vesting has already been revoked.")]
    AlreadyRevoked,
}
