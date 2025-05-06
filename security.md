# Security Policy

## Reporting a Vulnerability

If you discover a security issue, please send an encrypted report to:

**dev\_\_at\_\_lumeryn.com** (please replace `__at__` with `@`)

### Steps to Encrypt Your Report

1. Download our public key:

   ```bash
   curl -O https://raw.githubusercontent.com/Lumeryn/solana-vesting-program/refs/heads/main/key.pgp
   ```

2. Import the key into your GPG keyring:

   ```bash
   gpg --import key.pgp
   ```

3. Prepare your report in a text file (e.g. `report.txt`).

4. Encrypt the report for `dev@lumeryn.com`:

   ```bash
   gpg --encrypt --recipient "dev@lumeryn.com" --armor report.txt
   ```

   This produces `report.txt.asc`.

5. Email the encrypted file (`report.txt.asc`) to **dev@lumeryn.com**.

## What to Include

- Detailed description of the issue
- Steps to reproduce
- Impact assessment
- Your contact information (optional)

## Response Timeline

We aim to acknowledge receipt within 3 business days and will keep you updated on our remediation plan.

## Acknowledgements

We appreciate responsible disclosure and will credit you in our project’s security acknowledgements unless you request anonymity.
