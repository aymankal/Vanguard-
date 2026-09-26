#!/usr/bin/env sh
set -e

# Seed demo data on first boot unless CRM_SEED_DEMO=false; seed.py is a no-op once
# contacts exist. A seeding failure must never stop the app from serving.
if [ "${CRM_SEED_DEMO:-true}" != "false" ]; then
  python seed.py || echo "seed skipped"
fi

exec python -m uvicorn crm.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="*"
