FROM mcr.microsoft.com/playwright:v1.53.1-noble

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy project files
COPY . .

# Install system dependencies (like jq for the entrypoint script)
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*

# Create report/results directories
# The Playwright base image mcr.microsoft.com/playwright:vX.Y.Z-noble includes browsers and their dependencies.
# So, `npx playwright install --with-deps` is generally not needed and has been removed.
RUN mkdir -p playwright-report test-results

# Make the entrypoint script executable
# This script is copied via `COPY . .` earlier
RUN chmod +x .github/actions/synthetic-monitoring/scripts/docker-entrypoint.sh

# Set environment variables (can be overridden at runtime)
ENV AWS_ACCESS_KEY_ID=""
ENV AWS_SECRET_ACCESS_KEY=""
ENV AWS_REGION=""
ENV S3_BUCKET=""
ENV PROMETHEUS_PUSHGATEWAY=""
ENV TEST_URL=""
# Placeholder for other S3 vars that might be set by the action
ENV S3_ENDPOINT=""
ENV S3_FORCE_PATH_STYLE="false"
ENV S3_TLS_VERIFY="true"

# Default command to run tests (will be overridden by the GitHub Action's entrypoint/args)
CMD ["npm", "run", "test:synthetic"]