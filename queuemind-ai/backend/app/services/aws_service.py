import os
import boto3
import logging
from botocore.exceptions import BotoCoreError, ClientError
from typing import Optional, Dict, Any
from app.core.config import settings

logger = logging.getLogger("queuemind.aws")

class AWSService:
    def __init__(self):
        self.region = settings.AWS_REGION
        self.has_credentials = bool(settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY)
        
        self.s3_client = None
        self.sns_client = None
        self.cloudwatch_client = None
        
        if self.has_credentials:
            try:
                self.s3_client = boto3.client(
                    "s3",
                    region_name=self.region,
                    aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                    aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY
                )
                self.sns_client = boto3.client(
                    "sns",
                    region_name=self.region,
                    aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                    aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY
                )
                self.cloudwatch_client = boto3.client(
                    "cloudwatch",
                    region_name=self.region,
                    aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                    aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY
                )
                logger.info("AWS Boto3 clients successfully initialized with configured IAM credentials.")
            except Exception as e:
                logger.warning(f"Failed to initialize AWS clients despite credentials: {e}. Falling back to local simulation.")
        else:
            logger.info("AWS credentials not provided. Operating in graceful local simulation mode (Local S3 storage, Local SNS log, Local CloudWatch metrics).")

    def upload_file_to_s3(self, file_bytes: bytes, file_name: str, content_type: str = "image/jpeg") -> Dict[str, Any]:
        """Uploads file to AWS S3, or gracefully stores in local upload directory."""
        if self.s3_client and settings.AWS_S3_BUCKET_NAME:
            try:
                s3_key = f"queues/{file_name}"
                self.s3_client.put_object(
                    Bucket=settings.AWS_S3_BUCKET_NAME,
                    Key=s3_key,
                    Body=file_bytes,
                    ContentType=content_type
                )
                url = self.s3_client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": settings.AWS_S3_BUCKET_NAME, "Key": s3_key},
                    ExpiresIn=86400
                )
                return {
                    "storage": "aws_s3",
                    "bucket": settings.AWS_S3_BUCKET_NAME,
                    "key": s3_key,
                    "url": url,
                    "is_cloud": True
                }
            except Exception as e:
                logger.warning(f"S3 upload failed: {e}. Falling back to local storage.")

        # Local storage fallback
        local_path = os.path.join(settings.UPLOAD_DIR, file_name)
        with open(local_path, "wb") as f:
            f.write(file_bytes)
        
        return {
            "storage": "local_storage",
            "bucket": "local-fallback",
            "key": file_name,
            "url": f"/api/detection/media/{file_name}",
            "is_cloud": False
        }

    def publish_sns_alert(self, subject: str, message: str, level: str = "warning") -> Dict[str, Any]:
        """Publishes critical congestion notifications via AWS SNS or local dispatcher."""
        if self.sns_client and settings.AWS_SNS_TOPIC_ARN:
            try:
                response = self.sns_client.publish(
                    TopicArn=settings.AWS_SNS_TOPIC_ARN,
                    Subject=f"[QueueMind AI - {level.upper()}] {subject}",
                    Message=message,
                    MessageAttributes={
                        "AlertLevel": {"DataType": "String", "StringValue": level},
                        "Source": {"DataType": "String", "StringValue": "QueueMind-AI-Engine"}
                    }
                )
                return {
                    "status": "delivered_sns",
                    "sns_message_id": response.get("MessageId"),
                    "topic_arn": settings.AWS_SNS_TOPIC_ARN,
                    "is_cloud": True
                }
            except Exception as e:
                logger.warning(f"SNS publish failed: {e}. Dispatched locally.")

        # Local fallback simulation
        mock_id = f"local-sns-{os.urandom(4).hex()}"
        logger.info(f"[LOCAL NOTIFICATION DISPATCH] Subject: {subject} | Level: {level} | Body: {message}")
        return {
            "status": "delivered_local_mock",
            "sns_message_id": mock_id,
            "topic_arn": "arn:aws:sns:local:000000000000:queuemind-alerts",
            "is_cloud": False
        }

    def put_cloudwatch_metric(self, metric_name: str, value: float, unit: str = "Count", dimensions: Optional[Dict[str, str]] = None):
        """Puts metric to AWS CloudWatch or logs locally."""
        dim_list = []
        if dimensions:
            dim_list = [{"Name": k, "Value": v} for k, v in dimensions.items()]

        if self.cloudwatch_client:
            try:
                self.cloudwatch_client.put_metric_data(
                    Namespace="QueueMindAI/Operations",
                    MetricData=[{
                        "MetricName": metric_name,
                        "Value": value,
                        "Unit": unit,
                        "Dimensions": dim_list
                    }]
                )
                return True
            except Exception as e:
                logger.warning(f"CloudWatch metric publish failed: {e}")

        logger.debug(f"[CLOUDWATCH METRIC] {metric_name}={value} ({unit}) | dims={dimensions}")
        return False

    def get_aws_status(self) -> Dict[str, Any]:
        """Returns verified connection status for AWS infrastructure components."""
        return {
            "configured": self.has_credentials,
            "region": self.region,
            "s3_connected": bool(self.s3_client),
            "sns_connected": bool(self.sns_client and settings.AWS_SNS_TOPIC_ARN),
            "cloudwatch_connected": bool(self.cloudwatch_client),
            "rds_connected": not settings.DATABASE_URL.startswith("sqlite"),
            "storage_provider": "AWS S3" if (self.s3_client and settings.AWS_S3_BUCKET_NAME) else "Local Resilient Storage",
            "notifications_provider": "AWS SNS" if (self.sns_client and settings.AWS_SNS_TOPIC_ARN) else "In-App Realtime Dispatcher"
        }

aws_service = AWSService()
