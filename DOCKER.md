# Docker Usage

This document describes how to use the Docker image for automation, supporting both the legacy bash-based approach and the new Node.js CLI.

## Building the Docker Image

```sh
docker build -t docker-mysqldump-s3 .
```

## CLI Usage (Recommended)

### Backup
```sh
docker run --rm \
  -e DB_HOST=your-db-host \
  -e DB_USER=your-db-user \
  -e DB_PASSWORD=your-db-password \
  -e S3_BUCKET=your-s3-bucket \
  -e AWS_ACCESS_KEY_ID=your-access-key-id \
  -e AWS_SECRET_ACCESS_KEY=your-secret-access-key \
  -e AWS_DEFAULT_REGION=your-aws-region \
  docker-mysqldump-s3 mysqldump-s3 backup --verbose
```

### List Backups
```sh
docker run --rm \
  -e S3_BUCKET=your-s3-bucket \
  -e AWS_ACCESS_KEY_ID=your-access-key-id \
  -e AWS_SECRET_ACCESS_KEY=your-secret-access-key \
  -e AWS_DEFAULT_REGION=your-aws-region \
  docker-mysqldump-s3 mysqldump-s3 list --format table
```

### Restore (Non-interactive)
```sh
docker run --rm \
  -e DB_HOST=your-db-host \
  -e DB_USER=your-db-user \
  -e DB_PASSWORD=your-db-password \
  -e S3_BUCKET=your-s3-bucket \
  -e AWS_ACCESS_KEY_ID=your-access-key-id \
  -e AWS_SECRET_ACCESS_KEY=your-secret-access-key \
  -e AWS_DEFAULT_REGION=your-aws-region \
  docker-mysqldump-s3 mysqldump-s3 restore \
    --backup-key "mydb-2023-12-01T10:00:00Z.sql.gz" \
    --database "mydb" \
    --no-confirm
```

## Legacy Usage (Backward Compatibility)

The original bash-based automation is still supported:


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

## Automation Examples

### CI/CD Pipeline (GitHub Actions)
```yaml
name: Database Backup
on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Backup Database
        run: |
          docker run --rm \
            -e DB_HOST=${{ secrets.DB_HOST }} \
            -e DB_USER=${{ secrets.DB_USER }} \
            -e DB_PASSWORD=${{ secrets.DB_PASSWORD }} \
            -e DB_NAME=${{ secrets.DB_NAME }} \
            -e AWS_ACCESS_KEY_ID=${{ secrets.AWS_ACCESS_KEY_ID }} \
            -e AWS_SECRET_ACCESS_KEY=${{ secrets.AWS_SECRET_ACCESS_KEY }} \
            -e AWS_DEFAULT_REGION=${{ secrets.AWS_DEFAULT_REGION }} \
            -e S3_BUCKET=${{ secrets.S3_BUCKET }} \
            ghcr.io/ajaska-gmbh/docker-mysqldump-s3:latest \
            mysqldump-s3 backup --verbose
```

### Docker Compose for Scheduled Backups
```yaml
version: '3.8'
services:
  mysql-backup:
    image: ghcr.io/ajaska-gmbh/docker-mysqldump-s3:latest
    command: mysqldump-s3 backup --verbose
    environment:
      DB_HOST: mysql
      DB_USER: root
      DB_PASSWORD: password
      DB_NAME: myapp
      AWS_ACCESS_KEY_ID: your-key
      AWS_SECRET_ACCESS_KEY: your-secret
      AWS_DEFAULT_REGION: us-east-1
      S3_BUCKET: my-backups
    depends_on:
      - mysql
    profiles:
      - backup

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: password
      MYSQL_DATABASE: myapp
```