# WildCard DEV — One-Path Owner Media Workflow

**Occam's Razor:** Owner-supplied asset → choose intended audience → integrate → verify → Owner Gate → release. Never route a public asset through private storage just because its subject is adult-themed.

## Public Friends cards, avatars, teasers, and banners
Reuse the WildCard DEV website's existing `/public/static` assets and React components, as approved. No Party upload or extra administrative action.

## Intentionally member-only After Hours media
Reuse Party's existing `api/afterhours/media-admin` start / signed PUT / finish process. No new database, storage bucket, or third-party vendor.

One-time workstation pairing (Owner browser session):
1. Sign in to `https://party.wildcarddev.com/?app=afterhours-admin`.
2. In **Connect Penny's workstation**, choose **Create workstation pairing key**, then **Copy key**.
3. On the same Windows laptop, ask Penny to run `scripts/afterhours-upload.ps1 -PairFromClipboard`. This stores the key under `%APPDATA%\WildCardDEV\afterhours-upload-credential.dpapi`, encrypted to that Windows account. Manual fallback: run `-Pair` and paste at the hidden prompt. Never paste the pairing key into chat, GitHub, or logs.
4. Future Owner-approved uploads use the connected laptop:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/afterhours-upload.ps1 -Mode upload -Area penny -File "C:\path\approved.webm"`
   Change `-Area` to `kandy` or `ashley`. Check without upload using `-Mode check -Area penny -Name file.webm`.
5. An existing ready name is not overwritten or duplicated unless the Owner specifically approves `-NewVersion`.

The paired key is valid **only** on the existing private-media upload API, for check/start/finish. It does not authenticate Messenger, grant gallery views, mint other keys, or alter private access permissions. The key is stored as a one-way scoped hash in the **existing `wildcard_sessions` table**, expires after 90 days, and may be revoked in Owner Admin. Revocation does not affect normal Messenger sessions.

Local workstation command uses HTTPS, never copies production database/S3 credentials, does not log the scoped key, and removes its environment variable on exit. The private media API verifies the uploaded object's size/type before it is marked ready. The existing storage namespace and member permissions remain unchanged.

**Owner Gate:** No unapproved upload, commit, or production release. Record exact SHAs, CI status, and production deployment. Do not claim an end-to-end upload is verified until a real Owner pairing and authorized transfer have succeeded. When Desktop Commander is offline, report the blocker instead of inventing a completion.

**Cleanup:** `scripts/afterhours-upload.ps1 -Unpair` clears local credential; **Revoke workstation keys** in Owner Admin invalidates server-issued keys. Both actions are independent.
