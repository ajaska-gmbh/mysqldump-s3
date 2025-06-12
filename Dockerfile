FROM ubuntu:22.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      mysql-client \
      python3 \
      python3-pip \
      ca-certificates \
      bash && \
    pip3 install --no-cache-dir awscli && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create scripts directory
RUN mkdir -p /scripts

# Copy helper scripts
COPY /scripts/list-backups.sh /scripts/list-backups.sh
COPY /scripts/restore-backup.sh /scripts/restore-backup.sh
RUN chmod +x /scripts/*.sh



ENTRYPOINT ["/entrypoint.sh"]
