FROM node:20-slim

# Install required system packages
RUN apt-get update && apt-get install -y \
    default-mysql-client \
    awscli \
    ca-certificates \
    wget \
    tar \
    --no-install-recommends && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install s5cmd v2.3.0
RUN wget -qO- https://github.com/peak/s5cmd/releases/download/v2.3.0/s5cmd_2.3.0_Linux-64bit.tar.gz | tar xz && \
    mv s5cmd /usr/local/bin/ && \
    chmod +x /usr/local/bin/s5cmd

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

RUN npm prune --production

RUN npm link

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
