# WildCard Party database portability and recovery

This change keeps existing Neon HTTP connections unchanged while enabling any compatible PostgreSQL server via the standard PostgreSQL protocol. The same parameterized SQL and authentication, membership and media catalog tables remain in use. Separate Nexus and demo database URLs retain their independent configuration.

## Recovery order (do not switch to an empty database)
1. Preserve the existing production database, private object bucket and credentials. Do not delete branches, reset passwords, disable membership checks, or rotate encryption keys for recovery.
2. Obtain a verified production PostgreSQL logical backup or export. The current suspended source may reject all SQL, including export. A schema-only dump is not a user data backup.
3. Provision a separate PostgreSQL database with sufficient free storage and a reachable, certificate-verified endpoint. The local Raspberry Pi is an option if it can be reached securely by the application. Test on isolated infrastructure first.
4. Use standard pg_dump and pg_restore (custom format, no owner or ACL restoration) on an empty, isolated destination. Keep credentials in local environment variables, never commits or logs. Verify counts of accounts, sessions, membership grants, posts, conversations, messages, media catalog and creator configuration against the source. Preserve UUIDs and password hashes, and keep sessions only if the relevant existing signing/auth configuration is unchanged.
5. Copy private objects separately to a compatible private object store if changing storage providers. Verify object sizes and access controls before serving any migrated catalog. Database portability alone does not migrate objects. Existing S3 client configuration remains unchanged; current NEON_STORAGE_BUCKET variable is a bucket name, not a requirement that the bucket provider be Neon.
6. Test authentication, membership, reads, writes and private object retrieval on the destination using non-sensitive fixtures; ensure cross-creator access is rejected.
7. After owner approval, change production DATABASE_URL and any explicitly approved storage settings together. Keep the old production database and storage intact. Verify production before allowing writes. Never silently fail over writes to a second database.
8. Establish recurring encrypted off-provider backups with restore tests and independent quota monitoring. A free hosted PostgreSQL plan can also have egress limits and suspensions. Keep media bytes separate from database usage and choose provider terms/limits that match the application.

## Scope
No production connection settings, data, storage objects or provider accounts are changed by this PR. Existing deployments continue using Neon until the owner approves a verified cutover. No automatic recovery is possible if the only copy of the source data is inaccessible.
