#!/bin/sh
set -euo pipefail

: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_KEY:?S3_KEY is required}"
: "${DB_HOST:?DB_HOST is required}"
DB_PORT="${DB_PORT:-3306}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${DB_NAME:?DB_NAME is required}"

docker run --rm -i \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
  -e S3_BUCKET -e S3_KEY \
  -e DB_HOST -e DB_PORT -e DB_USER -e DB_PASSWORD -e DB_NAME \
  --entrypoint sh docker-mysqldump-s3 -c 'aws s3 cp "s3://$S3_BUCKET/$S3_KEY" - | gunzip -c | mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME"'