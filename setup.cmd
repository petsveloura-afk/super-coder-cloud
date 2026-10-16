@echo off
REM SUPER CODER CLOUD — one-time production setup: paste keys, it configures
REM Vercel + GitHub, deploys and verifies. Safe to run again any time.
setlocal
cd /d "%~dp0"
where node >nul 2>&1 || (echo [x] Node.js is not installed: https://nodejs.org & exit /b 1)
node scripts\setup\configure.mjs
endlocal
