@echo off
echo =========================================================================
echo    QueueMind AI - AWS App Runner Automated Deployment Helper
echo =========================================================================
echo.
echo Checking for AWS CLI...
where aws >nul 2>nul
if %errorlevel% neq 0 (
    echo [NOTICE] AWS CLI not found on system PATH.
    echo.
    echo To deploy to AWS App Runner via the AWS Management Console:
    echo  1. Push your repository to GitHub.
    echo  2. Open the AWS Console -^> App Runner -^> Create Service.
    echo  3. Choose "Source code repository" and select your repository.
    echo  4. App Runner will automatically detect "apprunner.yaml".
    echo  5. Port: 8000 ^| Health Check: /api/health
    echo  6. Click "Create & Deploy".
    echo.
    echo Your service will be assigned a live public HTTPS URL!
    pause
    exit /b
)

echo AWS CLI detected.
echo Configuring App Runner service...
echo If you have configured AWS credentials, you can run:
echo   aws apprunner create-service --cli-input-json file://queuemind-ai/infrastructure/apprunner-service.json
echo.
pause
