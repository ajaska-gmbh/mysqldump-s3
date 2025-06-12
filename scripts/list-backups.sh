#!/bin/bash
set -euo pipefail

: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"

ENDPOINT_OPT=""
if [ -n "${S3_ENDPOINT_URL:-}" ]; then
  ENDPOINT_OPT="--endpoint-url ${S3_ENDPOINT_URL}"
fi

# List backups directly using AWS CLI
aws s3 ls "s3://${S3_BUCKET}/" --recursive $ENDPOINT_OPT