FROM mcr.microsoft.com/playwright:v1.42.1-focal

WORKDIR /app

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
ENV ZAP_API_URL="http://zap:8080"

# Run tests and exit
CMD ["npm", "run", "test:synthetic"]