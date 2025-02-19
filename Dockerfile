FROM mcr.microsoft.com/playwright:v1.42.1-focal

WORKDIR /app

# Install Docker client (needed for running ZAP container)
RUN apt-get update && apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    software-properties-common \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy project files
COPY . .

# Install Playwright browsers
RUN npx playwright install --with-deps chromium

# Create directory for ZAP results
RUN mkdir -p zap-results

# Set environment variables
ENV AWS_ACCESS_KEY_ID=""
ENV AWS_SECRET_ACCESS_KEY=""
ENV AWS_REGION=""
ENV S3_BUCKET=""
ENV PROMETHEUS_PUSHGATEWAY=""
ENV TEST_URL=""

# Run tests and exit
CMD ["npm", "run", "test:synthetic"]