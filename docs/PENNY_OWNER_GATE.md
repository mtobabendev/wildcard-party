# PC.2B — Owner project-memory gateway

Read-only, authenticated access to the six approved PC.1 project records from Penny Core in Messenger. Personal notes, AI history and human messaging remain independent. There is no operational permission, write route, model injection, cross-origin session sharing or automatic identity assignment.

## Trust boundary
- Explicitly bind the verified production Party account UUID using server-only PENNYCORE_OWNER_ACCOUNT_ID. Never infer ownership from a handle, display name, profile, request body or AI conversation.
- The production gateway additionally requires the existing owner-approved PC.1 read-only credential in PENNYCORE_READ_TOKEN, server-side only. Do not configure a write credential in Party. No browser/Git/chat token exposure.
- Without explicit configuration, deny access. Preview cannot read production memory even if configured. Tests use synthetic fixtures; no preview-to-production requests.
- Fixed HTTPS destination and six allowlisted latest record keys; no arbitrary query, writes, redirects or provider tools. Data is shown as inert JSON, not model instructions.
- Activation requires separate Owner Gate approval and verified production account binding; do not copy preview account IDs. An authenticated production persistence smoke test remains required for PC.2A.

## Verification
Run node --test test/penny-owner.test.js test/penny-core-state.test.js test/penny-core-handler.test.js. Verify preview guest 401, foreign origin 403, unsupported method 405. After approval and explicit configuration, verify ordinary account 403, authorized account status and six records, browser never receives read credential. No production credentials or grants are configured by this change.
