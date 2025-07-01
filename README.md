# mysqldump-s3

Node.js CLI tool to dump MySQL databases and upload to Amazon S3, with backup listing and restore functionality.

This tool has been completely rewritten from the original Docker-based solution to provide a more flexible and feature-rich experience with:

- 🚀 **TypeScript CLI application** with comprehensive error handling
- 📊 **Real-time progress bars** for backup, upload, download, and restore operations
- 🔄 **Interactive restore mode** with backup and database selection
- ⚙️ **Flexible configuration** via environment variables, CLI arguments, or config files
- 📝 **Detailed logging** with different verbosity levels
- 🏗️ **Modular architecture** for easy maintenance and testing

## Installation

```bash
npm install -g mysqldump-s3
```

Or run directly with npx:

```bash
npx mysqldump-s3 --help
```

## Usage

The tool provides three main commands:

### Backup Command

Create a database backup and upload it to S3:

```bash
# Using environment variables
mysqldump-s3 backup

# Using a configuration file
mysqldump-s3 backup --config config.yml

# With verbose output
mysqldump-s3 backup --verbose
```

### List Command

List all available backups in your S3 bucket:

```bash
# Table format (default)
mysqldump-s3 list

# JSON format
mysqldump-s3 list --format json

# With verbose output showing total size
mysqldump-s3 list --verbose
```

### Restore Command

Restore a backup from S3 to your MySQL database:

```bash
# Interactive mode (default) - prompts for backup and database selection
mysqldump-s3 restore

# Non-interactive mode - specify backup and database
mysqldump-s3 restore --backup "mydb-2023-12-01T10-30-00-000Z.sql.gz" --database "mydb_restored" --non-interactive --force

# Using a configuration file
mysqldump-s3 restore --config config.yml
```

## Configuration

The tool supports configuration through multiple methods (in order of precedence):

1. **Command-line arguments**
2. **Environment variables**
3. **Configuration file** (JSON or YAML)

### Environment Variables

