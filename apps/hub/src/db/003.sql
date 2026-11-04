ALTER TABLE jobs ADD COLUMN delivery TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE jobs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'download';
ALTER TABLE jobs ADD COLUMN requested_format TEXT;
ALTER TABLE jobs ADD COLUMN formats_json TEXT;
ALTER TABLE jobs ADD COLUMN destination_profile_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE devices ADD COLUMN profiles_json TEXT NOT NULL DEFAULT '["default"]';
