-- Apply only to isolated pennycore_oauth_demo. OAuth state is opaque.
ALTER TABLE public.demo_oauth_grants DROP CONSTRAINT demo_oauth_grants_oauth_state_check, ADD CONSTRAINT demo_oauth_grants_oauth_state_check CHECK (length(oauth_state) BETWEEN 1 AND 4096);
