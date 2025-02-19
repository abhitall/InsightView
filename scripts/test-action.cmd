@echo off
REM Test Action Script for Windows

REM Ensure clean environment
docker compose -f docker-compose.test.yml down -v

REM Start test infrastructure
echo Starting test infrastructure...
docker compose -f docker-compose.test.yml up -d --wait

REM Run tests
echo Running tests...
set TEST_URL=http://example.com
set ZAP_API_URL=http://localhost:8080
playwright test tests/security.spec.ts

REM Cleanup
docker compose -f docker-compose.test.yml down -v