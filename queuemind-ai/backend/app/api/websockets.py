from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.websocket_manager import ws_manager
import logging

logger = logging.getLogger("queuemind.ws_router")

router = APIRouter(tags=["WebSockets"])

@router.websocket("/ws/queues/{facility_id}")
async def websocket_queue_endpoint(websocket: WebSocket, facility_id: str):
    await ws_manager.connect(websocket, facility_id)
    try:
        # Send initial confirmation handshake
        await websocket.send_json({
            "event": "CONNECTED",
            "facility_id": facility_id,
            "message": f"Connected to real-time live channel for facility: {facility_id}"
        })
        while True:
            # Keep connection open and receive any client ping or client-side filter changes
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, facility_id)
    except Exception as e:
        logger.debug(f"WebSocket closed: {e}")
        ws_manager.disconnect(websocket, facility_id)

@router.websocket("/ws/global")
async def websocket_global_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket, "global")
    try:
        await websocket.send_json({
            "event": "CONNECTED",
            "channel": "global",
            "message": "Connected to QueueMind AI global event bus."
        })
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, "global")
    except Exception as e:
        logger.debug(f"Global WS closed: {e}")
        ws_manager.disconnect(websocket, "global")
