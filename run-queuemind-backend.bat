@echo off
echo ========================================================
echo  QueueMind AI - Starting Backend API & AI Engine
echo ========================================================
cd /d "%~dp0queuemind-ai\backend"
echo Installing any missing dependencies...
pip install -r requirements.txt
echo Launching Uvicorn ASGI server on http://127.0.0.1:8000 ...
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
pause
