#!/bin/bash
# Builds a local Postgres from the LIVE production schema (no rows), for the fact
# store rehearsal (docs/plans/one-fact-store.md, Part A1 and A5).
# Reads the catalog read-only through prod-read.sh. The schema can carry secrets in
# function bodies, so it is written only to the directory given (the session
# scratchpad) and never committed (plan rule 5.1).
# Needs: postgresql-16 and postgresql-16-pgvector.
# Usage: bash scripts/rehearsal/build-local-db.sh <scratch-dir> [--template]
# The server's data and socket live in $FACT_PG_DIR (default /var/tmp/menerio-fact-pg),
# owned by the postgres user: the session scratchpad's permissions can change under
# a running server. --template renames the result to live_tpl for scripts/test-fact-store.mjs.
# Then:  psql -h /var/tmp/menerio-fact-pg -p 55432 -U postgres -d live
set -euo pipefail
S=${1:?scratch dir}; TEMPLATE=${2:-}; PGDIR=${FACT_PG_DIR:-/var/tmp/menerio-fact-pg}; HERE=$(cd "$(dirname "$0")" && pwd); PG=/usr/lib/postgresql/16/bin
mkdir -p "$S/schema" "$S/pg"
q(){ bash "$HERE/prod-read.sh" "$2" > "$S/schema/$1.json"; jq -e 'type=="array"' "$S/schema/$1.json" >/dev/null || { echo "query $1 failed"; exit 1; }; }
q enums "select t.typname, array_agg(e.enumlabel order by e.enumsortorder)::text labels from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by 1"
q seq "select sequence_name from information_schema.sequences where sequence_schema='public'"
q cols "select c.relname, a.attnum, a.attname, format_type(a.atttypid,a.atttypmod) typ, a.attnotnull, pg_get_expr(d.adbin,d.adrelid) def, a.attidentity, a.attgenerated from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where c.relnamespace='public'::regnamespace and c.relkind in ('r','p') order by 1,2"
q tables "select c.relname, c.relrowsecurity, pg_get_userbyid(c.relowner) owner from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p') order by 1"
q cons "select conrelid::regclass::text rel, conname, contype, pg_get_constraintdef(oid) def from pg_constraint where connamespace='public'::regnamespace and conrelid<>0 order by contype='f', 1, 2"
q idx "select indexrelid::regclass::text idx, pg_get_indexdef(indexrelid) def from pg_index i join pg_class c on c.oid=i.indrelid where c.relnamespace='public'::regnamespace and not exists (select 1 from pg_constraint k where k.conindid=i.indexrelid and k.contype in ('p','u','x'))"
q funcs "select p.oid::regprocedure::text sig, p.prokind, pg_get_functiondef(p.oid) def, p.proacl::text proacl from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind in ('f','p') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1"
q views "select c.relname, c.relkind, pg_get_viewdef(c.oid) def, c.reloptions from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('v','m') order by 1"
q trig "select tgrelid::regclass::text rel, tgname, tgenabled, pg_get_triggerdef(t.oid) def from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not tgisinternal order by 1,2"
q pol "select pol.polrelid::regclass::text rel, pol.polname, pg_get_expr(pol.polqual,pol.polrelid) qual, pg_get_expr(pol.polwithcheck,pol.polrelid) chk, pol.polcmd, pol.polpermissive, array(select rolname from pg_roles where oid=any(pol.polroles)) roles from pg_policy pol join pg_class c on c.oid=pol.polrelid where c.relnamespace='public'::regnamespace"
python3 "$HERE/build-local-db.py" "$S"

id postgres >/dev/null 2>&1 || useradd -m postgres
if ! su postgres -c "$PG/pg_isready -h $PGDIR -p 55432" >/dev/null 2>&1; then
  rm -rf "$PGDIR"; mkdir -p "$PGDIR"; chown postgres "$PGDIR"; chmod 700 "$PGDIR"
  su postgres -c "$PG/initdb -D $PGDIR/data -U postgres -A trust >/dev/null && $PG/pg_ctl -D $PGDIR/data -o '-p 55432 -k $PGDIR -c listen_addresses=' -l $PGDIR/log start >/dev/null"
  sleep 2
fi
P="psql -h $PGDIR -p 55432 -U postgres -X -q"
$P -c "drop database if exists live" -c "create database live" >/dev/null
fail=0
run(){ out=$($P -d live -f "$1" 2>&1 | grep -i "error" || true); [ -z "$out" ] || { echo "$(basename "$1"):"; echo "$out" | head -5; fail=1; }; }
run "$S/pg/01_tables.sql"; run "$S/pg/02_funcs.sql"
python3 - "$S" "$PGDIR" <<'PY'
import json,subprocess,sys
S=sys.argv[1]; vs=json.load(open(f"{S}/pg/03_views.json"))
for _ in range(5):
    left=[v for v in vs if "ERROR" in subprocess.run(["psql","-h",sys.argv[2],"-p","55432","-U","postgres","-X","-q","-d","live","-c","set search_path=public,extensions; "+v],capture_output=True,text=True).stderr]
    if not left: break
    vs=left
else: sys.exit(f"{len(left)} views not created")
PY
for f in 04_cons 05_idx 06_trig 07_rls; do run "$S/pg/$f.sql"; done
$P -d live -tA -c "select 'tables='||count(*) filter (where relkind='r')||' views='||count(*) filter (where relkind='v') from pg_class where relnamespace='public'::regnamespace" \
  -c "select 'functions='||count(*) from pg_proc where pronamespace='public'::regnamespace" \
  -c "select 'triggers='||count(*) from pg_trigger where not tgisinternal" -c "select 'policies='||count(*) from pg_policy"
if [ "$TEMPLATE" = "--template" ] && [ $fail = 0 ]; then
  $P -c "drop database if exists live_tpl" -c "alter database live rename to live_tpl"
fi
exit $fail
