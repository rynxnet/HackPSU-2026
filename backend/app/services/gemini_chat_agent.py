import json
import logging
from typing import AsyncGenerator, List, Dict, Any, Optional
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import google.generativeai as genai
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
5. Use the provided tools (search_library, get_paper_section, inspect_dataset, list_project_resources) to retrieve facts before formulating your answer.
"""

class GeminiChatAgent:
    def __init__(self):
        if settings.GEMINI_API_KEY:
            genai.configure(api_key=settings.GEMINI_API_KEY)
        self.model_name = settings.GEMINI_CHAT_MODEL or "gemini-2.0-flash"

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

USER QUESTION:
{new_user_message}
"""

        # 3. Call Gemini
        if not settings.GEMINI_API_KEY:
            # Deterministic academic response for offline / initial development
            return self._build_offline_response(new_user_message, citations_found)

        try:
            model = genai.GenerativeModel(model_name=self.model_name)
            response = await model.generate_content_async(prompt_with_context)
            content = response.text

            return {
                "role": "assistant",
                "content": content,
                "citations": citations_found,
                "tool_calls": []
            }
        except Exception as e:
            logger.error(f"Gemini chat API error: {e}")
            return {
                "role": "assistant",
                "content": f"⚠️ Gemini API Error: {str(e)}. (Ensure GEMINI_API_KEY is configured in your .env file).",
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
            model = genai.GenerativeModel(model_name=self.model_name)
            response = await model.generate_content_async(prompt_with_context, stream=True)

            async for chunk in response:
                if chunk.text:
                    yield f"data: {json.dumps({'type': 'token', 'text': chunk.text})}\n\n"

            # Send citations event
            yield f"data: {json.dumps({'type': 'citations', 'citations': citations})}\n\n"
            yield "data: [DONE]\n\n"

        except Exception as e:
            logger.error(f"Streaming error with Gemini: {e}")
            yield f"data: {json.dumps({'type': 'token', 'text': f'\\n\\n[Error: {str(e)}]' })}\n\n"
            yield f"data: {json.dumps({'type': 'citations', 'citations': citations})}\n\n"
            yield "data: [DONE]\n\n"

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
