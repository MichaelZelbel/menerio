#!/usr/bin/env python3
# Turns the catalog JSON written by build-local-db.sh into DDL files. See that script.
import json,sys,os
S=sys.argv[1]; J=lambda n: json.load(open(f"{S}/schema/{n}.json"))
out=[]
out.append(r"""
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role supabase_admin superuser; create role authenticator noinherit login;
grant anon, authenticated, service_role to authenticator;
create schema extensions; create schema auth; create schema vault; create schema internal; create schema net; create schema cron;
create extension vector schema extensions; create extension pg_trgm schema extensions; create extension pgcrypto schema extensions; create extension "uuid-ossp" schema extensions;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
grant usage on schema auth, extensions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create function internal.call_edge(text,jsonb) returns void language sql as $$ select $$;
create function internal.cron_secret() returns text language sql as $$ select 'stub'::text $$;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 0::bigint $$;
create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text, active boolean default true);
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
set search_path = public, extensions;
set check_function_bodies = off;
""")
for e in J("enums"):
    labels=e["labels"].strip("{}").split(",")
    out.append(f"create type public.{e['typname']} as enum ({','.join(repr(l) for l in labels)});")
for s in J("seq"): out.append(f"create sequence public.{s['sequence_name']};")
cols={}
for c in J("cols"): cols.setdefault(c["relname"],[]).append(c)
for t,cs in cols.items():
    parts=[]
    for c in cs:
        p=f'"{c["attname"]}" {c["typ"]}'
        if c["attgenerated"]=="s": p+=f' generated always as ({c["def"]}) stored'
        elif c["attidentity"]: p+=" generated "+("always" if c["attidentity"]=="a" else "by default")+" as identity"
        elif c["def"] is not None: p+=f' default {c["def"]}'
        if c["attnotnull"]: p+=" not null"
        parts.append(p)
    out.append(f'create table public."{t}" (\n  '+",\n  ".join(parts)+"\n);")
open(f"{S}/pg/01_tables.sql","w").write("\n".join(out))
# functions
fo=["set search_path = public, extensions;","set check_function_bodies = off;"]
for f in J("funcs"):
    fo.append(f["def"].rstrip()+";")
    if f.get("proacl"):
        fo.append(f"revoke all on function {f['sig']} from public, anon, authenticated, service_role;")
        for a in f["proacl"].strip("{}").split(","):
            role=a.split("=")[0] or "public"
            if "X" in a.split("=")[1].split("/")[0] and role!="postgres": fo.append(f"grant execute on function {f['sig']} to {role};")
open(f"{S}/pg/02_funcs.sql","w").write("\n".join(fo))
# constraints: non-FK then FK
co=[]
for c in sorted(J("cons"), key=lambda c: c["contype"]=="f"):
    co.append(f'alter table {c["rel"]} add constraint "{c["conname"]}" {c["def"]};')
open(f"{S}/pg/04_cons.sql","w").write("\n".join(["set search_path = public, extensions;"]+co))
open(f"{S}/pg/05_idx.sql","w").write("\n".join(["set search_path = public, extensions;"]+[i["def"]+";" for i in J("idx")]))
vo=[]
for v in J("views"):
    opts=f" with ({','.join(v['reloptions'])})" if v["reloptions"] else ""
    kind="materialized view" if v["relkind"]=="m" else "view"
    vo.append(f'create {kind} public."{v["relname"]}"{opts} as {v["def"]}')
json.dump(vo,open(f"{S}/pg/03_views.json","w"))
to=["set search_path = public, extensions;"]
for t in J("trig"):
    to.append(t["def"]+";")
    if t["tgenabled"]=="D": to.append(f'alter table {t["rel"]} disable trigger "{t["tgname"]}";')
open(f"{S}/pg/06_trig.sql","w").write("\n".join(to))
po=["set search_path = public, extensions;"]
for t in J("tables"):
    if t["relrowsecurity"]: po.append(f'alter table public."{t["relname"]}" enable row level security;')
cmd={"r":"select","a":"insert","w":"update","d":"delete","*":"all"}
for p in J("pol"):
    roles=",".join(p["roles"].strip("{}").split(",")) if isinstance(p["roles"],str) else ",".join(p["roles"])
    s=f'create policy "{p["polname"]}" on {p["rel"]} as {"permissive" if p["polpermissive"] else "restrictive"} for {cmd[p["polcmd"]]} to {roles or "public"}'
    if p["qual"]: s+=f' using ({p["qual"]})'
    if p["chk"]: s+=f' with check ({p["chk"]})'
    po.append(s+";")
open(f"{S}/pg/07_rls.sql","w").write("\n".join(po))
