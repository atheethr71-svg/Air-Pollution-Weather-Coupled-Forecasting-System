import json
import logging
from typing import Dict, List
from fastapi import WebSocket

logger = logging.getLogger("queuemind.ws")

class WebSocketManager:
    def __init__(self):
        # facility_id -> list of active WebSockets
        self.active_connections: Dict[str, List[WebSocket]] = {}
        self.global_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket, facility_id: str = "global"):
        await websocket.accept()
        if facility_id == "global":
            self.global_connections.append(websocket)
        else:
            if facility_id not in self.active_connections:
                self.active_connections[facility_id] = []
            self.active_connections[facility_id].append(websocket)
        logger.info(f"WebSocket client connected to channel: {facility_id}")

    def disconnect(self, websocket: WebSocket, facility_id: str = "global"):
        if facility_id == "global" and websocket in self.global_connections:
            self.global_connections.remove(websocket)
        elif facility_id in self.active_connections and websocket in self.active_connections[facility_id]:
            self.active_connections[facility_id].remove(websocket)
        logger.info(f"WebSocket client disconnected from channel: {facility_id}")

    async def broadcast_to_facility(self, facility_id: str, event_type: str, data: dict):
        payload = json.dumps({
            "event": event_type,
            "facility_id": facility_id,
            "data": data
        })
        # Broadcast to facility-specific connections
        targets = list(self.active_connections.get(facility_id, []))
        for conn in targets:
            try:
                await conn.send_text(payload)
            except Exception as e:
                logger.debug(f"Failed to send to client on {facility_id}: {e}")
                self.disconnect(conn, facility_id)

        # Also broadcast to global observers
        global_targets = list(self.global_connections)
        for conn in global_targets:
            try:
                await conn.send_text(payload)
            except Exception as e:
                logger.debug(f"Failed to send to global observer: {e}")
                self.disconnect(conn, "global")

    async def broadcast_global(self, event_type: str, data: dict):
        payload = json.dumps({
            "event": event_type,
            "data": data
        })
        all_connections = list(self.global_connections)
        for conns in self.active_connections.values():
            all_connections.extend(conns)

        for conn in all_connections:
            try:
                await conn.send_text(payload)
            except Exception:
                pass

ws_manager = WebSocketManager()
