# Penny Discord conversational continuity

Conversation history is **opt-in per user, guild and channel**, separate from permanent memory notes.

One-time opt-in: `/penny question:keep our conversation`. Future ordinary `/penny` messages in that channel may include the last **four successful public exchanges** from the same visitor, within **24 hours**. `/penny question:clear our conversation` clears the current conversation but remains opted in. `/penny question:stop remembering our conversation` clears and disables continuity. These controls respond privately.

Ordinary slash-command messages and AI replies remain publicly visible as before. Notes explicitly saved using `remember that...` stay separate and are read only through explicit private `with memory:` requests. Never use other users' saved notes or chats. No cross-channel or cross-account linking. No Owner PennyCore access.

Only successful provider responses are recorded, idempotently keyed by interaction ID. History is capped to four exchanges per subject. Expired history is not read after 24 hours, and old rows are deleted opportunistically on subsequent memory requests (not a guaranteed timed physical purge; periodic cleanup should precede scale-up). Consent records persist until the user disables them.

Party memory backend accepts `convo_enable`, `convo_read`, `convo_append`, `convo_clear`, `convo_disable` on the authenticated bridge. Each identity comes from the verified Discord interaction, not its text.
