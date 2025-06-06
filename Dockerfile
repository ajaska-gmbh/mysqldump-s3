FROM ubuntu:22.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      mysql-client \
      python3 \
      python3-pip \
      ca-certificates && \
    pip3 install --no-cache-dir awscli && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
