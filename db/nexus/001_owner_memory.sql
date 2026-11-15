-- Fresh isolated database only. No existing journal was activated.
CREATE TABLE nexus_owner_memory (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 account_id uuid NOT NULL,
 request_id uuid NOT NULL,
 content_digest text NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
 envelope text NOT NULL CHECK (char_length(envelope) BETWEEN 20 AND 40000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,request_id), UNIQUE(account_id,content_digest)
);
CREATE INDEX nexus_owner_memory_account_id_idx ON nexus_owner_memory(account_id,id DESC);
CREATE TABLE nexus_memory_receipts (
 account_id uuid NOT NULL, request_id uuid NOT NULL,
 content_digest text NOT NULL, source text NOT NULL CHECK(source IN ('chatgpt','gemini','grok','ollama','copilot','manual')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,request_id),
 FOREIGN KEY(account_id,content_digest) REFERENCES nexus_owner_memory(account_id,content_digest)
);
CREATE INDEX nexus_memory_receipts_digest_idx ON nexus_memory_receipts(account_id,content_digest);
-- Invoker rights; transaction-level owner lock serializes retries and concurrent dedup.
CREATE FUNCTION nexus_capture(p_account uuid,p_request uuid,p_envelope text,p_digest text,p_source text)
RETURNS TABLE(id text,request_id text,envelope text,created_at text,content_digest text,sources text[],duplicate boolean,conflict boolean)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE prior public.nexus_memory_receipts%ROWTYPE; canonical public.nexus_owner_memory%ROWTYPE; inserted boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_account::text,0));
 SELECT r.* INTO prior FROM public.nexus_memory_receipts r WHERE r.account_id=p_account AND r.request_id=p_request;
 IF FOUND AND (prior.content_digest<>p_digest OR prior.source<>p_source) THEN
  RETURN QUERY SELECT NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,NULL::text[],false,true; RETURN;
 END IF;
 INSERT INTO public.nexus_owner_memory(account_id,request_id,content_digest,envelope) VALUES(p_account,p_request,p_digest,p_envelope)
 ON CONFLICT ON CONSTRAINT nexus_owner_memory_account_id_content_digest_key DO NOTHING RETURNING * INTO canonical;
 inserted:=FOUND;
 IF NOT inserted THEN SELECT m.* INTO STRICT canonical FROM public.nexus_owner_memory m WHERE m.account_id=p_account AND m.content_digest=p_digest; END IF;
 INSERT INTO public.nexus_memory_receipts(account_id,request_id,content_digest,source) VALUES(p_account,p_request,p_digest,p_source) ON CONFLICT ON CONSTRAINT nexus_memory_receipts_pkey DO NOTHING;
 RETURN QUERY SELECT canonical.id::text,canonical.request_id::text,canonical.envelope,canonical.created_at::text,canonical.content_digest,
 ARRAY(SELECT DISTINCT r.source FROM public.nexus_memory_receipts r WHERE r.account_id=p_account AND r.content_digest=p_digest ORDER BY r.source),NOT inserted,false;
END; $$;
REVOKE EXECUTE ON FUNCTION nexus_capture(uuid,uuid,text,text,text) FROM PUBLIC;
-- Runtime: SELECT/INSERT on both tables, USAGE on identity sequence,
-- EXECUTE on nexus_capture only. No UPDATE, DELETE, CREATE or TRUNCATE.
