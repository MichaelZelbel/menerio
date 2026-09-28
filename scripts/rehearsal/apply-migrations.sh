#!/bin/bash
# Applies every file in supabase/migrations, in order, to the local rehearsal database.
# Stops at the first failure and prints its name. Usage: apply-migrations.sh [from-file]
set -u
P="psql -h ${PGHOST:-/var/run/postgresql} -p ${PGPORT:-54329} -U postgres -v ON_ERROR_STOP=1 -q -X"
started=${1:-}
for f in supabase/migrations/*.sql; do
  if [ -n "$started" ] && [[ "$(basename "$f")" < "$started" ]]; then continue; fi
  if ! out=$($P --single-transaction -f "$f" 2>&1); then
    echo "FAILED: $(basename "$f")"; echo "$out" | grep -v '^psql.*NOTICE' | tail -5; exit 1
  fi
done
echo "all migrations applied"
