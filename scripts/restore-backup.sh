#!/bin/bash
set -euo pipefail

# Required environment variables
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${DB_HOST:?DB_HOST is required}"
: "${DB_USER:?DB_USER is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"

# Optional environment variables with defaults
DB_PORT="${DB_PORT:-3306}"
ENDPOINT_OPT=""
if [ -n "${S3_ENDPOINT_URL:-}" ]; then
  ENDPOINT_OPT="--endpoint-url ${S3_ENDPOINT_URL}"
fi

echo "=== MySQL Backup Restore Tool ==="
echo "This script will help you restore a MySQL backup from S3."
echo

# List available backups
echo "Fetching list of available backups..."
BACKUPS=$(docker run --rm \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
  -e S3_BUCKET \
  --entrypoint aws docker-mysqldump-s3 \
  s3 ls "s3://${S3_BUCKET}/" --recursive $ENDPOINT_OPT | awk '{print $4}')

if [ -z "$BACKUPS" ]; then
  echo "No backups found in s3://${S3_BUCKET}/"
  exit 1
fi

# Convert to array
mapfile -t BACKUP_ARRAY <<< "$BACKUPS"
BACKUP_COUNT=${#BACKUP_ARRAY[@]}

echo "Found $BACKUP_COUNT backups:"
echo

# Display backups with numbers
for i in "${!BACKUP_ARRAY[@]}"; do
  echo "$((i+1)). ${BACKUP_ARRAY[$i]}"
done

echo
echo "Enter the number of the backup you want to restore (1-$BACKUP_COUNT):"
read -r SELECTION

# Validate selection
if ! [[ "$SELECTION" =~ ^[0-9]+$ ]] || [ "$SELECTION" -lt 1 ] || [ "$SELECTION" -gt "$BACKUP_COUNT" ]; then
  echo "Invalid selection. Please enter a number between 1 and $BACKUP_COUNT."
  exit 1
fi

# Get selected backup
SELECTED_BACKUP="${BACKUP_ARRAY[$((SELECTION-1))]}"
echo
echo "You selected: $SELECTED_BACKUP"
echo

# Query available databases and let user select one
if [ -z "${DB_NAME:-}" ]; then
  echo "Fetching available databases from MySQL server..."

  # Create a temporary container to query databases
  DB_CONTAINER_ID=$(docker run -d \
    -e DB_HOST -e DB_PORT -e DB_USER -e DB_PASSWORD \
    --entrypoint /bin/bash \
    docker-mysqldump-s3 \
    -c "sleep 3600")

  # Get list of databases
  DATABASES=$(docker exec $DB_CONTAINER_ID bash -c "mysql -h \"$DB_HOST\" -P \"$DB_PORT\" -u \"$DB_USER\" -p\"$DB_PASSWORD\" -e 'SHOW DATABASES;' | grep -v 'Database' | grep -v 'information_schema' | grep -v 'performance_schema' | grep -v 'mysql' | grep -v 'sys'")

  # Clean up temporary container
  docker rm -f $DB_CONTAINER_ID > /dev/null

  if [ -z "$DATABASES" ]; then
    echo "No user databases found on the server."
    echo "Enter the database name to restore to:"
    read -r DB_NAME

    if [ -z "$DB_NAME" ]; then
      echo "Database name cannot be empty."
      exit 1
    fi
  else
    # Convert to array
    mapfile -t DB_ARRAY <<< "$DATABASES"
    DB_COUNT=${#DB_ARRAY[@]}

    echo "Found $DB_COUNT databases:"
    echo

    # Display databases with numbers
    for i in "${!DB_ARRAY[@]}"; do
      echo "$((i+1)). ${DB_ARRAY[$i]}"
    done

    echo
    echo "Enter the number of the database you want to restore to (1-$DB_COUNT), or 0 to enter a different name:"
    read -r DB_SELECTION

    # Validate selection
    if ! [[ "$DB_SELECTION" =~ ^[0-9]+$ ]] || [ "$DB_SELECTION" -lt 0 ] || [ "$DB_SELECTION" -gt "$DB_COUNT" ]; then
      echo "Invalid selection. Please enter a number between 0 and $DB_COUNT."
      exit 1
    fi

    if [ "$DB_SELECTION" -eq 0 ]; then
      echo "Enter the database name to restore to:"
      read -r DB_NAME

      if [ -z "$DB_NAME" ]; then
        echo "Database name cannot be empty."
        exit 1
      fi
    else
      # Get selected database
      DB_NAME="${DB_ARRAY[$((DB_SELECTION-1))]}"
    fi
  fi
fi

# Confirm restoration
echo "WARNING: This will overwrite data in the '$DB_NAME' database on $DB_HOST."
echo "Are you sure you want to proceed? (y/n)"
read -r CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Restoration cancelled."
  exit 0
fi

echo
echo "Starting restoration process..."

echo "1. Downloading backup from S3..."
CONTAINER_ID=$(docker run -d \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
  -e S3_BUCKET -e S3_ENDPOINT_URL \
  -e DB_HOST -e DB_PORT -e DB_USER -e DB_PASSWORD -e DB_NAME \
  --entrypoint /bin/bash \
  docker-mysqldump-s3 \
  -c "sleep 3600")

# Download the backup
docker exec $CONTAINER_ID aws s3 cp "s3://${S3_BUCKET}/${SELECTED_BACKUP}" /tmp/backup.sql.gz $ENDPOINT_OPT

echo "2. Restoring backup to database..."
# Restore the backup
docker exec $CONTAINER_ID bash -c "gunzip -c /tmp/backup.sql.gz | mysql -h \"$DB_HOST\" -P \"$DB_PORT\" -u \"$DB_USER\" -p\"$DB_PASSWORD\" \"$DB_NAME\""

# Clean up
echo "3. Cleaning up..."
docker rm -f $CONTAINER_ID > /dev/null

echo
echo "Restoration completed successfully!"
echo "The backup '$SELECTED_BACKUP' has been restored to the '$DB_NAME' database on $DB_HOST."
