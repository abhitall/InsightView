#!/bin/bash

# Process ZAP reports and upload to S3
# This script can be run after a local ZAP scan to analyze and upload reports

echo "Processing ZAP security scan reports..."

# Check if required environment variables are set
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ] || [ -z "$AWS_REGION" ] || [ -z "$S3_BUCKET" ]; then
  echo "Please set the following environment variables:"
  echo "AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET"
  exit 1
fi

# Run the TypeScript processor
npx ts-node ./scripts/process-zap-reports.ts

# Exit with the same status as the processor
exit $?