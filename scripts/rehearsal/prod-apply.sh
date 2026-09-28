#!/bin/bash
# Write-mode query against the production database, for the fact store plan
# (docs/plans/one-fact-store.md, A6). Unlike prod-read.sh this runs with
# read_only:false, so every call is a production write: run only the statements
# the plan names. Plan rule 5.1: nothing it runs may print values, only counts.
# The SQL goes through a pipe, not an argument: the rehearsal statement is too
# long for one command-line argument.
# Usage: bash scripts/rehearsal/prod-apply.sh <file.sql | "SQL">
set -euo pipefail
if [ -f "$1" ]; then cat "$1"; else printf '%s' "$1"; fi \
  | jq -Rs '{query: ., read_only: false}' \
  | curl -sS -X POST "https://api.supabase.com/v1/projects/tjeapelvjlmbxafsmjef/database/query" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
      --data-binary @-
