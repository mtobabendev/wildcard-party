# Separate recovery object storage

Use a private bucket and server-only S3 credentials. Configure the production environment:

- PARTY_STORAGE_PROVIDER=supabase
- PARTY_STORAGE_ENDPOINT=https://<project-ref>.storage.supabase.co/storage/v1/s3
- PARTY_STORAGE_REGION=<dashboard region>
- PARTY_STORAGE_BUCKET=<private bucket>
- PARTY_STORAGE_ACCESS_KEY_ID=<server-side S3 access key>
- PARTY_STORAGE_SECRET_ACCESS_KEY=<server-side S3 secret>

Do not use browser-exposed variables or share credentials in chat. Configure all variables before redeploying. Existing AWS_* and NEON_STORAGE_BUCKET variables remain intact. Without the explicit provider selector the application retains legacy storage. Newly registered recovery objects have a versioned key prefix; existing keys keep their original destination. Missing credentials fail closed. The recovery provider limits files to 50,000,000 bytes. The legacy import probe is disabled while recovery storage is selected. Messenger attachment storage is unchanged.

Verify with a harmless synthetic file and an authorized owner session: start, transfer, finish, then download; test anonymous rejection and confirm the bucket remains private. Do not retry failed writes against another provider. Existing pending records are retained and may be retried as fresh uploads. No storage migration or asset copying is performed by this release.
