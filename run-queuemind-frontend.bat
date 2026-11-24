@echo off
echo ========================================================
echo  QueueMind AI - Starting Next.js Production Frontend
echo ========================================================
cd /d "%~dp0"
echo Launching Next.js on http://localhost:3000 ...
npm run dev
pause
