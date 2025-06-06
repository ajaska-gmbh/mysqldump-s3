FROM alpine:3.18

RUN apk update && \
    apk add --no-cache \
      mariadb-client \
      mariadb-connector-c \
      python3 \
      py3-pip && \
    pip3 install --no-cache-dir awscli

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]