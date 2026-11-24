from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.models import Facility, AgentConversation, AgentMessage
from app.schemas.schemas import AgentChatRequest, AgentChatResponse, AgentMessageOut, AgentActionExecuteRequest
from app.ai_engine.agent.operations_agent import operations_agent
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/agent", tags=["AI Agent"])

@router.post("/chat", response_model=AgentChatResponse)
async def chat_with_operations_agent(
    req: AgentChatRequest,
    db: Session = Depends(get_db)
):
    facility = db.query(Facility).filter(Facility.id == req.facility_id).first()
    if not facility:
        facility = db.query(Facility).first()

    # Find or create conversation
    conv = None
    if req.conversation_id:
        conv = db.query(AgentConversation).filter(AgentConversation.id == req.conversation_id).first()
    if not conv:
        conv = AgentConversation(
            facility_id=facility.id if facility else None,
            title=f"Session - {req.message[:30]}..."
        )
        db.add(conv)
        db.commit()
        db.refresh(conv)

    # Save user message
    user_msg = AgentMessage(
        conversation_id=conv.id,
        sender="user",
        content=req.message
    )
    db.add(user_msg)
    db.commit()

    # Process via autonomous operations agent
    agent_output = operations_agent.process_query(
        db=db,
        facility_id=facility.id if facility else "fac_canteen_01",
        query=req.message
    )

    # Save agent message
    agent_msg = AgentMessage(
        conversation_id=conv.id,
        sender="agent",
        content=agent_output["reply"],
        tool_calls=agent_output["tool_calls"],
        suggested_action=agent_output["suggested_action"]
    )
    db.add(agent_msg)
    db.commit()

    return {
        "conversation_id": conv.id,
        "reply": agent_output["reply"],
        "tool_calls": agent_output["tool_calls"],
        "suggested_action": agent_output["suggested_action"],
        "context_data": agent_output.get("context_data")
    }

@router.get("/history", response_model=List[AgentMessageOut])
def get_agent_history(
    conversation_id: Optional[str] = Query(None),
    facility_id: Optional[str] = Query(None),
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db)
):
    conv = None
    if conversation_id:
        conv = db.query(AgentConversation).filter(AgentConversation.id == conversation_id).first()
    elif facility_id:
        conv = db.query(AgentConversation).filter(AgentConversation.facility_id == facility_id).order_by(AgentConversation.created_at.desc()).first()

    if not conv:
        conv = db.query(AgentConversation).order_by(AgentConversation.created_at.desc()).first()

    if not conv:
        return []

    messages = db.query(AgentMessage).filter(
        AgentMessage.conversation_id == conv.id
    ).order_by(AgentMessage.created_at.asc()).limit(limit).all()

    return messages

@router.post("/execute-action")
async def execute_agent_action(
    req: AgentActionExecuteRequest,
    db: Session = Depends(get_db)
):
    msg = db.query(AgentMessage).filter(AgentMessage.id == req.message_id).first()
    if not msg:
        # Allow execution even if message_id not registered yet
        pass

    result = operations_agent.execute_action(
        db=db,
        user_email="admin@queuemind.ai",
        action_type=req.action_type,
        payload=req.payload
    )

    if msg and result.get("success"):
        msg.is_action_executed = True
        db.commit()

    # Broadcast notification
    await ws_manager.broadcast_global("AGENT_ACTION_EXECUTED", {
        "action_type": req.action_type,
        "message": result.get("message")
    })

    return result
