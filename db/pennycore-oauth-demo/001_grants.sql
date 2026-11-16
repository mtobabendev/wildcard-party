-- Apply only to a fresh isolated synthetic OAuth database, not the continuity DB.
CREATE TABLE demo_oauth_grants (
 nonce_hash char(64) PRIMARY KEY CHECK(nonce_hash ~ '^[a-f0-9]{64}$'),
 account_id uuid NOT NULL,
 client_id text NOT NULL CHECK(client_id='pennycore-gemini-demo-v1'),
 redirect_uri text NOT NULL,
 oauth_state text NOT NULL CHECK(length(oauth_state) BETWEEN 1 AND 1024),
 challenge char(43) NOT NULL,
 resource text NOT NULL CHECK(resource='https://party.wildcarddev.com/api/pennycore-auth-demo'),
 scope text NOT NULL CHECK(scope='pennycore.demo.read'),
 consent_expires timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 consent_used boolean NOT NULL DEFAULT false,
 code_hash char(64) UNIQUE CHECK(code_hash ~ '^[a-f0-9]{64}$'),
 code_expires timestamptz,
 token_hash char(64) UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 token_expires timestamptz,
 revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX demo_oauth_grants_account_idx ON demo_oauth_grants(account_id);
-- Separate runtime login with only SELECT, INSERT, and UPDATE on this table.
-- No access to the real journal, project memory, or Party database.
-- Expired grants remain inert; retention cleanup requires a separate maintenance policy.
