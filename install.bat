@echo off
echo Installing agent-isolated-input...
cd /d "%~dp0"
npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install failed. Make sure Node.js ^>=18 is on your PATH.
    exit /b 1
)
npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: TypeScript build failed.
    exit /b 1
)
echo.
echo Done! Register the MCP server with Claude Code:
echo   claude mcp add agent-isolated-input -- node "%~dp0dist\index.js"
echo.
echo To publish to ClawHub:
echo   clawhub publish .
echo.
pause
