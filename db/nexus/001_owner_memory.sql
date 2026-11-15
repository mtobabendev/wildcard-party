-- Apply explicitly to an isolated Nexus memory database as migration owner.
-- Runtime role must not own this table or have CREATE, UPDATE, DELETE or TRUNCATE.
CREATE TABLE nexus_owner_memory (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL,
  request_id uuid NOT NULL,
  envelope text NOT NULL CHECK (char_length(envelope) BETWEEN 20 AND 40000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,request_id)
);
CREATE INDEX nexus_owner_memory_account_id_idx ON nexus_owner_memory(account_id,id DESC);
-- Grant only SELECT, INSERT on the table and USAGE on its identity sequence
-- to the separately provisioned non-owner runtime role. No public grants.
