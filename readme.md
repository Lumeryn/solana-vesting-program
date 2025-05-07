# Solana Vesting Program

A complete on‐chain token vesting solution built with [Anchor](Anchor.toml), including:

- An Anchor program in
  [`programs/solana-vesting-program/`](programs/solana-vesting-program/)
- A TypeScript CLI in
  [`cli/cli.ts`](cli/cli.ts)
- Jest integration tests in
  [`tests/vesting.test.ts`](tests/vesting.test.ts)
- Rust unit tests in
  [`programs/solana-vesting-program/src/utils.rs`](programs/solana-vesting-program/src/utils.rs)

## Program Address

The program is deployed on the Solana devnet at:

[B6Ten95rDWqw8MMJy6hy2GHxiQrzjKAYBtFzFkCfuwVu](https://explorer.solana.com/address/B6Ten95rDWqw8MMJy6hy2GHxiQrzjKAYBtFzFkCfuwVu?cluster=devnet)

We will update this documentation with the mainnet address once we deploy there.

## Prerequisites

- Rust & Anchor CLI (see `anchor_version` in [Anchor.toml](Anchor.toml))
- Node.js & npm/yarn (see [package.json](package.json))
- Solana CLI v1.14+

## Building

1. Install Rust toolchain and Anchor
2. Run
   ```sh
   anchor build
   ```
   This compiles the program defined in [`Cargo.toml`](Cargo.toml) into `target/`.

## Deploying

Start a local Solana validator and deploy:

```sh
anchor localnet
anchor deploy
```

The deploy script is in
[`migrations/deploy.ts`](migrations/deploy.ts).

## Running Tests

### Rust Unit Tests

```sh
cd programs/solana-vesting-program
cargo test
```

Key logic is exercised in
[`programs/solana-vesting-program/src/utils.rs`](programs/solana-vesting-program/src/utils.rs).

### Integration Tests (Jest)

```sh
anchor test
```

## CLI Usage

The CLI in [`cli/cli.ts`](cli/cli.ts) offers:

- init: create a vesting schedule
- show: print a vesting account
- estimate: calculate claimable tokens
- revoke: revoke unvested tokens

Example:

```sh
npx ts-node cli/cli.ts \
  --program-id <PROGRAM_ID> \
  init \
  --beneficiary <BENEFICIARY_PUBKEY> \
  --mint <MINT_PUBKEY> \
  --name "<LABEL>" \
  --amount <AMOUNT> \
  --start <START_TS> \
  --end <END_TS>
```

## More

- Read the on‐chain entrypoint in
  [`programs/solana-vesting-program/src/lib.rs`](programs/solana-vesting-program/src/lib.rs)
- See event definitions in
  [`programs/solana-vesting-program/src/events/`](programs/solana-vesting-program/src/events/)
- Errors are defined in
  [`programs/solana-vesting-program/src/error.rs`](programs/solana-vesting-program/src/error.rs)
