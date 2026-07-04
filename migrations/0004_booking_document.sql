-- The client's documents (estimate/invoice) as HTML, one row per kind so no single value and
-- no booking row approaches D1's 2 MB row cap. Mirrors src/schema.ts.
CREATE TABLE IF NOT EXISTS booking_document (
  booking_token TEXT NOT NULL REFERENCES booking(token),
  kind TEXT NOT NULL,
  html TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (booking_token, kind)
);
