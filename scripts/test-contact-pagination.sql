\set ON_ERROR_STOP on
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','78000000-0000-0000-0000-000000000001',false);
DO $$
DECLARE n int; response jsonb; cursor_name text; cursor_id uuid; seen uuid[]; actual uuid[]; row jsonb; loops int;
BEGIN
  -- Duplicate names require the UUID tie breaker. A lower page size must not
  -- change completeness, including empty and exact-boundary data sets.
  FOREACH n IN ARRAY ARRAY[0,1,3,4,13,1001,2501] LOOP
    DELETE FROM contacts;
    INSERT INTO contacts(user_id,name,aliases)
      SELECT auth.uid(),'Duplicate',CASE WHEN i=n THEN ARRAY['Far Away'] ELSE '{}'::text[] END FROM generate_series(1,n) i;
    cursor_name:=NULL; cursor_id:=NULL; seen:='{}'; loops:=0;
    LOOP
      response:=search_contacts_page('',cursor_name,cursor_id,CASE WHEN n<20 THEN 3 ELSE 100 END);
      ASSERT (response->>'total')::int=n, 'total mismatch';
      FOR row IN SELECT * FROM jsonb_array_elements(response->'rows') LOOP
        seen:=array_append(seen,(row->>'id')::uuid);
      END LOOP;
      EXIT WHEN response->'next'='null'::jsonb;
      cursor_name:=response->'next'->>'name'; cursor_id:=(response->'next'->>'id')::uuid;
      loops:=loops+1; ASSERT loops<100, 'cursor must advance';
    END LOOP;
    SELECT coalesce(array_agg(id ORDER BY name,id),'{}') INTO actual FROM contacts;
    ASSERT seen=actual,'missing, duplicate or unordered contacts';
    IF n>0 THEN
      response:=search_contacts_page('far away');
      ASSERT (response->>'total')::int=1,'alias search must reach the full dataset';
    END IF;
  END LOOP;
  response:=search_contacts_page('%'); ASSERT (response->>'total')::int=0,'search treats wildcard characters literally';
  -- Even a one-row outer limit contains a whole scalar JSON page.
  SELECT search_contacts_page('',NULL,NULL,50) INTO response LIMIT 1;
  ASSERT jsonb_array_length(response->'rows')=50,'transport row cap cannot truncate JSON page';
  DELETE FROM contacts;
  INSERT INTO contacts(user_id,name) VALUES(auth.uid(),'A'),(auth.uid(),'B'),(auth.uid(),'C'),(auth.uid(),'D');
  response:=search_contacts_page('',NULL,NULL,2);
  cursor_name:=response->'next'->>'name'; cursor_id:=(response->'next'->>'id')::uuid;
  -- Edits between requests cannot shift offsets and silently skip C or D.
  DELETE FROM contacts WHERE name='A';
  INSERT INTO contacts(user_id,name) VALUES(auth.uid(),'AA');
  response:=search_contacts_page('',cursor_name,cursor_id,2);
  ASSERT response->'rows'->0->>'name'='C' AND response->'rows'->1->>'name'='D','edit before cursor skipped an existing row';
  UPDATE contacts SET name='Aardvark' WHERE name='D';
  response:=search_contacts_page('',NULL,NULL,50);
  ASSERT (response->>'total')::int=4 AND jsonb_array_length(response->'rows')=4,'refresh includes rename across cursor';
END $$;
RESET ROLE;
INSERT INTO contacts(user_id,name) VALUES('78000000-0000-0000-0000-000000000002','Foreign');
SET ROLE authenticated;
DO $$ BEGIN ASSERT (search_contacts_page('Foreign')->>'total')::int=0,'cross-owner leak'; END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  PERFORM search_contacts_page('');
  RAISE EXCEPTION 'anonymous access allowed';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
SELECT 'contact pagination assertions passed' AS result;
