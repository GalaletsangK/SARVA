-- Track owned upload versions; historical unreferenced files cannot be safely attributed.
CREATE TABLE sarva.cgc_work_file (
 file_key text PRIMARY KEY,
 work_id bigint NOT NULL REFERENCES sarva.cgc_work(id) ON DELETE CASCADE,
 file_size bigint NOT NULL CHECK(file_size>=0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cgc_work_file_owner ON sarva.cgc_work_file(work_id);
INSERT INTO sarva.cgc_work_file(file_key,work_id,file_size)
 SELECT file_key,id,COALESCE(file_size,0) FROM sarva.cgc_work WHERE file_key IS NOT NULL
 ON CONFLICT DO NOTHING;
INSERT INTO sarva.cgc_work_file(file_key,work_id,file_size)
 SELECT published_snapshot->>'file_key',id,COALESCE((published_snapshot->>'file_size')::bigint,0)
 FROM sarva.cgc_work WHERE published_snapshot->>'file_key' IS NOT NULL
 ON CONFLICT DO NOTHING;

-- No submission payload or restorable snapshot is kept here.
CREATE TABLE sarva.cgc_deletion_audit (
 id bigserial PRIMARY KEY,
 work_id bigint NOT NULL UNIQUE,
 actor_id bigint REFERENCES sarva.app_user(id) ON DELETE SET NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 2000),
 file_count integer NOT NULL CHECK(file_count>=0),
 file_bytes bigint NOT NULL CHECK(file_bytes>=0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sarva.cgc_deletion_notice (
 id bigserial PRIMARY KEY,
 recipient_id bigint NOT NULL REFERENCES sarva.app_user(id) ON DELETE CASCADE,
 audit_id bigint NOT NULL UNIQUE REFERENCES sarva.cgc_deletion_audit(id),
 submission_title text NOT NULL
);
CREATE INDEX cgc_deletion_notice_recipient ON sarva.cgc_deletion_notice(recipient_id,id DESC);
-- Durable file removal jobs survive an API restart; completion removes the keys.
CREATE TABLE sarva.cgc_deletion_cleanup (
 id bigserial PRIMARY KEY,
 audit_id bigint NOT NULL UNIQUE REFERENCES sarva.cgc_deletion_audit(id),
 pending_keys jsonb NOT NULL CHECK(jsonb_typeof(pending_keys)='array'),
 removed_files integer NOT NULL DEFAULT 0,
 attempts integer NOT NULL DEFAULT 0,
 last_error text NOT NULL DEFAULT '',
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
