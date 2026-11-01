# LiTT DR — Credential Recovery

How to regain full backup access when a device — or all devices — are lost.
No secret values are printed in this document.

## The recovery chain

```
B2 account OR scoped app key  ->  bucket litt-disaster-recovery
rclone crypt password         ->  decrypts phone-backups/ snapshots
litt_dr kit (AES-256 bundle)  ->  contains both of the above + ssh keys + docs
kit passphrase                ->  OFFLINE ONLY — you hold it
```

## Item-by-item recovery

| Item | Where it lives | How to recover it |
|---|---|---|
| B2 bucket/endpoint | `litt-disaster-recovery`, `s3.us-east-005.backblazeb2.com` | Public info — in this doc |
| B2 account access | your Backblaze login | Console → App Keys → create replacement key (bucket+prefix scoped, RW) |
| Scoped application key | `b2.env` (phone), `rclone.conf` (phone+PC), encrypted kit | Restore any copy, or create a NEW key in the console — old keys are not needed for reads |
| rclone config | `rclone.conf` copies, or rebuild manually (RUNBOOK sec. 8) | Copy file, or rebuild from `b2.env`+`cloud.pass` |
| Crypt password | `cloud.pass` (phone+PC `litt-phone-backups`), obscured inside `rclone.conf`, encrypted kit | Any copy. `rclone obscure <pass>` to rebuild conf from plaintext |
| PC SSH key | `litt_pc` (phone, configs tarball, kit) | Kit or config tarball |
| GitHub SSH key | `id_ed25519_litt_phone` (kit only) | Kit, or re-issue on GitHub |
| Kit passphrase | **delivered once in the mission report; store it offline NOW** | Your offline record — nowhere else |

## The encrypted kit

`litt-dr-kit-20261031.tar.gz.enc` — AES-256-CBC, PBKDF2 600k iters, salted.

Locations (3):
- `~/litt-backup/` (phone)
- `C:\Users\litbi\litt-phone-backups\` (PC)
- `littcrypt:/recovery-kit/` inside B2 (double-protected: ciphertext blob inside encrypted remote)

Contents (12 files): b2.env, cloud.pass, rclone.conf, litt_pc[.pub],
id_ed25519_litt_phone[.pub], KEEP-THIS-KEY.txt, RECOVERY-RUNBOOK.md,
RESTORE.sh, MANIFEST.txt.

Decrypt (any OS with openssl):
```
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in litt-dr-kit-20261031.tar.gz.enc | tar xz
```

## Full independence test (performed 2026-10-31)

In a clean proot environment, using ONLY the kit downloaded from B2 +
the offline passphrase: kit decrypted, its rclone.conf listed and decrypted
`littcrypt:/20261031`, cloud.pass hash-identical to the phone's. => Losing
both the phone AND the PC is recoverable given (a) B2 access and
(b) the passphrase.

## Escrow status

- Kit exists in 3 locations including cloud.
- **The passphrase exists nowhere on any device** — it was shown once in
  the mission report for you to store offline (password manager, written
  record, safe). Until you do that, independent escrow is OPEN: losing the
  passphrase AND both devices AND B2 console access = unrecoverable.

## If the crypt password is ever rotated

Snapshots encrypted under the old password remain decryptable ONLY with
the old one — keep prior `cloud.pass` values (they are appended to the kit
on rotation; never delete an old kit).
