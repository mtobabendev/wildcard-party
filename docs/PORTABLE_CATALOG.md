# Portable catalog operations

Export all six saved layouts and media filename references as versioned JSON in the Owner editor. Keep the file private with original local assets. It is not a full database backup: no asset bytes, passwords, tokens, storage keys, access permissions or sessions are included. Avoid concurrent edits during export.

After a database change, use the existing multi-file uploader with the original stored filenames. Load the catalog JSON, select the page, refresh media, and load a draft. Exact ID or unique filename/MIME matches rebind references. Missing or ambiguous assets block restoration. Review and save through the normal revision checks.

An export after data loss cannot recover missing layouts. The media listing is capped at 100 per creator; references outside the listing fail validation. Collection placement uses the existing uploader and collection editor. A full database backup is necessary for exact collection and account recovery.
