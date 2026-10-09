CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,email text NOT NULL UNIQUE,password_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions(hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS invitations(hash text PRIMARY KEY,email text NOT NULL,used_at timestamptz);
CREATE TABLE IF NOT EXISTS notes(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,id uuid NOT NULL,revision uuid NOT NULL,document jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,id));
CREATE TABLE IF NOT EXISTS attachments(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,id text NOT NULL,name text NOT NULL,mime text NOT NULL,sha256 text NOT NULL,size integer NOT NULL,PRIMARY KEY(user_id,id));
CREATE TABLE IF NOT EXISTS knowledge(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,id uuid NOT NULL,document jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,id));
CREATE TABLE IF NOT EXISTS ai_settings(user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,document jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits(key text NOT NULL,bucket bigint NOT NULL,count integer NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '2 days',PRIMARY KEY(key,bucket));
CREATE TABLE IF NOT EXISTS jobs(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,note_id uuid NOT NULL,revision uuid NOT NULL,kind text NOT NULL DEFAULT 'analysis',status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,error text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,note_id,revision,kind));
CREATE INDEX IF NOT EXISTS pending_jobs ON jobs(status,available_at);
CREATE TABLE IF NOT EXISTS note_commands(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,note_id uuid NOT NULL,revision uuid NOT NULL,prompt text NOT NULL,note_content text NOT NULL,model text NOT NULL,status text NOT NULL DEFAULT 'pending',stage text NOT NULL DEFAULT 'Wartet',error text,result jsonb,run_token uuid,lease_until timestamptz,attempts integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(user_id,note_id) REFERENCES notes(user_id,id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS pending_commands ON note_commands(status,created_at);
ALTER TABLE note_commands ADD COLUMN IF NOT EXISTS context jsonb;
CREATE TABLE IF NOT EXISTS command_images(id uuid PRIMARY KEY,command_id uuid NOT NULL REFERENCES note_commands(id) ON DELETE CASCADE,bytes bytea NOT NULL);
CREATE TABLE IF NOT EXISTS document_context_cache(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,attachment_id text NOT NULL,fingerprint text NOT NULL,document jsonb NOT NULL,PRIMARY KEY(user_id,attachment_id));
CREATE TABLE IF NOT EXISTS youtube_transcript_cache(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,video_id text NOT NULL,document jsonb NOT NULL,expires_at timestamptz NOT NULL,PRIMARY KEY(user_id,video_id));
-- These failures can now use bounded document context. Consent/revision checks
-- still run in the worker before processing the restored job.
UPDATE jobs SET status='pending',attempts=0,error=NULL,available_at=now() WHERE kind='analysis' AND status='failed' AND error='Notiz zu lang: maximal 60.000 Zeichen für eine Analyse.';
