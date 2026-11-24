@echo off
echo =========================================================================
echo   QueueMind AI - Smart Queue Monitoring & Predictive Management System
echo =========================================================================
echo Starting Backend (FastAPI on port 8000) and Frontend (Next.js on port 3000)...
start "QueueMind Backend API" cmd /k "run-queuemind-backend.bat"
timeout /t 3 /nobreak >nul
start "QueueMind Frontend App" cmd /k "run-queuemind-frontend.bat"
echo.
echo QueueMind AI is launching!
echo Backend API Docs: http://127.0.0.1:8000/docs
echo Frontend Web App: http://localhost:3000
echo.
pause
