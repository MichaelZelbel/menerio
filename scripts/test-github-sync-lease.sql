\set ON_ERROR_STOP on
DO $$BEGIN
 IF current_database()<>'github_sync_test' THEN RAISE EXCEPTION 'github_sync_test only'; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE github_connections(id uuid PRIMARY KEY,user_id uuid NOT NULL,last_sync_at timestamptz);
\ir ../supabase/migrations/20260908120003_github_sync_lease.sql
INSERT INTO github_connections VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-01-01');
SET ROLE authenticated;
DO $$BEGIN
 BEGIN PERFORM github_sync_lease('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',gen_random_uuid(),'acquire');
  RAISE EXCEPTION 'Untrusted lease allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$DECLARE c uuid='20000000-0000-0000-0000-000000000001';u uuid='10000000-0000-0000-0000-000000000001';l uuid=gen_random_uuid();BEGIN
 IF github_sync_lease(c,gen_random_uuid(),l,'acquire') THEN RAISE EXCEPTION 'Foreign user lease'; END IF;
 IF NOT github_sync_lease(c,u,l,'acquire') THEN RAISE EXCEPTION 'Cannot acquire'; END IF;
 IF github_sync_lease(c,u,gen_random_uuid(),'acquire') THEN RAISE EXCEPTION 'Overlapping lease'; END IF;
 IF github_sync_lease(c,u,gen_random_uuid(),'finish',true) THEN RAISE EXCEPTION 'Stale finish'; END IF;
 IF NOT github_sync_lease(c,u,l,'renew') THEN RAISE EXCEPTION 'Cannot renew'; END IF;
 IF NOT github_sync_lease(c,u,l,'finish',false,'github_401') THEN RAISE EXCEPTION 'Cannot record failure'; END IF;
END $$;
RESET ROLE;
DO $$BEGIN
 IF (SELECT last_sync_at FROM github_connections)<>'2026-01-01'::timestamptz THEN RAISE EXCEPTION 'Failed run advanced success'; END IF;
 IF (SELECT last_sync_attempt_at FROM github_connections) IS NULL THEN RAISE EXCEPTION 'Attempt missing'; END IF;
END $$;
SET ROLE service_role;
DO $$DECLARE c uuid='20000000-0000-0000-0000-000000000001';u uuid='10000000-0000-0000-0000-000000000001';l uuid=gen_random_uuid();BEGIN
 PERFORM github_sync_lease(c,u,l,'acquire');
 IF NOT github_sync_lease(c,u,l,'finish',true) THEN RAISE EXCEPTION 'Cannot complete'; END IF;
END $$;
RESET ROLE;
DO $$BEGIN
 IF (SELECT last_sync_at FROM github_connections)<='2026-01-01'::timestamptz THEN RAISE EXCEPTION 'Completed run missing'; END IF;
END $$;
SELECT 'GitHub leases: owner validation, role grants, overlap, stale finish, renew and timestamps passed' AS result;
