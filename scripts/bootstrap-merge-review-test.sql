-- Disposable fixture only. Run against a fresh merge_review_test database.
DO $$BEGIN IF current_database()<>'merge_review_test' THEN RAISE EXCEPTION 'Wrong database'; END IF; END$$;
DO $$BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END$$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,name text NOT NULL,aliases text[],app_mappings jsonb,notes text,merged_into uuid REFERENCES contacts(id),merged_at timestamptz,ai_visibility text DEFAULT 'visible',is_sensitive boolean DEFAULT false);
CREATE FUNCTION ai_can_see(uuid,text,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE TABLE profile_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,contact_id uuid REFERENCES contacts(id),slug text,name text);
CREATE UNIQUE INDEX category_slug ON profile_categories(user_id,coalesce(contact_id,'00000000-0000-0000-0000-000000000000'),slug);
CREATE TABLE profile_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,contact_id uuid REFERENCES contacts(id),category_id uuid REFERENCES profile_categories(id) ON DELETE CASCADE,label text,value text,sort_order int,origin text);
CREATE FUNCTION profile_fact_label_key(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT lower(trim($1))$$;
CREATE FUNCTION profile_fact_text_key(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT lower(trim($1))$$;
CREATE UNIQUE INDEX fact_unique ON profile_entries(user_id,coalesce(contact_id,'00000000-0000-0000-0000-000000000000'),profile_fact_label_key(label),profile_fact_text_key(value));
CREATE TABLE action_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,contact_id uuid REFERENCES contacts(id),title text);
CREATE TABLE contact_interactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,contact_id uuid NOT NULL REFERENCES contacts(id),summary text);
CREATE TABLE notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,metadata jsonb,is_trashed boolean DEFAULT false);
CREATE TABLE github_sync_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,entity_id uuid,entity_type text,sync_status text);
CREATE TABLE contact_group_memberships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,contact_id uuid REFERENCES contacts(id),group_id uuid,unique(group_id,contact_id));
CREATE TABLE contact_relationships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,source_id uuid REFERENCES contacts(id),target_id uuid REFERENCES contacts(id),source_type text,target_type text,label text);

GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
ALTER TABLE contact_relationships ADD CONSTRAINT chk_source CHECK ((source_type='contact' AND source_id IS NOT NULL) OR (source_type='self' AND source_id IS NULL));
ALTER TABLE contact_relationships ADD CONSTRAINT chk_target CHECK ((target_type='contact' AND target_id IS NOT NULL) OR (target_type='self' AND target_id IS NULL));
ALTER TABLE contact_relationships ADD CONSTRAINT chk_not_self_to_self CHECK (NOT(source_type='self' AND target_type='self'));
-- Same deployed index expressions, without the historic migration's user-data insert.
CREATE UNIQUE INDEX uq_contact_relationship_asym ON contact_relationships(user_id,source_type,coalesce(source_id,'00000000-0000-0000-0000-000000000000'),target_type,coalesce(target_id,'00000000-0000-0000-0000-000000000000'),label) WHERE lower(label) NOT IN ('spouse','partner','lover','friend','sibling','co-worker','neighbor','roommate');
CREATE UNIQUE INDEX uq_contact_relationship_sym ON contact_relationships(user_id,lower(label),LEAST(source_type||':'||coalesce(source_id::text,'self'),target_type||':'||coalesce(target_id::text,'self')),GREATEST(source_type||':'||coalesce(source_id::text,'self'),target_type||':'||coalesce(target_id::text,'self'))) WHERE lower(label) IN ('spouse','partner','lover','friend','sibling','co-worker','neighbor','roommate');
ALTER TABLE profile_entries ADD COLUMN is_pinned boolean DEFAULT false, ADD COLUMN linked_note_id uuid, ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE contact_relationships ADD COLUMN custom_label text, ADD COLUMN pair_key text, ADD COLUMN origin text DEFAULT 'user_manual';
CREATE UNIQUE INDEX uq_contact_relationship_pair_key ON contact_relationships(pair_key);
CREATE TABLE relationship_rejections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,pair_key text);
