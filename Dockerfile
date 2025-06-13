FROM node:20-slim

# Install required system packages
RUN apt-get update && apt-get install -y \
    default-mysql-client \
    awscli \
    ca-certificates \
    --no-install-recommends && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

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

ENTRYPOINT ["/entrypoint.sh"]
