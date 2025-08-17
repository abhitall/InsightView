FROM mcr.microsoft.com/playwright:v1.51.0-focal

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy project files
COPY . .

# Install Playwright browsers
RUN npx playwright install --with-deps chromium

# Set environment variables
ENV AWS_ACCESS_KEY_ID=""
ENV AWS_SECRET_ACCESS_KEY=""
ENV AWS_REGION=""
ENV S3_BUCKET=""
ENV PROMETHEUS_PUSHGATEWAY=""
ENV TEST_URL=""

# Run tests and exit
CMD ["npm", "run", "test:synthetic"]