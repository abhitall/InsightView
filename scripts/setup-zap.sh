#!/bin/bash

# Create ZAP directories with proper permissions
mkdir -p zap/scripts zap/data
chmod -R 777 zap

# Check if running in GitHub Actions
if [ -n "$GITHUB_WORKSPACE" ]; then
    echo "Running in GitHub Actions, setting ownership to 1000:1000"
    chown -R 1000:1000 zap
fi

# Create basic configuration files
cat > zap/scripts/.placeholder << EOF
# This file ensures the scripts directory is created and tracked in git
EOF

cat > zap/data/.placeholder << EOF
# This file ensures the data directory is created and tracked in git
EOF