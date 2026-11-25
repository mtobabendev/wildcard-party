# Database recovery and backup operations

## Traffic budget
The closed widget and Party unread checks now run every 30s instead of 12s. Conversation list refresh uses 30s instead of 12s; open chat remains at 4s. Party presence runs every 45s instead of 30s (existing 90s online threshold). Hidden-page guards and immediate visible/focus recovery remain. Closed widget errors back off to 5 minutes; signed-out checks run every 2 minutes. Identical parent state messages no longer restart polling. These are request frequency reductions, not measured transfer savings.

Monitor the actual Supabase database egress and Vercel function invocations weekly, and compare with a baseline before and after deployment. Set an operational warning at 50% and action threshold at 75% of the actual plan limits. Do not rely on provider limits as alerts. Stop nonessential traffic before exhaustion. Private object delivery should remain separate from PostgreSQL. No automatic quota increase or paid plan activation.

## Independent PostgreSQL backup
Use the session pooler (5432) and provider CA, with verified TLS. Use a pg_dump client of the same or newer major version as the server. Use an authorized backup role or database administrator with access to all application tables (including RLS-protected records). Never store credentials in source control or command history.

From a trusted machine with PostgreSQL client tools:
- Set PGHOST, PGPORT=5432, PGDATABASE, PGUSER, PGSSLMODE=verify-full and PGSSLROOTCERT to the official CA path. Let pg_dump prompt for the password.
- Run pg_dump --format=custom --no-owner --no-acl --schema=public --file=<secure-local-path> --password. Do not copy Supabase-managed auth/storage schemas unless explicitly required.
- Encrypt the archive with an independent backup key using a supported encrypted backup tool before transferring it off-device. Keep the key separately; keep at least two independent copies. Never place a raw dump in Git or public cloud storage.
- Validate pg_restore --list and perform a restore on an isolated PostgreSQL instance, with no production connection configured. Check row counts, UUIDs, grants, creator configuration and foreign keys. Reapply the application role, table ownership, RLS, and restrictive grants before exposing any restored database; --no-acl does not preserve grants.
- Back up private object storage separately and preserve catalog-to-object mapping. Do not copy private content to an unauthorized destination. Backups of separate Nexus/demo databases require independent procedures.
- Schedule daily encrypted backups, weekly quota review and monthly isolated restore tests. Retain 7 daily and 4 weekly copies according to capacity and owner-approved retention. Do not delete existing backups automatically until retention is approved.

## Original Neon recovery
The original Neon database remains suspended (HTTP 402); do not overwrite or delete it. When accessible, export to a separate recovery instance, reconcile the temporary owner UUID and other newly created records by verified identity, then validate foreign keys and counts before a separate approved cutover. Do not blindly overwrite the new database or reassign grants by handle alone.

This document is an operational procedure, not evidence that a backup was executed or that an alert or schedule is active.
