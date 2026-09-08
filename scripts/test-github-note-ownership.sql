\set ON_ERROR_STOP on
DO $$BEGIN
 IF current_database()<>'github_note_owner_test' THEN RAISE EXCEPTION 'github_note_owner_test only'; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE notes(id uuid PRIMARY KEY,user_id uuid NOT NULL,UNIQUE(id,user_id));
CREATE TABLE github_sync_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,note_id uuid REFERENCES notes(id));
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_notes ON notes FOR SELECT TO authenticated USING(user_id=auth.uid());
ALTER TABLE github_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own sync log" ON github_sync_log FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT SELECT ON notes TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON github_sync_log TO authenticated;
INSERT INTO notes VALUES('11000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),('11000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO github_sync_log(user_id,note_id) VALUES('10000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000002');
\ir ../supabase/migrations/20260908120005_github_note_ownership.sql
DO $$BEGIN
 IF (SELECT count(*) FROM github_sync_log)<>0 OR (SELECT count(*) FROM private.rejected_github_note_links)<>1 THEN RAISE EXCEPTION 'Historic mismatch not quarantined'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$BEGIN
 BEGIN INSERT INTO github_sync_log(user_id,note_id) VALUES(auth.uid(),'11000000-0000-0000-0000-000000000002');
  RAISE EXCEPTION 'Foreign reference allowed';
 EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL; END;
 INSERT INTO github_sync_log(user_id,note_id) VALUES(auth.uid(),'11000000-0000-0000-0000-000000000001');
 BEGIN UPDATE github_sync_log SET note_id='11000000-0000-0000-0000-000000000002';
  RAISE EXCEPTION 'Foreign retarget allowed';
 EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'GitHub note owner insertion, retargeting and historic quarantine passed' AS result;
