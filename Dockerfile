FROM node:18-alpine

# Install required system packages
RUN apk add --no-cache \
    mysql-client \
    bash \
    aws-cli \
    ca-certificates

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm install

# Copy TypeScript configuration and source
COPY tsconfig.json ./
COPY src/ ./src/

# Build the TypeScript project
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Create scripts directory and copy helper scripts
RUN mkdir -p /scripts
COPY scripts/list-backups.sh /scripts/list-backups.sh
COPY scripts/restore-backup.sh /scripts/restore-backup.sh
RUN chmod +x /scripts/*.sh

# Make CLI globally available
RUN npm link

# Default to legacy entrypoint for backward compatibility
# Users can override this to use the new CLI directly
ENTRYPOINT ["/entrypoint.sh"]
