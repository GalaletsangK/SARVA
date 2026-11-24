-- Additive change; existing accounts and published work are retained.
ALTER TABLE sarva.cgc_work DROP CONSTRAINT cgc_work_status_check;
ALTER TABLE sarva.cgc_work ADD CONSTRAINT cgc_work_status_check CHECK(status IN ('draft','pending','published','changes-requested','archived'));
ALTER TABLE sarva.cgc_work ADD COLUMN published_snapshot jsonb;
CREATE TABLE sarva.cgc_member_preference(user_id bigint PRIMARY KEY REFERENCES sarva.app_user(id),centre text NOT NULL CHECK(centre IN ('spu','ufs','ufh','ul','wsu')));
COMMENT ON COLUMN sarva.cgc_work.published_snapshot IS 'Last approved public version while a replacement is drafted/reviewed; never an access grant.';
