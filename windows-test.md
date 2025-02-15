"C:\Users\tallu\Downloads\act_Windows_x86_64\act.exe" pull_request ^
  -s AWS_ACCESS_KEY_ID=test ^
  -s AWS_SECRET_ACCESS_KEY=test ^
  -s AWS_REGION=us-east-2 ^
  -s S3_BUCKET=test-bucket ^
  -s PROMETHEUS_PUSHGATEWAY=http://localhost:9091 ^
  -s TEST_URL=http://example.com ^
  --container-architecture linux/amd64
