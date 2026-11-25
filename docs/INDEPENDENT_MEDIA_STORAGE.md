# Independent private media storage

The original S3 settings remain untouched. Existing keys under afterhours/ always resolve to the original bucket; new uploads can explicitly select a separate Supabase S3 backend. No automatic write fallback. Do not remove the old settings while old records exist.

In Supabase Storage, create or select a **private** bucket and enable the S3 protocol. Generate server-side S3 credentials in Storage Settings. In the Party Vercel project, configure the following **Production-only** values:

- PARTY_MEDIA_STORAGE_PROVIDER=supabase
- PARTY_MEDIA_S3_ENDPOINT (direct storage S3 endpoint from the Supabase dashboard, e.g. https://project-ref.storage.supabase.co/storage/v1/s3)
- PARTY_MEDIA_S3_REGION (as shown in Supabase S3 settings)
- PARTY_MEDIA_S3_BUCKET (private bucket name)
- PARTY_MEDIA_S3_ACCESS_KEY_ID and PARTY_MEDIA_S3_SECRET_ACCESS_KEY (mark sensitive; never share with browser or chat)

Redeploy after setting all six. The Free storage tier has a 50 MB per-file maximum, and separate aggregate quota; do not assume that it can hold the entire original catalog. The 50,000,000-byte cap is enforced before registering uploads. Test using a small neutral file and verify private download authorization. Uploads use 15-minute signed PUT URLs; media access still requires the existing membership/owner checks. Existing pending rows are not deleted or falsely marked ready. No storage credentials are included here.

This is a storage routing change, not a migration or recovery of historical objects. Messenger attachments and legacy import maintain their existing backend; no other service is switched implicitly.
