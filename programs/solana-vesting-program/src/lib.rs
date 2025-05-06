#![allow(unexpected_cfgs)]

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use instructions::*;
use solana_security_txt::security_txt;
pub use state::*;

declare_id!("B6Ten95rDWqw8MMJy6hy2GHxiQrzjKAYBtFzFkCfuwVu");

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "Lumeryn Vesting Program" ,
    project_url:  "https://github.com/Lumeryn/solana-vesting-program",
    policy:  "https://github.com/Lumeryn/solana-vesting-program/scurity.md",
    contacts:  "mailto:dev@lumeryn.com",
    preferred_languages: "en",
    source_code: "https://github.com/Lumeryn/solana-vesting-program"
}

#[program]
pub mod solana_vesting_program {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        ctx: Context<InitializeVesting>,
        amount: u64,
        start_time: i64,
        end_time: i64,
        cliff_percentage: u8,
        payment_interval: Option<i64>,
        name: String,
        revocable: bool,
    ) -> Result<()> {
        initialize::initialize_handler(
            ctx,
            amount,
            start_time,
            end_time,
            cliff_percentage,
            payment_interval,
            name,
            revocable,
        )
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        claim::claim_handler(ctx)
    }

    pub fn revoke(ctx: Context<Revoke>) -> Result<()> {
        revoke::revoke_handler(ctx)
    }

    pub fn estimate(ctx: Context<ReadOnlyClaim>) -> Result<u64> {
        estimate_claimable::estimate_claimable_handler(ctx)
    }
}
