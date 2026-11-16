-- Apply only to the existing isolated pennycore_oauth_demo database.
-- The former static client is retired; existing grants, if any, remain inert.
CREATE TABLE demo_oauth_clients (
 slot integer PRIMARY KEY CHECK(slot BETWEEN 1 AND 64),
 client_id text UNIQUE NOT NULL CHECK(client_id ~ '^pcdemo_[A-Za-z0-9_-]{43}$'),
 account_id uuid NOT NULL,
 redirect_uris jsonb NOT NULL CHECK(jsonb_typeof(redirect_uris)='array' AND jsonb_array_length(redirect_uris) BETWEEN 1 AND 6),
 auth_method text NOT NULL CHECK(auth_method IN ('none','client_secret_basic','client_secret_post')),
 secret_hash char(64) CHECK(secret_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 CHECK((auth_method='none' AND secret_hash IS NULL) OR (auth_method<>'none' AND secret_hash IS NOT NULL))
);
ALTER TABLE demo_oauth_grants DROP CONSTRAINT demo_oauth_grants_client_id_check, ADD CONSTRAINT demo_oauth_grants_client_id_check CHECK(client_id='pennycore-gemini-demo-v1' OR client_id ~ '^pcdemo_[A-Za-z0-9_-]{43}$');
GRANT SELECT, INSERT, UPDATE ON public.demo_oauth_clients TO oauth_demo_runtime;
