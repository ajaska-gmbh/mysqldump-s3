#!/bin/bash

# Integration test runner script
# This script sets up the environment and runs integration tests locally

set -e

echo "🚀 Starting integration test setup..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if required commands are available
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}❌ $1 is required but not installed${NC}"
        exit 1
    fi
}

echo "📋 Checking prerequisites..."
check_command docker
check_command mysql
check_command node
check_command npm

# Check if project is built
if [ ! -f "../dist/cli.js" ]; then
    echo -e "${YELLOW}⚠️  Project not built, building now...${NC}"
    cd ..
    npm run build
    cd tests
fi

# Start services
echo "🐳 Starting Docker services..."

# Start MySQL
docker run -d --name test-mysql-integration \
  -e MYSQL_ROOT_PASSWORD=rootpassword \
  -e MYSQL_DATABASE=testdb \
  -e MYSQL_USER=testuser \
  -e MYSQL_PASSWORD=testpass \
  -p 3306:3306 \
  --health-cmd="mysqladmin ping -h localhost" \
  --health-interval=10s \
  --health-timeout=5s \
  --health-retries=5 \
  mysql:8.0 2>/dev/null || echo "MySQL container already running"

# Start MinIO
docker run -d --name test-minio-integration \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -p 9000:9000 \
  -p 9001:9001 \
  --health-cmd="curl -f http://localhost:9000/minio/health/live" \
  --health-interval=10s \
  --health-timeout=5s \
  --health-retries=5 \
  minio/minio server /data --console-address ":9001" 2>/dev/null || echo "MinIO container already running"

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."

# Wait for MySQL
echo "   Waiting for MySQL..."
until mysql -h 127.0.0.1 -u root -prootpassword -e "SELECT 1" &> /dev/null; do
    sleep 2
done
echo -e "${GREEN}   ✓ MySQL is ready${NC}"

# Wait for MinIO
echo "   Waiting for MinIO..."
until curl -s http://127.0.0.1:9000/minio/health/live &> /dev/null; do
    sleep 2
done
echo -e "${GREEN}   ✓ MinIO is ready${NC}"

# Setup test data
echo "📊 Loading test data..."
mysql -h 127.0.0.1 -u testuser -ptestpass testdb < fixtures/test-data.sql
echo -e "${GREEN}   ✓ Test data loaded${NC}"

# Setup MinIO bucket
echo "🪣 Setting up MinIO bucket..."
if command -v mc &> /dev/null; then
    mc config host add testminio http://127.0.0.1:9000 minioadmin minioadmin &> /dev/null || true
    mc mb testminio/test-backup-bucket &> /dev/null || true
    echo -e "${GREEN}   ✓ MinIO bucket created${NC}"
else
    # Download and use MinIO client
    wget -q https://dl.min.io/client/mc/release/linux-amd64/mc -O /tmp/mc
    chmod +x /tmp/mc
    /tmp/mc config host add testminio http://127.0.0.1:9000 minioadmin minioadmin &> /dev/null || true
    /tmp/mc mb testminio/test-backup-bucket &> /dev/null || true
    echo -e "${GREEN}   ✓ MinIO bucket created${NC}"
fi

# Set environment variables
export DB_HOST=127.0.0.1
export DB_PORT=3306
export DB_USER=testuser
export DB_PASSWORD=testpass
export DB_NAME=testdb
export AWS_ACCESS_KEY_ID=minioadmin
export AWS_SECRET_ACCESS_KEY=minioadmin
export AWS_DEFAULT_REGION=us-east-1
export S3_BUCKET=test-backup-bucket
export S3_ENDPOINT_URL=http://127.0.0.1:9000
export CI=true
export NODE_ENV=test

echo "🧪 Running integration tests..."

# Option 1: Run Jest integration tests
if [ "$1" = "jest" ]; then
    echo "Running Jest integration tests..."
    cd ..
    npm test -- integration.test.ts
    TEST_RESULT=$?
    cd tests
else
    # Option 2: Run manual test cycle
    echo "Running manual test cycle..."
    
    echo "1. Creating backup..."
    node ../dist/cli.js backup -v
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Backup failed${NC}"
        exit 1
    fi
    
    echo "2. Listing backups..."
    node ../dist/cli.js list -f json > backups.json
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ List failed${NC}"
        exit 1
    fi
    
    # Get latest backup key
    BACKUP_KEY=$(node -e "
        const backups = require('./backups.json');
        if (backups.length === 0) {
            console.error('No backups found!');
            process.exit(1);
        }
        console.log(backups[0].key);
    ")
    
    echo "3. Clearing database..."
    mysql -h 127.0.0.1 -u root -prootpassword testdb -e "
        SET FOREIGN_KEY_CHECKS = 0;
        SET @tables = NULL;
        SELECT GROUP_CONCAT(table_name) INTO @tables
          FROM information_schema.tables
          WHERE table_schema = 'testdb';
        SET @tables = CONCAT('DROP TABLE IF EXISTS ', @tables);
        PREPARE stmt FROM @tables;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SET FOREIGN_KEY_CHECKS = 1;
    "
    
    echo "4. Restoring backup: $BACKUP_KEY"
    node ../dist/cli.js restore --backup "$BACKUP_KEY" --database testdb --non-interactive --force -v
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Restore failed${NC}"
        exit 1
    fi
    
    echo "5. Verifying restored data..."
    node verify-restore.js
    TEST_RESULT=$?
fi

# Cleanup
cleanup() {
    echo "🧹 Cleaning up..."
    docker stop test-mysql-integration test-minio-integration &> /dev/null || true
    docker rm test-mysql-integration test-minio-integration &> /dev/null || true
    rm -f backups.json /tmp/mc &> /dev/null || true
}

# Set trap to cleanup on exit
trap cleanup EXIT

if [ $TEST_RESULT -eq 0 ]; then
    echo -e "${GREEN}🎉 All integration tests passed!${NC}"
else
    echo -e "${RED}❌ Integration tests failed${NC}"
    exit 1
fi