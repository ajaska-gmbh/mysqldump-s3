# Integration Tests

This directory contains integration tests and test fixtures for the mysqldump-s3 project.

## Structure

- `fixtures/test-data.sql` - SQL script that creates sample data for testing
- `verify-restore.js` - Script to verify that data was restored correctly after a backup/restore cycle

## Running Integration Tests

### GitHub Actions

The integration tests are automatically run in GitHub Actions on every push and pull request. The workflow:

1. Sets up MySQL 8.0 and MinIO (S3-compatible storage) services
2. Loads test data into the database
3. Runs backup, list, and restore commands
4. Verifies data integrity after restore

### Local Testing

To run integration tests locally, you need:

1. **MySQL Database** (running on localhost:3306 or configured via environment variables)
2. **S3-compatible storage** (AWS S3 or MinIO)
3. **Required environment variables**:
   ```bash
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=testuser
   DB_PASSWORD=testpass
   DB_NAME=testdb
   AWS_ACCESS_KEY_ID=your_access_key
   AWS_SECRET_ACCESS_KEY=your_secret_key
   AWS_DEFAULT_REGION=us-east-1
   S3_BUCKET=test-backup-bucket
   S3_ENDPOINT_URL=http://127.0.0.1:9000  # for MinIO
   ```

#### Quick Setup with Docker

```bash
# Start MySQL
docker run -d --name test-mysql \
  -e MYSQL_ROOT_PASSWORD=rootpassword \
  -e MYSQL_DATABASE=testdb \
  -e MYSQL_USER=testuser \
  -e MYSQL_PASSWORD=testpass \
  -p 3306:3306 \
  mysql:8.0

# Start MinIO
docker run -d --name test-minio \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -p 9000:9000 \
  -p 9001:9001 \
  minio/minio server /data --console-address ":9001"

# Wait for services to be ready
sleep 30

# Load test data
mysql -h 127.0.0.1 -u testuser -ptestpass testdb < tests/fixtures/test-data.sql

# Create MinIO bucket
docker exec test-minio mc config host add minio http://localhost:9000 minioadmin minioadmin
docker exec test-minio mc mb minio/test-backup-bucket
```

#### Running Tests

```bash
# Build the project
npm run build

# Set environment variables
export DB_HOST=127.0.0.1
export DB_USER=testuser
export DB_PASSWORD=testpass
export DB_NAME=testdb
export AWS_ACCESS_KEY_ID=minioadmin
export AWS_SECRET_ACCESS_KEY=minioadmin
export S3_BUCKET=test-backup-bucket
export S3_ENDPOINT_URL=http://127.0.0.1:9000
export CI=true
export NODE_ENV=test

# Run integration tests
npm test -- integration.test.ts

# Or run manual test cycle
node dist/cli.js backup -v
node dist/cli.js list -f json
BACKUP_KEY=$(node dist/cli.js list -f json | jq -r '.[0].key')
node dist/cli.js restore --backup "$BACKUP_KEY" --database testdb --non-interactive --force -v
node tests/verify-restore.js
```

## Test Data

The test data includes:

- **Users**: 7 users with various data types including Unicode characters
- **Products**: 11 products with different categories and descriptions
- **Orders**: 5 orders with different statuses
- **Order Items**: 10 order items linking orders to products
- **Activity Logs**: 6 log entries with JSON data
- **Database Objects**: Views, stored procedures, and triggers

### Special Test Cases

- Unicode and special characters preservation
- JSON data integrity
- Foreign key relationships
- Database views and stored procedures
- Triggers
- Large text fields
- Various MySQL data types

## Verification Script

The `verify-restore.js` script performs comprehensive checks:

1. **Table Existence**: Verifies all expected tables are present
2. **Row Counts**: Ensures correct number of records in each table
3. **Data Integrity**: Checks specific data values and formats
4. **Unicode Preservation**: Verifies Unicode characters are intact
5. **JSON Data**: Ensures JSON fields are properly restored
6. **Relationships**: Checks foreign key constraints work
7. **Database Objects**: Verifies views, procedures, and triggers exist

## Troubleshooting

### Common Issues

1. **MySQL Connection Failed**: Check that MySQL is running and credentials are correct
2. **S3 Upload Failed**: Verify S3 credentials and bucket exists
3. **Permission Denied**: Ensure the database user has necessary privileges
4. **Backup Not Found**: Check S3 bucket contents and backup key format

### Debugging

Add `-v` flag to CLI commands for verbose output:

```bash
node dist/cli.js backup -v
node dist/cli.js restore --backup "key" --database testdb --non-interactive --force -v
```

### Logs

Check GitHub Actions logs for detailed error messages and execution traces.