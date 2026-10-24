from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID, uuid4
from typing import List

from app.database import get_db, AsyncSessionLocal
from app.models.user import User
from app.models.project import Project
from app.models.chat import ChatSession, ChatMessage
from app.schemas.chat import ChatSessionResponse, ChatMessageCreate, ChatMessageResponse, CitationItem
from app.services.auth_service import get_current_user
from app.services.gemini_chat_agent import gemini_chat_agent

router = APIRouter(tags=["Chat"])

@router.get("/projects/{project_id}/chat/sessions", response_model=List[ChatSessionResponse])
async def list_chat_sessions(project_id: UUID, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    res = await db.execute(select(ChatSession).where(ChatSession.project_id == project_id).order_by(ChatSession.updated_at.desc()))
    sessions = res.scalars().all()
    return [ChatSessionResponse.model_validate(s) for s in sessions]

@router.post("/projects/{project_id}/chat/sessions", response_model=ChatSessionResponse)
async def create_chat_session(project_id: UUID, title: str = "New Chat", db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = ChatSession(project_id=project_id, title=title)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return ChatSessionResponse.model_validate(session)

@router.get("/chat/sessions/{session_id}", response_model=ChatSessionResponse)
async def get_session_details(session_id: UUID, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    m_res = await db.execute(select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at.asc()))
    messages = m_res.scalars().all()

    return ChatSessionResponse(
        id=session.id,
        project_id=session.project_id,
        title=session.title,
        created_at=session.created_at,
        updated_at=session.updated_at,
        messages=[ChatMessageResponse.model_validate(m) for m in messages]
    )

@router.post("/projects/{project_id}/chat/message", response_model=ChatMessageResponse)
async def send_chat_message(
    project_id: UUID,
    payload: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Ensure or get session
    session_id = payload.session_id
    if not session_id:
        # Get latest session or create one
        s_res = await db.execute(select(ChatSession).where(ChatSession.project_id == project_id).order_by(ChatSession.updated_at.desc()).limit(1))
        session = s_res.scalar_one_or_none()
        if not session:
            session = ChatSession(project_id=project_id, title="Research Discussion")
            db.add(session)
            await db.commit()
            await db.refresh(session)
        session_id = session.id

    # 1. Save User Message
    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=payload.content
    )
    db.add(user_msg)
    await db.commit()

    # 2. Run Gemini Grounded Chat Turn
    turn_result = await gemini_chat_agent.run_chat_turn(
        db=db,
        project_id=project_id,
        history=[],
        new_user_message=payload.content
    )

    # 3. Save Assistant Message with Citations
    assistant_msg = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=turn_result["content"],
        citations=turn_result["citations"],
        tool_calls=turn_result.get("tool_calls", [])
    )
    db.add(assistant_msg)
    await db.commit()
    await db.refresh(assistant_msg)

    return ChatMessageResponse.model_validate(assistant_msg)

@router.post("/projects/{project_id}/chat/stream")
async def stream_chat_endpoint(
    project_id: UUID,
    payload: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Server-Sent Events endpoint streaming the Gemini response token-by-token
    and completing with grounded citations.
    """
    session_id = payload.session_id
    if not session_id:
        s_res = await db.execute(select(ChatSession).where(ChatSession.project_id == project_id).order_by(ChatSession.updated_at.desc()).limit(1))
        session = s_res.scalar_one_or_none()
        if not session:
            session = ChatSession(project_id=project_id, title="Research Discussion")
            db.add(session)
            await db.commit()
            await db.refresh(session)
        session_id = session.id

    # Persist user message
    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=payload.content
    )
    db.add(user_msg)
    await db.commit()

    # Stream generator
    async def event_generator():
        async with AsyncSessionLocal() as stream_db:
            async for chunk in gemini_chat_agent.stream_chat_turn(
                db=stream_db,
                project_id=project_id,
                history=[],
                new_user_message=payload.content
            ):
                yield chunk

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
