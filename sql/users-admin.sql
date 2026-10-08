CREATE TABLE IF NOT EXISTS app_users (
    id uuid PRIMARY KEY,
    google_sub varchar(255) UNIQUE NOT NULL,
    email varchar(320) NOT NULL,
    email_verified boolean NOT NULL DEFAULT false,
    google_name varchar(200) NOT NULL,
    display_name varchar(120) NOT NULL,
    picture_url text,
    role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','archived')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz,
    version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS app_users_email_idx ON app_users(lower(email));
CREATE TABLE IF NOT EXISTS app_sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    csrf_token text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS app_sessions_user_idx ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS app_sessions_expiry_idx ON app_sessions(expires_at);
CREATE TABLE IF NOT EXISTS app_login_challenges (
    token_hash text PRIMARY KEY,
    csrf_hash text NOT NULL,
    nonce_hash text NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS app_login_challenges_expiry_idx ON app_login_challenges(expires_at);
CREATE TABLE IF NOT EXISTS user_favorites (
    user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    tourism_id integer NOT NULL REFERENCES diem_du_lich(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,tourism_id)
);
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id uuid REFERENCES app_users(id),
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    changes jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx ON admin_audit_logs(created_at DESC);
ALTER TABLE admin_audit_logs ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE diem_du_lich
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES app_users(id),
    ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES app_users(id),
    ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
