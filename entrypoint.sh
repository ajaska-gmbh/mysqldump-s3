#!/bin/bash
set -euo pipefail

# Check if the first argument is mysqldump-s3 (new CLI)
if [ "$#" -gt 0 ] && [ "$1" = "mysqldump-s3" ]; then
  # Execute the new CLI directly, passing all arguments
  exec "$@"
fi

# Check if we're running Jest tests (npx jest)
if [ "$#" -gt 0 ] && { [ "$1" = "npx" ] || [ "$1" = "npm" ] || [ "$1" = "node" ]; }; then
  # Execute the command directly without validation
  exec "$@"
fi

# If RESTORE is set to true, open a shell
if [ "${RESTORE:-false}" = "true" ]; then
  echo "Opening a shell for restore operations..."
  exec /bin/bash
fi

# Skip entrypoint validation for tests
if [ "${SKIP_ENTRYPOINT:-false}" = "true" ]; then
  exec "$@"
fi

: "${DB_HOST:?DB_HOST is required}"
DB_PORT="${DB_PORT:-3306}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
DB_NAME="${DB_NAME:-}"
: "${S3_BUCKET:?S3_BUCKET is required}"

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ -z "${S3_KEY:-}" ]; then
  if [ -n "$DB_NAME" ]; then
    prefix="$DB_NAME"
  else
    prefix="all"
  fi
  S3_KEY="${prefix}-${TIMESTAMP}.sql.gz"
else
  # Append timestamp to the provided S3_KEY
  S3_KEY="${S3_KEY}-${TIMESTAMP}.sql.gz"
fi

ENDPOINT_OPT=""
if [ -n "${S3_ENDPOINT_URL:-}" ]; then
  ENDPOINT_OPT="--endpoint-url ${S3_ENDPOINT_URL}"
fi

if [ -n "$DB_NAME" ]; then
  mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" --compress --verbose --lock-tables=false  \
    | gzip > /tmp/dump.sql.gz
else
  mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" --all-databases --compress --verbose --lock-tables=false  \
    | gzip > /tmp/dump.sql.gz
fi

aws s3 cp /tmp/dump.sql.gz "s3://${S3_BUCKET}/${S3_KEY}" $ENDPOINT_OPT
rm /tmp/dump.sql.gz
