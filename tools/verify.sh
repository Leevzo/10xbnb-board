#!/bin/sh
# Proves the public door is shut. Needs the project URL and the anon key.
set -eu
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "needs SUPABASE_URL and SUPABASE_ANON_KEY" >&2
  exit 2
fi
base=$(printf '%s' "$SUPABASE_URL" | sed 's:/*$::')
body=$(curl -sS "$base/rest/v1/properties?select=id" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY")
printf '%s' "$body" | grep -qx '\[\]'
signup=$(curl -sS -o /tmp/10xbnb-signup.json -w '%{http_code}' \
  -X POST "$base/auth/v1/signup" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"nobody@example.com","password":"correct horse battery staple"}')
if [ "$signup" = "200" ]; then
  echo "signup is open" >&2
  exit 1
fi
echo "anon empty"
echo "signup $signup"
