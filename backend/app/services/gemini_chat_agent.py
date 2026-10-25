import asyncio
import re
import json
import logging
from typing import AsyncGenerator, List, Dict, Any, Optional
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import google.generativeai as genai
from google.api_core import exceptions as gexc
from google.generativeai.types import content_types

from app.config import settings
from app.models.paper import Paper, PaperSection
from app.models.dataset import Dataset
from app.services.vector_search import vector_search_service
from app.services.dataset_service import dataset_service

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are ResearchIDE AI, an uncompromising academic research assistant embedded in the user's IDE.

CRITICAL GROUNDING DIRECTIVE:
1. You answer questions pulling information ONLY from the project's library (/library papers) and data stores (/data datasets).
2. NEVER use outside ungrounded speculation. If the project's papers or data do not contain the information required to answer, you MUST state plainly:
   "The current project library and datasets do not contain sufficient evidence to answer this question."
3. CITATIONS ARE MANDATORY:
   - For every factual statement, provide a precise markdown citation badge in the format:
     `[Paper Title, Section Name, p. X]` or `[Dataset: Dataset Name]`.
   - Never make a claim without attributing it to an exact paper section or dataset column/metric.
4. When relevant, present mathematical formulas using standard LaTeX format (e.g. `$E = mc^2$` or `$$\\int_0^\\infty ...$$`).
5. The relevant project excerpts are provided below. Answer directly in text; you have no tools to call.
"""

def _response_text(response) -> str:
    """Joins the text parts of a Gemini response; response.text raises if any part isn't text (e.g. a function call)."""
    parts = []
    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            text = getattr(part, "text", "")
            if text:
                parts.append(text)
        if parts:
            break
    return "".join(parts)

class GeminiUnavailableError(Exception):
    """Raised when every configured chat model is out of quota or unavailable."""


