#!/bin/bash
# Shared by prod-apply.sh and prod-read.sh: reads the Supabase management
# API's /database/query response body on stdin and exits non-zero unless it
# parses as a JSON array, the shape of a successful query result. A SQL error
# comes back as a JSON object (an error message), sometimes on a 2xx status,
# so checking the HTTP status alone is not enough to catch it.
# Usage: printf '%s' "$response" | bash scripts/rehearsal/check-query-response.sh
set -euo pipefail
jq -e 'type=="array"' >/dev/null
