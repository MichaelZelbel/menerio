\set ON_ERROR_STOP on
-- Only a fresh disposable database; never run against an application database.
DO $$ BEGIN
 IF current_database() <> 'share_review_test' THEN RAISE EXCEPTION 'share_review_test only'; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.notes(id uuid PRIMARY KEY, user_id uuid NOT NULL, title text,content text,tags text[],entity_type text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_notes ON public.notes FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.notes TO authenticated;
\ir ../supabase/migrations/20260402085123_f9e751c1-fdae-43d1-968c-1ff29b794791.sql
GRANT SELECT,INSERT,UPDATE,DELETE ON public.shared_notes TO authenticated;
INSERT INTO notes(id,user_id,title) VALUES
 ('11000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Owner A'),
 ('11000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Owner B'),
 ('11000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Foreign unshared');
INSERT INTO shared_notes(note_id,user_id,share_token) VALUES
 ('11000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','valid'),
 ('11000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','historic-invalid');
\ir ../supabase/migrations/20260908120001_shared_note_ownership.sql
DO $$BEGIN
 IF (SELECT count(*) FROM private.rejected_note_shares WHERE share_token='historic-invalid' AND NOT is_active) <> 1 THEN RAISE EXCEPTION 'Missing private audit'; END IF;
END $$;
SET ROLE anon;
DO $$BEGIN
 IF get_shared_note_by_token('historic-invalid') IS NOT NULL THEN RAISE EXCEPTION 'Foreign note exposed'; END IF;
 IF get_shared_note_by_token('valid')->>'title' <> 'Owner A' THEN RAISE EXCEPTION 'Valid share lost'; END IF;
 BEGIN PERFORM * FROM private.rejected_note_shares; RAISE EXCEPTION 'Audit exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $$BEGIN
 BEGIN
  INSERT INTO shared_notes(note_id,user_id,share_token) VALUES('11000000-0000-0000-0000-000000000003',auth.uid(),'foreign');
  RAISE EXCEPTION 'Foreign insert allowed';
 EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL; END;
 BEGIN
  UPDATE shared_notes SET note_id='11000000-0000-0000-0000-000000000003' WHERE share_token='valid';
  RAISE EXCEPTION 'Foreign retarget allowed';
 EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL; END;
 UPDATE shared_notes SET is_active=false WHERE share_token='valid';
 IF get_shared_note_by_token('valid') IS NOT NULL THEN RAISE EXCEPTION 'Unshare failed'; END IF;
 UPDATE shared_notes SET is_active=true WHERE share_token='valid';
 IF get_shared_note_by_token('valid') IS NULL THEN RAISE EXCEPTION 'Reactivate failed'; END IF;
 DELETE FROM shared_notes WHERE share_token='valid';
 INSERT INTO shared_notes(note_id,user_id,share_token) VALUES('11000000-0000-0000-0000-000000000001',auth.uid(),'replacement');
END $$;
RESET ROLE;
-- Even an RLS-bypassing writer cannot create an inconsistent share.
DO $$BEGIN
 BEGIN
  INSERT INTO shared_notes(note_id,user_id,share_token) VALUES('11000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','privileged-invalid');
  RAISE EXCEPTION 'Composite ownership constraint missing';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
SELECT 'Sharing ownership: authenticated, anonymous, historic audit, owner lifecycle and privileged constraint tests passed' AS result;
