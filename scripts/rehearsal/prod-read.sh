#!/bin/bash
# Read-only query against the production database, for the fact store plan
# (docs/plans/one-fact-store.md, Part A1 and A6). The management API runs it with
# read_only:true, so it cannot change anything. Plan rule 5.1: structure and counts only.
# Fails on a SQL error: curl alone exits 0 on an HTTP 4xx (and the management
# API can even answer 200 with an error body), so the response is printed and
# then checked with check-query-response.sh, which requires a JSON array (the
# shape of a real result set) and exits non-zero otherwise.
# Usage: bash scripts/rehearsal/prod-read.sh "SQL"
set -euo pipefail
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
response="$(curl -sS -X POST "https://api.supabase.com/v1/projects/tjeapelvjlmbxafsmjef/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  --data "$(jq -n --arg q "$1" '{query: $q, read_only: true}')")"
printf '%s\n' "$response"
printf '%s' "$response" | "$dir/check-query-response.sh"
