#!/bin/sh
set -euo pipefail

: "${DB_HOST:?DB_HOST is required}"
DB_PORT="${DB_PORT:-3306}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
DB_NAME="${DB_NAME:-}"
: "${S3_BUCKET:?S3_BUCKET is required}"

if [ -z "${S3_KEY:-}" ]; then
  if [ -n "$DB_NAME" ]; then
    prefix="$DB_NAME"
  else
    prefix="all"
  fi
  S3_KEY="${prefix}-$(date -u +%Y-%m-%dT%H:%M:%SZ).sql.gz"
fi

if [ -n "${S3_EXPIRES_DAYS:-}" ]; then
  if ! echo "$S3_EXPIRES_DAYS" | grep -Eq '^[0-9]+$'; then
    echo "Invalid S3_EXPIRES_DAYS: must be an integer number of days" >&2
    exit 1
  fi
  S3_EXPIRES=$(python3 - << 'EOF'
import datetime, os, sys
try:
    days = int(os.environ['S3_EXPIRES_DAYS'])
except (KeyError, ValueError):
    sys.exit("Invalid S3_EXPIRES_DAYS: must be an integer number of days")
print((datetime.datetime.utcnow() + datetime.timedelta(days=days)).strftime('%Y-%m-%dT%H:%M:%SZ'))
EOF
)
fi

EXPIRE_OPT=""
if [ -n "${S3_EXPIRES:-}" ]; then
  EXPIRE_OPT="--expires ${S3_EXPIRES}"
fi

ENDPOINT_OPT=""
if [ -n "${S3_ENDPOINT_URL:-}" ]; then
  ENDPOINT_OPT="--endpoint-url ${S3_ENDPOINT_URL}"
fi

if [ -n "$DB_NAME" ]; then
  mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" --compress --verbose  \
    | gzip > /tmp/dump.sql.gz
else
  mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" --all-databases --compress --verbose  \
    | gzip > /tmp/dump.sql.gz
fi

aws s3 cp /tmp/dump.sql.gz "s3://${S3_BUCKET}/${S3_KEY}" $ENDPOINT_OPT $EXPIRE_OPT
rm /tmp/dump.sql.gz