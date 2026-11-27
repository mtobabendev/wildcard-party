-- Party database only; never the private PennyCore database.
CREATE TABLE IF NOT EXISTS penny_public_notes(
  id uuid PRIMARY KEY,
  subject varchar(100) NOT NULL,
  note varchar(500) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject,note)
);
CREATE INDEX IF NOT EXISTS penny_public_notes_subject_idx ON penny_public_notes(subject,created_at);
