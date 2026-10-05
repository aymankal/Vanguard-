#!/usr/bin/env sh
set -e
exec python -m uvicorn vanguard.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="*"
