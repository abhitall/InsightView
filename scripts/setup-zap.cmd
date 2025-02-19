@echo off
REM Create ZAP directories
if not exist "zap\scripts" mkdir "zap\scripts"
if not exist "zap\data" mkdir "zap\data"

REM Create placeholder files
echo # This file ensures the scripts directory is created and tracked in git > zap\scripts\.placeholder
echo # This file ensures the data directory is created and tracked in git > zap\data\.placeholder

REM Add directory to .gitignore but keep placeholders
echo zap/* > .gitignore
echo !zap/scripts/.placeholder >> .gitignore
echo !zap/data/.placeholder >> .gitignore

echo ZAP directories created successfully