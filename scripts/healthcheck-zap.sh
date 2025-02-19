#!/bin/sh
# Simple healthcheck script for ZAP container

# Wait for ZAP daemon to be responsive
MAX_RETRIES=10
RETRY_INTERVAL=3

for i in $(seq 1 $MAX_RETRIES); do
    if curl -sf http://localhost:8080/ > /dev/null; then
        echo "ZAP is ready"
        exit 0
    fi
    echo "Attempt $i/$MAX_RETRIES: ZAP not ready yet, waiting ${RETRY_INTERVAL}s..."
    sleep $RETRY_INTERVAL
done

echo "ZAP failed to start within ${MAX_RETRIES} attempts"
exit 1