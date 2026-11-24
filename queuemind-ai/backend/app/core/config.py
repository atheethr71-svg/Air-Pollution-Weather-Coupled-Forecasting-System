import os
from typing import List, Optional
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "QueueMind AI"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"
    
    # Security
    SECRET_KEY: str = os.getenv("SECRET_KEY", "queuemind-ai-super-secret-jwt-key-hackathon-2026-prod")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./queuemind.db")
    
    # AWS Cloud Integration (Graceful fallbacks when unconfigured)
    AWS_ACCESS_KEY_ID: Optional[str] = os.getenv("AWS_ACCESS_KEY_ID", None)
    AWS_SECRET_ACCESS_KEY: Optional[str] = os.getenv("AWS_SECRET_ACCESS_KEY", None)
    AWS_REGION: str = os.getenv("AWS_REGION", "us-east-1")
    AWS_S3_BUCKET_NAME: str = os.getenv("AWS_S3_BUCKET_NAME", "queuemind-ai-storage")
    AWS_SNS_TOPIC_ARN: Optional[str] = os.getenv("AWS_SNS_TOPIC_ARN", None)
    AWS_CLOUDWATCH_LOG_GROUP: str = os.getenv("AWS_CLOUDWATCH_LOG_GROUP", "/aws/apprunner/queuemind-ai")
    
    # Application Mode
    DEMO_MODE: bool = os.getenv("DEMO_MODE", "true").lower() in ("true", "1", "t")
    SIMULATION_TICK_SECONDS: int = 4
    UPLOAD_DIR: str = os.getenv("UPLOAD_DIR", "./uploads")
    
    # CORS
    CORS_ORIGINS: List[str] = ["*"]
    
    model_config = {
        "env_file": ".env",
        "extra": "ignore"
    }

settings = Settings()

# Ensure local upload directory exists
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
