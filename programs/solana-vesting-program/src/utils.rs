use anchor_lang::prelude::*;

use crate::{Vesting, VestingError};

pub fn calculate_claimable_amount(vesting: &Vesting, now: i64) -> Result<u64> {
    let now = now.min(vesting.end_time);

    if vesting.revoked_at > 0 || now < vesting.start_time {
        return Ok(0);
    }

    if now == vesting.end_time {
        return Ok(vesting.total_amount - vesting.claimed_amount);
    }

    let cliff_amount = vesting.total_amount * vesting.cliff_percentage as u64 / 100;

    let linear_amount = vesting
        .total_amount
        .checked_sub(cliff_amount)
        .ok_or(VestingError::MathOverflow)?;

    let elapsed = now - vesting.start_time;
    let duration = vesting.end_time - vesting.start_time;

    let vested = if vesting.payment_interval > 0 {
        let total_intervals = duration / vesting.payment_interval;
        let interval_count = elapsed / vesting.payment_interval;

        if total_intervals == 0 {
            if elapsed >= duration {
                linear_amount
            } else {
                0
            }
        } else {
            let amount_per_interval = linear_amount
                .checked_div(total_intervals as u64)
                .ok_or(VestingError::MathOverflow)?;
            amount_per_interval
                .checked_mul(interval_count as u64)
                .ok_or(VestingError::MathOverflow)?
        }
    } else {
        linear_amount
            .checked_mul(elapsed as u64)
            .ok_or(VestingError::MathOverflow)?
            .checked_div(duration as u64)
            .ok_or(VestingError::MathOverflow)?
    };

    let mut total_vested = cliff_amount + vested;
    if total_vested > vesting.total_amount {
        total_vested = vesting.total_amount;
    }

    if vesting.claimed_amount >= total_vested {
        Ok(0)
    } else {
        total_vested
            .checked_sub(vesting.claimed_amount)
            .ok_or(VestingError::MathOverflow.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vesting_template(overrides: Option<(u64, u64, u8, i64, i64, i64)>) -> Vesting {
        let (total_amount, claimed_amount, cliff_percentage, start_time, end_time, interval) =
            overrides.unwrap_or((1000, 0, 20, 1000, 2000, 0));
        Vesting {
            beneficiary: Pubkey::default(),
            creator: Pubkey::default(),
            mint: Pubkey::default(),
            start_time,
            end_time,
            total_amount,
            claimed_amount,
            cliff_percentage,
            payment_interval: interval,
            name: String::from("Test"),
            revocable: true,
            revoked_at: 0,
            last_claimed_at: 0,
            bump: 255,
        }
    }

    #[test]
    fn test_before_cliff() {
        let vesting = vesting_template(None);
        let result = calculate_claimable_amount(&vesting, 900).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_full_vesting_at_end() {
        let vesting = vesting_template(None);
        let result = calculate_claimable_amount(&vesting, 2000).unwrap();
        assert_eq!(result, 1000);
    }

    #[test]
    fn test_linear_without_interval() {
        let vesting = vesting_template(None);
        let result = calculate_claimable_amount(&vesting, 1500).unwrap();
        // 20% of 1000 = 200 cliff, linear = 800
        // elapsed 500s of 1000s = 50%, so 400
        assert_eq!(result, 200 + 400);
    }

    #[test]
    fn test_interval_vesting() {
        let vesting = vesting_template(Some((1000, 0, 10, 1000, 2000, 100)));
        let result = calculate_claimable_amount(&vesting, 1600).unwrap();
        // 10% = 100, 900 left for linear, over 10 intervals
        // 6 intervals passed = 90 * 6 = 540 + 100 = 640
        assert_eq!(result, 640);
    }

    #[test]
    fn test_revoked() {
        let mut vesting = vesting_template(None);
        vesting.revoked_at = 1500;
        let result = calculate_claimable_amount(&vesting, 1600).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_claimed_subtracted() {
        let mut vesting = vesting_template(None);
        vesting.claimed_amount = 100;
        let result = calculate_claimable_amount(&vesting, 2000).unwrap();
        assert_eq!(result, 900);
    }

    #[test]
    fn test_claim_after_some_already_claimed() {
        let mut vesting = vesting_template(None);
        // Start = 1000, End = 2000, Now = 1500, 20% cliff, 500 elapsed, 50% = 400 linear vested
        // Total vested = 600, already claimed = 100
        vesting.claimed_amount = 100;

        let result = calculate_claimable_amount(&vesting, 1500).unwrap();
        assert_eq!(result, 500);
    }

    #[test]
    fn test_claim_after_more_claimed_than_vested() {
        let mut vesting = vesting_template(None);
        vesting.claimed_amount = 800;

        // Only 600 should be vested at t=1500
        let result = calculate_claimable_amount(&vesting, 1500).unwrap();
        // Underflow protection: return 0
        assert_eq!(result, 0);
    }

    #[test]
    fn test_fully_claimed_before_end() {
        let mut vesting = vesting_template(None);
        vesting.claimed_amount = 1000;

        let result = calculate_claimable_amount(&vesting, 1500).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_fully_claimed_at_end() {
        let mut vesting = vesting_template(None);
        vesting.claimed_amount = 1000;

        let result = calculate_claimable_amount(&vesting, 2000).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_partial_interval_claimed() {
        let mut vesting = vesting_template(Some((1000, 100, 10, 1000, 2000, 100)));
        // 10% cliff = 100, 900 left → 90 per interval
        // At t=1600 → 6 intervals = 640 vested
        vesting.claimed_amount = 300;

        let result = calculate_claimable_amount(&vesting, 1600).unwrap();
        assert_eq!(result, 340);
    }

    #[test]
    fn test_claim_past_end_with_remaining() {
        let mut vesting = vesting_template(None);
        vesting.claimed_amount = 700;

        let result = calculate_claimable_amount(&vesting, 2500).unwrap();
        assert_eq!(result, 300);
    }

    #[test]
    fn test_no_claims_yet_past_end() {
        let vesting = vesting_template(None);
        let result = calculate_claimable_amount(&vesting, 2500).unwrap();
        assert_eq!(result, 1000);
    }

    #[test]
    fn test_start_equals_now_zero_elapsed() {
        let vesting = vesting_template(None);
        let result = calculate_claimable_amount(&vesting, 1000).unwrap();
        assert_eq!(result, 200); // Only cliff vested at start
    }

    #[test]
    fn test_zero_total_amount() {
        let vesting = vesting_template(Some((0, 0, 0, 1000, 2000, 0)));
        let result = calculate_claimable_amount(&vesting, 1500).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_now_after_end_time() {
        let vesting = vesting_template(None);
        let result = calculate_claimable_amount(&vesting, 9999).unwrap();
        assert_eq!(result, 1000); // Fully vested
    }
    #[test]
    fn test_zero_cliff_linear_halfway() {
        let vesting = vesting_template(Some((1000, 0, 0, 1000, 2000, 0)));
        let result = calculate_claimable_amount(&vesting, 1500).unwrap();
        assert_eq!(result, 500);
    }

    #[test]
    fn test_zero_cliff_with_intervals() {
        let vesting = vesting_template(Some((1000, 0, 0, 1000, 2000, 100)));
        let result = calculate_claimable_amount(&vesting, 1600).unwrap();
        // 6 intervals * 100 = 600
        assert_eq!(result, 600);
    }
    #[test]
    fn test_at_exact_start_time_with_cliff() {
        let vesting = vesting_template(None); // cliff = 20%
        let result = calculate_claimable_amount(&vesting, 1000).unwrap();
        assert_eq!(result, 200);
    }
    #[test]
    fn test_at_exact_start_time_zero_cliff() {
        let vesting = vesting_template(Some((1000, 0, 0, 1000, 2000, 0)));
        let result = calculate_claimable_amount(&vesting, 1000).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_zero_cliff_fully_claimed() {
        let vesting = vesting_template(Some((1000, 1000, 0, 1000, 2000, 0)));
        let result = calculate_claimable_amount(&vesting, 2000).unwrap();
        assert_eq!(result, 0);
    }

    #[test]
    fn test_interval_greater_than_duration() {
        let vesting = vesting_template(Some((1000, 0, 0, 1000, 1100, 1000)));
        let result = calculate_claimable_amount(&vesting, 1100).unwrap();
        // Only 1 interval fits, but duration = 100, so total_intervals = 0
        assert_eq!(result, 1000);
    }
}
