# docker-mysqldump-s3

Docker image to dump a MySQL database and upload it to Amazon S3.

## Building the image

```sh
docker build -t docker-mysqldump-s3 .
```

## Usage

```sh
docker run --rm \
  -e DB_HOST=your-db-host \
  -e DB_PORT=3306 \
  -e DB_USER=your-db-user \
  -e DB_PASSWORD=your-db-password \
  [-e DB_NAME=your-db-name] \
  -e AWS_ACCESS_KEY_ID=your-access-key-id \
  -e AWS_SECRET_ACCESS_KEY=your-secret-access-key \
  -e AWS_DEFAULT_REGION=your-aws-region \
  -e S3_BUCKET=your-s3-bucket \
  [-e S3_KEY=path/to/dump.sql.gz] \
  [-e S3_ENDPOINT_URL=https://s3.de.io.cloud.ovh.net] \
  [-e RESTORE=true] \
  docker-mysqldump-s3
```

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
