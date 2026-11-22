# After Hours access control: isolated preview handoff

Status at November 22, 2026: **NO WildCard production release. NO commit or push.**
Current server-side access system is staged, and independent private preview storage is verified.
Preview sign-in and authenticated media playback still require manual isolated Vercel secret setup.

## Source worktrees (Owner Gate)

- Party: `C:\Users\mtoba\Coding\afterhours-access-stage\party`, branch `stage-afterhours-owner-gates`, HEAD `248d0ab8c0013049858350a3e56cb707c71cc621`.
- Current site: `C:\Users\mtoba\Coding\afterhours-access-stage\site-preview`, branch `stage-afterhours-preview-current`, HEAD `799650ebdbe88fb3f73aa82273a2303b77cf3b5d`.
- Older `site` and `site-current` branches are retained as local recovery copies. **Do not merge or deploy these older worktrees.**
- Live Git main was verified at the above exact SHAs. No Git commit/push performed by this stage.
- Current site's Snow Bird, Evemarie, Karley and the other friends' slideshows, mobile/desktop UI and looping-video behavior preserved.
- The obsolete client-side `216` dial is removed from the staged Penny route, replaced by Messenger permissions.

## Dedicated isolated Neon preview (NOT production Messenger database)

- Neon project name: `wildcard-afterhours-isolated-preview`.
- Project ID: `summer-sea-41575141`.
- Branch: `preview`, ID: `br-purple-shadow-bc0ohc8b`.
- Database: `wildcard_preview`.
- Tables: `wildcard_accounts`, `wildcard_sessions`, `wildcard_afterhours_grants`, `wildcard_afterhours_audit`, `wildcard_afterhours_media`.
- Separate private object bucket: `wildcard-afterhours-preview-private`.
- Synthetic, disabled-login fixture accounts `preview_owner` and `preview_member`; no live Messenger user accounts or session tokens copied.
- Preview member has only a Penny test grant. Database tests confirm that case-insensitive literal member search works, that % is not treated as a wildcard, and that revoke/regrant changes permission rows.
- The previous SQL `LIKE ... ESCAPE` error was fixed in `lib/afterhours-access.js` using literal-substring `position(lower(...))`.

## Private media transfer and real storage verification

- `39` unique private files uploaded, `42,492,298` bytes (about 40.52 MiB).
- All 39 correspond to SHA-256-verified copies in `C:\Users\mtoba\Coding\afterhours-access-stage\private-media\penny`.
- Their manifest is `private-media\migration-manifest.json` outside both Git repos.
- All 39 assets are removed only from the latest *isolated feature working tree* public/static, not Git main or existing production deployments.
- Neon storage listing: exactly 39 `afterhours/penny/` objects, every object size matching the local verified manifest.
- Neon `wildcard_afterhours_media` contains **39 ready rows**, all for Penny; all 39 names unique, exact aggregate `42,492,298` bytes.
- Storage probe: signed PUT HTTP 200; unsigned GET HTTP 403; browser-origin OPTIONS preflight HTTP 200 and Access-Control-Allow-Origin `*`.
- Real signed GET for `1.jpg`: HTTP 200, size 200358, SHA-256 matched local original.
- Previously public media can still exist in old browser caches, Git history or older Vercel deployments. Do not assume past exposure can be reversed.
- Kandy/Ashley private vaults remain empty; their previously public showcase and Time Capsule files were not removed.

## Isolated Vercel shell

- Separate Vercel project name: `wildcard-afterhours-party-preview`.
- Vercel project ID: `prj_M241D5f0XvqpKvFIfxFVIql8cECt`; team `matt-tobabens-projects`.
- Protected URL: `https://wildcard-afterhours-party-preview-g9oakyzo3.vercel.app`.
- Deployment ID: `9RWPdzoLpc7w5gWm7cdRxDPfJQXm`.
- Vercel's first deployment was automatically labeled **production of this new isolated project**. It is NOT linked to or replacing `party.wildcarddev.com` or `www.wildcarddev.com`. Vercel deployment protection remains enabled.
- Real Vercel build: READY, proving the official cloud build can compile the staged Party code.
- Verified authenticated Vercel CLI requests without Messenger login: Penny access 401, invalid area 400, Owner admin 401, private media list 401, bridge HTML 200.
- Only `AFTERHOURS_PREVIEW_MODE` is configured as this project's environment variable. The protected shell has no Neon DB/storage secrets and must remain fail-closed.

## Blocker and safe credential setup

An automated secret transfer from Neon into Vercel was blocked by a safety check. Do **not** circumvent it.
Generated but unused storage credential was revoked. Temporary local secret file and presigned upload/download ticket files were deleted.

In the owner's browser:
1. Open the isolated Neon project above, branch `preview`, use **Connect** and select database `wildcard_preview`. Do not use the production Messenger database URL.
2. Under Neon Storage, choose the **private** `wildcard-afterhours-preview-private` bucket and create a new scoped `storage:read` / `storage:write` credential. Never paste these credentials into chat.
3. In Vercel's separate `wildcard-afterhours-party-preview` project, set these values for **Preview only**: `DATABASE_URL`, `PENNYCORE_OWNER_ACCOUNT_ID`, `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `NEON_STORAGE_BUCKET`.
4. `PENNYCORE_OWNER_ACCOUNT_ID` must refer to the synthetic isolated preview Owner account, not production. Current synthetic Preview Owner login is intentionally disabled and needs a valid scrypt password before login testing.
5. After Preview env configuration, deploy a new **Preview** of this separate project. Its initial existing test deployment was automatically labeled production and does not receive Preview-only variables.
6. Verify signed-in Owner and member accounts, three independent grants, password reset and session invalidation, direct unauthorized media access, revocation, and real video seeking.
7. A separate website preview/origin and browser-cookie test remain necessary before production. Site currently points at `party.wildcarddev.com` and must not be treated as connected to this isolated Preview.
8. Review both full Git diffs and request explicit Owner approval before any commit, push, main-site deploy, or promotion.

## Verification summary

- Latest staged site: `npm.cmd run build` PASS, `node --test` 45/45 PASS.
- Party: `node --test` 72/72 PASS; cloud build READY.
- `git diff --check` clean on both staging worktrees.
- No existing production Vercel project, domain, database, or storage was changed. No Git commits or pushes.
