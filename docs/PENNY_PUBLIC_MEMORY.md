# Public Penny memory (opt-in, Discord)

**Not private PennyCore memory.** Saved facts are explicitly submitted by an individual Discord user through the signed /penny command. Storage is separated by verified Discord guild and user snowflakes. Other visitors cannot retrieve another user's notes.

- Max 20 notes per user, 500 characters per note.
- `remember that <fact>` saves one note.
- `what do you remember` lists saved notes.
- `forget <number>` deletes the numbered note.
- `forget everything` deletes all notes.
- No automatic recording of all messages, no cross-platform account linkage, no Owner permissions.

The Party API `/api/penny-memory` accepts requests only from its trusted Discord adapter using a constant-time-checked `PENNY_MEMORY_BRIDGE_SECRET`. Configure the *same newly generated secret*, at least 40 characters, in **Production** on the Party and WildCard DEV Vercel projects. Never place the token in frontend code or conversation logs.

The Party runtime creates the `penny_public_notes` table via idempotent DDL in the existing Party application database. A matching version-controlled SQL migration is included. Delete operations remove notes from that table; existing Party messages and PennyCore records are never changed. Revisit retention, export, and verified identity linking before expanding beyond this opt-in feature.