class GeminiChatAgent:
    def __init__(self):
        if settings.GEMINI_API_KEY:
            genai.configure(api_key=settings.GEMINI_API_KEY)
        self.model_name = settings.GEMINI_CHAT_MODEL or "gemini-3.5-flash"

    def _candidate_models(self) -> List[str]:
        # Free-tier quotas are per model, so when one model is exhausted the next one usually still works
        fallbacks = [m.strip() for m in (settings.GEMINI_FALLBACK_MODELS or "").split(",") if m.strip()]
        return list(dict.fromkeys([self.model_name, *fallbacks]))

    async def _start_generation(self, prompt: str, stream: bool, generation_config: Optional[Dict[str, Any]] = None):
        """
        Starts a generation on the first model that accepts the request.
        For streaming, returns (model_name, first_chunk, response) so quota errors
        raised on the first chunk can still fall through to the next model.
        """
        errors = []
        for name in self._candidate_models():
            model = genai.GenerativeModel(model_name=name)
            try:
                # retry=None: the SDK otherwise silently retries 429s for minutes, which looks like a hang
                response = await asyncio.wait_for(
                    model.generate_content_async(
                        prompt,
                        stream=stream,
                        generation_config=generation_config,
                        request_options={"retry": None, "timeout": settings.GEMINI_TIMEOUT_SECONDS}
                    ),
                    timeout=settings.GEMINI_TIMEOUT_SECONDS
                )
                if not stream:
                    return name, None, response
                iterator = response.__aiter__()
                first_chunk = await asyncio.wait_for(iterator.__anext__(), timeout=settings.GEMINI_TIMEOUT_SECONDS)
                return name, first_chunk, iterator
            except (gexc.ResourceExhausted, gexc.NotFound, gexc.ServiceUnavailable, gexc.DeadlineExceeded, asyncio.TimeoutError) as e:
                reason = "timed out" if isinstance(e, asyncio.TimeoutError) else type(e).__name__
                logger.warning(f"Gemini model {name} unavailable ({reason}); trying next model")
                errors.append(f"{name}: {reason}")
        raise GeminiUnavailableError("; ".join(errors))

    async def generate_text(self, prompt: str) -> str:
        """One-off generation (no retrieval) with the same model fallback as chat. Raises GeminiUnavailableError."""
        if not settings.GEMINI_API_KEY:
            raise GeminiUnavailableError("GEMINI_API_KEY is not set")
        _, _, response = await self._start_generation(prompt, stream=False)
        return _response_text(response).strip()

    async def generate_json(self, prompt: str) -> Any:
        """Like generate_text, but asks the model for JSON and parses it. Raises GeminiUnavailableError / ValueError."""
        if not settings.GEMINI_API_KEY:
            raise GeminiUnavailableError("GEMINI_API_KEY is not set")
        model_used, _, response = await self._start_generation(
            prompt, stream=False, generation_config={"response_mime_type": "application/json", "temperature": 0.1}
        )
        raw = _response_text(response).strip()
        # Some models still wrap JSON in a code fence
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            raise ValueError(f"{model_used} returned invalid JSON: {e}") from e

    def _unavailable_message(self, err: Exception) -> str:
        return (
            "⚠️ Gemini didn't respond: every configured model is out of quota or unavailable "
            f"({err}). Free-tier keys allow about 20 requests per model per day; "
            "try again later or use a key with billing enabled."
        )

    async def run_chat_turn(
        self,
        db: AsyncSession,
        project_id: UUID,
        history: List[Dict[str, Any]],
        new_user_message: str
    ) -> Dict[str, Any]:
        """
        Executes a multi-turn or tool-assisted chat turn against Gemini,
        gathering context from pgvector hybrid retrieval and project tools.
        """
        # 1. Retrieve initial context using hybrid vector search
        retrieved_contexts = await vector_search_service.search_project(
            db=db,
            project_id=project_id,
            query=new_user_message,
            top_k=5
        )

        # 2. Retrieve project datasets
        ds_res = await db.execute(select(Dataset).where(Dataset.project_id == project_id))
        datasets = ds_res.scalars().all()
        dataset_summaries = []
        for ds in datasets:
            dataset_summaries.append(f"- Dataset: '{ds.name}' ({ds.file_type}, {ds.row_count} rows). Columns: {[c['name'] for c in ds.column_info[:8]]}")

        # Construct grounded context block
        context_blocks = []
        citations_found = []

        for ctx in retrieved_contexts:
            context_blocks.append(
                f"--- EXCERPT FROM PAPER: \"{ctx['paper_title']}\" (Section: {ctx['section']}, Page: {ctx['page']}) ---\n"
                f"{ctx['snippet']}\n"
            )
            citations_found.append({
                "paper_id": str(ctx["paper_id"]),
                "paper_title": ctx["paper_title"],
                "section": ctx["section"],
                "page": ctx["page"],
                "snippet": ctx["snippet"][:200] + "...",
                "score": ctx["score"],
                "data_source": "library"
            })

        if dataset_summaries:
            context_blocks.append("--- AVAILABLE PROJECT DATASETS ---\n" + "\n".join(dataset_summaries))

        grounded_context_str = "\n".join(context_blocks)

        prompt_with_context = f"""{SYSTEM_PROMPT}

PROJECT CONTEXT EXCERPTS:
{grounded_context_str if grounded_context_str else "[No documents found matching this query in the project]"}

PRIOR CONVERSATION:
{self._format_history(history)}

USER QUESTION:
{new_user_message}
"""

        # 3. Call Gemini
        if not settings.GEMINI_API_KEY:
            # Deterministic academic response for offline / initial development
            return self._build_offline_response(new_user_message, citations_found)

        try:
            model_used, _, response = await self._start_generation(prompt_with_context, stream=False)
            content = _response_text(response) or "⚠️ Gemini returned an empty response. Please try rephrasing your question."
            logger.info(f"Chat answered by {model_used}")

            return {
                "role": "assistant",
                "content": content,
                "citations": citations_found,
                "tool_calls": []
            }
        except GeminiUnavailableError as e:
            logger.error(f"Gemini chat unavailable: {e}")
            return {
                "role": "assistant",
                "content": self._unavailable_message(e),
                "citations": [],
                "tool_calls": []
            }
        except Exception as e:
            logger.error(f"Gemini chat API error: {e}")
            return {
                "role": "assistant",
                "content": f"⚠️ Gemini API Error: {e}",
                "citations": citations_found,
                "tool_calls": []
            }

    async def stream_chat_turn(
        self,
        db: AsyncSession,
        project_id: UUID,
        history: List[Dict[str, Any]],
        new_user_message: str
    ) -> AsyncGenerator[str, None]:
        """
        Yields Server-Sent Events (SSE) formatted text deltas and final citations event.
        """
        # Retrieve context
        retrieved_contexts = await vector_search_service.search_project(
            db=db,
            project_id=project_id,
            query=new_user_message,
            top_k=6
        )

        citations = []
        context_blocks = []
        for ctx in retrieved_contexts:
            context_blocks.append(
                f"--- PAPER: \"{ctx['paper_title']}\" (Section: {ctx['section']}, Page: {ctx['page']}) ---\n"
                f"{ctx['snippet']}\n"
            )
            citations.append({
                "paper_id": str(ctx["paper_id"]),
                "paper_title": ctx["paper_title"],
                "section": ctx["section"],
                "page": ctx["page"],
                "snippet": ctx["snippet"][:200] + "...",
                "score": ctx["score"],
                "data_source": "library"
            })

        grounded_context_str = "\n".join(context_blocks)
        prompt_with_context = f"""{SYSTEM_PROMPT}

PROJECT CONTEXT EXCERPTS:
{grounded_context_str if grounded_context_str else "[No documents found matching this query in the project]"}

PRIOR CONVERSATION:
{self._format_history(history)}

USER QUESTION:
{new_user_message}
"""

        if not settings.GEMINI_API_KEY:
            offline = self._build_offline_response(new_user_message, citations)
            yield f"data: {json.dumps({'type': 'token', 'text': offline['content']})}\n\n"
            yield f"data: {json.dumps({'type': 'citations', 'citations': citations})}\n\n"
            yield "data: [DONE]\n\n"
            return

        try:
            model_used, first_chunk, chunks = await self._start_generation(prompt_with_context, stream=True)
            logger.info(f"Chat stream answered by {model_used}")

            first_text = _response_text(first_chunk)
            if first_text:
                yield f"data: {json.dumps({'type': 'token', 'text': first_text})}\n\n"
            async for chunk in chunks:
                chunk_text = _response_text(chunk)
                if chunk_text:
                    yield f"data: {json.dumps({'type': 'token', 'text': chunk_text})}\n\n"

            # Send citations event
            yield f"data: {json.dumps({'type': 'citations', 'citations': citations})}\n\n"
            yield "data: [DONE]\n\n"

        except GeminiUnavailableError as e:
            logger.error(f"Gemini chat unavailable: {e}")
            yield f"data: {json.dumps({'type': 'token', 'text': self._unavailable_message(e)})}\n\n"
            yield f"data: {json.dumps({'type': 'citations', 'citations': []})}\n\n"
            yield "data: [DONE]\n\n"

        except Exception as e:
            logger.error(f"Streaming error with Gemini: {e}")
            error_text = f"\n\n[Error: {e}]"
            yield f"data: {json.dumps({'type': 'token', 'text': error_text})}\n\n"
            yield f"data: {json.dumps({'type': 'citations', 'citations': citations})}\n\n"
            yield "data: [DONE]\n\n"

    def _format_history(self, history: List[Dict[str, Any]], max_messages: int = 10) -> str:
        if not history:
            return "[No prior messages]"
        lines = []
        for msg in history[-max_messages:]:
            speaker = "User" if msg.get("role") == "user" else "Assistant"
            lines.append(f"{speaker}: {msg.get('content', '')}")
        return "\n".join(lines)

    def _build_offline_response(self, query: str, citations: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not citations:
            return {
                "role": "assistant",
                "content": f"The current research library and datasets in this project do not contain sufficient evidence regarding '{query}'. Please upload relevant PDFs to `/library` or datasets to `/data`.",
                "citations": [],
                "tool_calls": []
            }

        top = citations[0]
        content = (
            f"Based on your project's research library:\n\n"
            f"According to **{top['paper_title']}** ([{top['paper_title']}, {top['section']}, p. {top['page']}]):\n\n"
            f"> \"{top['snippet']}\"\n\n"
            f"*(Note: Gemini API key is currently unset in .env. Provide `GEMINI_API_KEY` for live generative synthesis with function calling.)*"
        )
        return {
            "role": "assistant",
            "content": content,
            "citations": citations,
            "tool_calls": []
        }

gemini_chat_agent = GeminiChatAgent()
