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
  -e DB_NAME=your-db-name \
  -e AWS_ACCESS_KEY_ID=your-access-key-id \
  -e AWS_SECRET_ACCESS_KEY=your-secret-access-key \
  -e AWS_DEFAULT_REGION=your-aws-region \
  -e S3_BUCKET=your-s3-bucket \
  [-e S3_KEY=path/to/dump.sql.gz] \
  [-e S3_EXPIRES=2023-01-01T00:00:00Z] \
  [-e S3_EXPIRES_DAYS=7] \
  docker-mysqldump-s3
```

## Environment Variables

| Variable              | Required | Default                          | Description                                            |
|-----------------------|:--------:|----------------------------------|--------------------------------------------------------|
| DB_HOST               | Yes      |                                  | MySQL host                                             |
| DB_PORT               | No       | 3306                             | MySQL port                                             |
| DB_USER               | Yes      |                                  | MySQL user                                             |
| DB_PASSWORD           | Yes      |                                  | MySQL password                                         |
| DB_NAME               | Yes      |                                  | MySQL database name                                    |
| AWS_ACCESS_KEY_ID     | Yes      |                                  | AWS access key ID                                      |
| AWS_SECRET_ACCESS_KEY | Yes      |                                  | AWS secret access key                                  |
| AWS_DEFAULT_REGION    | No       | AWS CLI default                  | AWS region                                             |
| S3_BUCKET             | Yes      |                                  | S3 bucket name                                         |
| S3_KEY                | No       | <db_name>-<timestamp>.sql.gz     | S3 object key (path)                                   |
| S3_EXPIRES            | No       |                                  | ISO 8601 timestamp to set the `Expires` header on the S3 object (ignored if `S3_EXPIRES_DAYS` is set) |
| S3_EXPIRES_DAYS       | No       |                                  | Number of days from now to set the `Expires` header on the S3 object (overrides `S3_EXPIRES`) |

## Listing and Restoring Backups

Two helper scripts are provided in the `scripts/` directory to list existing backups in S3 and restore a selected backup into a MySQL database:

```sh
# List all backups in the S3 bucket
S3_BUCKET=your-s3-bucket AWS_ACCESS_KEY_ID=your-access-key-id AWS_SECRET_ACCESS_KEY=your-secret-access-key AWS_DEFAULT_REGION=your-aws-region \
  sh scripts/list-backups.sh

# Restore a specific backup
S3_BUCKET=your-s3-bucket S3_KEY=path/to/backup.sql.gz \
  DB_HOST=your-db-host DB_PORT=3306 DB_USER=your-db-user DB_PASSWORD=your-db-password DB_NAME=your-db-name \
  AWS_ACCESS_KEY_ID=your-access-key-id AWS_SECRET_ACCESS_KEY=your-secret-access-key AWS_DEFAULT_REGION=your-aws-region \
  sh scripts/restore-backup.sh
```

## Continuous Integration

A GitHub Actions workflow is provided in `.github/workflows/docker-publish.yml` to build and push the Docker image to GitHub Container Registry on pushes to the `main` branch. The image is published as:

```txt
ghcr.io/ajaska-gmbh/docker-mysqldump-s3:latest
```