| Variable              | Required | Default                          | Description                                            |
|-----------------------|:--------:|----------------------------------|--------------------------------------------------------|
| DB_HOST               | Yes      |                                  | MySQL host                                             |
| DB_PORT               | No       | 3306                             | MySQL port                                             |
| DB_USER               | Yes      |                                  | MySQL user                                             |
| DB_PASSWORD           | Yes      |                                  | MySQL password                                         |
| DB_NAME               | No       |                                  | MySQL database name (optional; dumps all databases if not set) |
| AWS_ACCESS_KEY_ID     | Yes      |                                  | AWS access key ID                                      |
| AWS_SECRET_ACCESS_KEY | Yes      |                                  | AWS secret access key                                  |
| AWS_DEFAULT_REGION    | No       | us-east-1                        | AWS region                                             |
| S3_BUCKET             | Yes      |                                  | S3 bucket name                                         |
| S3_KEY                | No       | \<db_name or all\>-\<timestamp\>.sql.gz | S3 object key prefix                                   |
| S3_ENDPOINT_URL       | No       |                                  | Custom S3 endpoint URL (e.g. https://s3.de.io.cloud.ovh.net) |

### Configuration File Examples

**YAML format (`config.yml`):**

```yaml
database:
  host: "localhost"
  port: 3306
  user: "root"
  password: "your-password"
  # database: "specific-database"  # Optional

s3:
  accessKeyId: "your-aws-access-key-id"
  secretAccessKey: "your-aws-secret-access-key"
  region: "us-east-1"
  bucket: "your-s3-bucket"
  # key: "custom-prefix"  # Optional
  # endpointUrl: "https://s3.de.io.cloud.ovh.net"  # Optional

# verbose: true  # Optional
```

**JSON format (`config.json`):**

```json
{
  "database": {
    "host": "localhost",
    "port": 3306,
    "user": "root",
    "password": "your-password"
  },
  "s3": {
    "accessKeyId": "your-aws-access-key-id",
    "secretAccessKey": "your-aws-secret-access-key",
    "region": "us-east-1",
    "bucket": "your-s3-bucket"
  }
}
```

## Features

### Backup Process

1. ✅ **Connection Testing** - Validates database connectivity before starting
2. 📊 **Progress Tracking** - Real-time progress bar during mysqldump
3. 🗜️ **Automatic Compression** - Gzip compression for smaller file sizes
4. ⬆️ **S3 Upload** - Streaming upload with progress indication
5. 🧹 **Cleanup** - Automatic cleanup of temporary files
6. 📋 **Detailed Summary** - Shows backup size, location, and timing

### List Process

1. 🔍 **S3 Discovery** - Lists all `.sql.gz` files in your bucket
2. 📊 **Formatted Display** - Clean table or JSON output
3. 📅 **Smart Sorting** - Sorted by date (newest first)
4. 📏 **Size Information** - Human-readable file sizes
5. 📝 **Backup Details** - Extracts database name and timestamp from filenames

### Restore Process

1. 🎯 **Interactive Selection** - Choose from available backups and databases
2. 📋 **Database Discovery** - Lists available databases on your MySQL server
3. ⚠️ **Safety Confirmations** - Warns before overwriting existing data
4. ⬇️ **Progress Download** - Shows download progress from S3
5. 🔄 **Streaming Restore** - Direct decompression and restoration
6. 📊 **Progress Tracking** - Real-time progress during restore

## Examples

### Basic Backup

```bash
# Set environment variables
export DB_HOST="localhost"
export DB_USER="root"
export DB_PASSWORD="mypassword"
export DB_NAME="myapp"
export AWS_ACCESS_KEY_ID="AKIAIOSFODNN7EXAMPLE"
export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
export S3_BUCKET="my-backups"

# Create backup
mysqldump-s3 backup --verbose
```

### Custom S3 Endpoint (e.g., OVH Cloud)

```bash
export S3_ENDPOINT_URL="https://s3.de.io.cloud.ovh.net"
mysqldump-s3 backup
```

### List Backups

```bash
mysqldump-s3 list
```

Output:
```
✓ Found 3 backups

Available Backups:

Name                           | Size    | Last Modified
myapp (2023-12-01 10:30:00)   | 15.2 MB | 12/1/2023, 10:30:00 AM
myapp (2023-11-30 10:30:00)   | 14.8 MB | 11/30/2023, 10:30:00 AM
myapp (2023-11-29 10:30:00)   | 14.5 MB | 11/29/2023, 10:30:00 AM

Total: 3 backups
```

### Interactive Restore

```bash
mysqldump-s3 restore
```

The tool will guide you through:
1. Selecting which backup to restore
2. Choosing the target database
3. Confirming the restoration

## Development

### Prerequisites

- Node.js 14+ 
- MySQL client (`mysqldump` and `mysql` commands)
- TypeScript

### Building

```bash
npm install
npm run build
```

### Testing

```bash
# Unit tests
npm test
npm run test:coverage

# Integration tests (requires Docker)
cd tests
./run-integration-tests.sh

# Or run Jest integration tests in CI environment
npm test -- integration.test.ts
```

### Linting

```bash
npm run lint
npm run lint:fix
```
## Error Handling

The tool provides comprehensive error handling with:

- ❌ **Configuration validation** with helpful error messages
- 🔗 **Connection testing** before operations
- 📊 **Progress indication** with error recovery
- 🧹 **Automatic cleanup** on failures
- 📝 **Detailed logging** with `--verbose` flag
- 
## Docker Usage

### Modern CLI (Recommended)
```bash
# Create automated backup
docker run --rm \
  -e DB_HOST=your-db-host \
  -e DB_USER=your-db-user \
  -e DB_PASSWORD=your-db-password \
  -e S3_BUCKET=your-s3-bucket \
  -e AWS_ACCESS_KEY_ID=your-key \
  -e AWS_SECRET_ACCESS_KEY=your-secret \
  -e AWS_DEFAULT_REGION=us-east-1 \
  ghcr.io/ajaska-gmbh/docker-mysqldump-s3:latest \
  mysqldump-s3 backup --verbose

# List backups
docker run --rm \
  -e S3_BUCKET=your-s3-bucket \
  -e AWS_ACCESS_KEY_ID=your-key \
  -e AWS_SECRET_ACCESS_KEY=your-secret \
  -e AWS_DEFAULT_REGION=us-east-1 \
  ghcr.io/ajaska-gmbh/docker-mysqldump-s3:latest \
  mysqldump-s3 list --format table
```


See the [Docker documentation](./DOCKER.md) for comprehensive usage examples, CI/CD integration, and Docker Compose configurations.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Environment Variables

| Variable              | Required | Default                          | Description                                            |
|-----------------------|:--------:|----------------------------------|--------------------------------------------------------|
| DB_HOST               | Yes      |                                  | MySQL host                                             |
| DB_PORT               | No       | 3306                             | MySQL port                                             |
| DB_USER               | Yes      |                                  | MySQL user                                             |
| DB_PASSWORD           | Yes      |                                  | MySQL password                                         |
| DB_NAME               | No       |                                  | MySQL database name (optional; dumps all databases if not set) |
| AWS_ACCESS_KEY_ID     | Yes      |                                  | AWS access key ID                                      |
| AWS_SECRET_ACCESS_KEY | Yes      |                                  | AWS secret access key                                  |
| AWS_DEFAULT_REGION    | No       | AWS CLI default                  | AWS region                                             |
| S3_BUCKET             | Yes      |                                  | S3 bucket name                                         |
| S3_KEY                | No       | <db_name or all>-<timestamp>.sql.gz | S3 object key (path). A timestamp will always be appended to the key. |
| S3_ENDPOINT_URL       | No       | AWS CLI default                  | Custom S3 endpoint URL (e.g. https://s3.de.io.cloud.ovh.net) |
| RESTORE               | No       | false                            | When set to true, opens a shell in the container for restore operations |

## Listing and Restoring Backups

### Using Helper Scripts

Two helper scripts are provided in the `scripts/` directory to list existing backups in S3 and restore a selected backup into a MySQL database:

**Prerequisites:** The scripts require `aws` CLI and `mysql` client to be installed and available in your environment.

```sh
# List all backups in the S3 bucket
S3_BUCKET=your-s3-bucket AWS_ACCESS_KEY_ID=your-access-key-id AWS_SECRET_ACCESS_KEY=your-secret-access-key AWS_DEFAULT_REGION=your-aws-region \
  S3_ENDPOINT_URL=https://s3.de.io.cloud.ovh.net \
  sh scripts/list-backups.sh

# Restore a backup interactively
S3_BUCKET=your-s3-bucket \
  DB_HOST=your-db-host DB_PORT=3306 DB_USER=your-db-user DB_PASSWORD=your-db-password \
  AWS_ACCESS_KEY_ID=your-access-key-id AWS_SECRET_ACCESS_KEY=your-secret-access-key AWS_DEFAULT_REGION=your-aws-region \
  S3_ENDPOINT_URL=https://s3.de.io.cloud.ovh.net \
  bash scripts/restore-backup.sh
```

The `restore-backup.sh` script provides a fully interactive experience:
1. Lists all available backups in your S3 bucket
2. Allows you to select which backup to restore
3. Queries MySQL for available databases and lets you select which one to restore to
4. Confirms before proceeding with the restoration
5. Downloads the selected backup and restores it to your selected database
6. Provides feedback throughout the process
