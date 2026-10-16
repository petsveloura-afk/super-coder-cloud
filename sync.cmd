@echo off
REM ==========================================================================
REM  SUPER CODER CLOUD — full sync from Windows
REM    sync.cmd "what changed"        commit + push (GitHub then runs CI,
REM                                   DB migrations and the Vercel deploy)
REM    sync.cmd "what changed" local  also deploy to Vercel from this PC now
REM  Never commits .env files (they are in .gitignore).
REM ==========================================================================
setlocal
cd /d "%~dp0"

where git >nul 2>&1 || (echo [x] git is not installed & exit /b 1)

REM Must run inside the project (the folder that contains .git)
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [x] This folder is not the project. Copy sync.cmd into the project folder
  echo     ^(the one with .git, apps, packages, supabase^) and run it from there.
  exit /b 1
)

set "MSG=%~1"
if "%MSG%"=="" set "MSG=sync %DATE% %TIME%"

echo.
echo [1/4] Checking for secrets that must never be committed...
git ls-files --others --exclude-standard | findstr /I /R "\.env$ \.env\.local$ \.env\.production$" >nul && (
  echo [x] An .env file is not ignored. Aborting. & exit /b 1
)

echo [2/4] Staging and committing: %MSG%
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "%MSG%"
  if errorlevel 1 (echo [x] commit failed & exit /b 1)
) else (
  echo     nothing to commit
)

echo [3/4] Pushing to GitHub (main)...
git push origin main
if errorlevel 1 (
  echo     GitHub has newer commits - pulling them first ^(rebase^)...
  git pull --rebase origin main
  if errorlevel 1 (
    echo [x] Automatic merge stopped on a conflict. Nothing was lost.
    echo     Run:  git rebase --abort   to go back, then send the output to support.
    exit /b 1
  )
  git push origin main
  if errorlevel 1 (echo [x] push failed - see message above & exit /b 1)
)

if /I "%~2"=="local" (
  echo [4/4] Deploying to Vercel from this computer...
  call npx --yes vercel@latest deploy --prod --yes
) else (
  echo [4/4] GitHub Actions will now run: CI ^> DB migrations ^> Vercel deploy.
  echo      Watch: https://github.com/petsveloura-afk/super-coder-cloud/actions
)
echo.
echo Done.
endlocal
