#!/bin/bash
set -euo pipefail

# If RESTORE is set to true, open a shell for manual restore operations
if [ "${RESTORE:-false}" = "true" ]; then
  echo "Opening a shell for restore operations..."
  exec /bin/bash
fi

# Default: run a backup via the CLI (configured through environment variables)
if [ "$#" -eq 0 ]; then
  exec mysqldump-s3 backup
fi

# Shorthand: allow passing just a CLI subcommand, e.g. `backup --verbose` or `list`
case "$1" in
  backup|list|restore)
    exec mysqldump-s3 "$@"
    ;;
esac

# Anything else runs as-is, e.g. `mysqldump-s3 --help`, `npx jest`, `bash`
exec "$@"
