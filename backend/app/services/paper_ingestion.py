import asyncio
import uuid
from typing import Dict, Any, Optional
from app.database import AsyncSessionLocal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.paper import Paper, PaperSection, PaperChunk
from app.services.storage_service import storage_service
from app.services.grobid_service import grobid_service
from app.services.fallback_parser import fallback_parser
from app.services.chunking_service import chunking_service
from app.services.embedding_service import embedding_service
import logging

logger = logging.getLogger(__name__)

def _strip_nul(value):
    """Recursively removes NUL characters from parser output."""
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, list):
        return [_strip_nul(v) for v in value]
    if isinstance(value, dict):
        return {k: _strip_nul(v) for k, v in value.items()}
    return value

class PaperIngestionService:
    """
    End-to-end ingestion pipeline:
    Storage -> GROBID / Fallback parsing -> Section mapping -> Chunking -> Embedding -> pgvector.
    """

    async def ingest_paper(
        self,
        db: AsyncSession,
        paper_id: uuid.UUID,
        pdf_bytes: bytes,
        pre_parsed_meta: Optional[Dict[str, Any]] = None
    ) -> Paper:
        # 1. Fetch paper record
        res = await db.execute(select(Paper).where(Paper.id == paper_id))
        paper = res.scalar_one_or_none()
        if not paper:
            raise ValueError(f"Paper {paper_id} not found in database")

        paper.parsing_status = "processing"
        await db.commit()

        try:
            # 2. Attempt GROBID parse
            parsed_data = None
            if await grobid_service.is_alive():
                logger.info(f"GROBID is available. Parsing paper {paper_id}...")
                parsed_data = await grobid_service.process_pdf(pdf_bytes)

            # Fallback if GROBID failed or is offline
            if not parsed_data or not parsed_data.get("sections"):
                logger.info(f"Falling back to PyMuPDF parser for paper {paper_id}")
                parsed_data = fallback_parser.parse_pdf(pdf_bytes)

            # Some PDFs contain NUL characters, which Postgres text columns reject
            parsed_data = _strip_nul(parsed_data)

            # 3. Update Paper Metadata (prefer extracted info if title was default)
            extracted_title = parsed_data.get("title")
            if extracted_title and (paper.title.startswith("paper_") or paper.title == "Untitled Research Paper"):
                paper.title = extracted_title

            if parsed_data.get("authors") and not paper.authors:
                paper.authors = parsed_data["authors"]

            if parsed_data.get("year") and not paper.year:
                paper.year = parsed_data["year"]

            if parsed_data.get("abstract") and not paper.abstract:
                paper.abstract = parsed_data["abstract"]

            if parsed_data.get("page_count"):
                paper.page_count = parsed_data["page_count"]

            paper.paper_metadata = {
                "references": parsed_data.get("references", []),
                "extracted_fields": list(parsed_data.keys())
            }

            # 4. Insert Sections
            raw_sections = parsed_data.get("sections", [])
            section_objects = []
            for s in raw_sections:
                sec_obj = PaperSection(
                    paper_id=paper.id,
                    section_title=s.get("title", "Section"),
                    section_index=s.get("index", 0),
                    start_page=s.get("start_page"),
                    end_page=s.get("end_page"),
                    content=s.get("content", "")
                )
                db.add(sec_obj)
                section_objects.append((sec_obj, s))

            await db.flush() # Populate generated IDs for sections

            # 5. Chunk Sections & Embed
            all_chunks_to_insert = []
            texts_to_embed = []

            for sec_model, s_data in section_objects:
                sec_chunks = chunking_service.chunk_section(
                    section_text=sec_model.content,
                    section_title=sec_model.section_title,
                    page_number=sec_model.start_page
                )
                for chunk in sec_chunks:
                    chunk_entry = {
                        "paper_id": paper.id,
                        "project_id": paper.project_id,
                        "section_id": sec_model.id,
                        "section_title": chunk["section_title"],
                        "page_number": chunk["page_number"],
                        "chunk_index": chunk["chunk_index"],
                        "chunk_text": chunk["chunk_text"],
                        "token_count": chunk["token_count"]
                    }
                    all_chunks_to_insert.append(chunk_entry)
                    texts_to_embed.append(chunk["chunk_text"])

            # 6. Generate Embeddings (batch)
            if texts_to_embed:
                logger.info(f"Generating embeddings for {len(texts_to_embed)} chunks of paper {paper.id}...")
                embeddings = await embedding_service.get_embeddings_batch(texts_to_embed)
                
                for idx, chunk_entry in enumerate(all_chunks_to_insert):
                    chunk_obj = PaperChunk(
                        paper_id=chunk_entry["paper_id"],
                        project_id=chunk_entry["project_id"],
                        section_id=chunk_entry["section_id"],
                        section_title=chunk_entry["section_title"],
                        page_number=chunk_entry["page_number"],
                        chunk_index=chunk_entry["chunk_index"],
                        chunk_text=chunk_entry["chunk_text"],
                        token_count=chunk_entry["token_count"],
                        embedding=embeddings[idx] if idx < len(embeddings) else None
                    )
                    db.add(chunk_obj)

            paper.parsing_status = "completed"
            await db.commit()
            await db.refresh(paper)
            missing = sum(1 for e in (embeddings if texts_to_embed else []) if e is None)
            logger.info(f"Successfully ingested paper {paper.id} with {len(all_chunks_to_insert)} chunks ({missing} awaiting embeddings).")
            if missing:
                # Embedding quota is per minute; try again once it has reset
                asyncio.create_task(self._embed_missing_later(paper.id))
            return paper

        except Exception as e:
            logger.error(f"Paper ingestion failed for {paper_id}: {e}", exc_info=True)
            paper.parsing_status = "failed"
            paper.paper_metadata = {"error": str(e)}
            await db.commit()
            raise

    async def embed_chunks(self, db: AsyncSession, paper_id: uuid.UUID, only_missing: bool = True) -> Dict[str, int]:
        """(Re-)embeds a paper's chunks. only_missing=False also replaces existing vectors."""
        query = select(PaperChunk).where(PaperChunk.paper_id == paper_id).order_by(PaperChunk.chunk_index)
        if only_missing:
            query = query.where(PaperChunk.embedding.is_(None))
        chunks = (await db.execute(query)).scalars().all()
        if not chunks:
            return {"chunks": 0, "embedded": 0}
        embeddings = await embedding_service.get_embeddings_batch([c.chunk_text for c in chunks])
        embedded = 0
        for chunk, emb in zip(chunks, embeddings):
            if emb is not None:
                chunk.embedding = emb
                embedded += 1
        await db.commit()
        logger.info(f"Embedded {embedded}/{len(chunks)} chunks of paper {paper_id}")
        return {"chunks": len(chunks), "embedded": embedded}

    async def resume_incomplete(self) -> None:
        """
        Runs at startup: re-ingests papers left 'pending'/'processing' by a restart mid-import
        (from the stored PDF), then fills in any chunk embeddings that are still missing.
        Papers are handled one at a time so the embedding quota isn't overrun.
        """
        await asyncio.sleep(5)
        try:
            async with AsyncSessionLocal() as db:
                stuck = (await db.execute(select(Paper.id).where(Paper.parsing_status.in_(["pending", "processing"])))).scalars().all()
                missing = (await db.execute(select(PaperChunk.paper_id).where(PaperChunk.embedding.is_(None)).distinct())).scalars().all()
            if stuck or missing:
                logger.info(f"Resuming {len(stuck)} interrupted ingestions and {len(missing)} papers with missing embeddings")
            for paper_id in stuck:
                async with AsyncSessionLocal() as db:
                    paper = await db.get(Paper, paper_id)
                    if not paper:
                        continue
                    try:
                        pdf_bytes = storage_service.download_file(paper.s3_key)
                    except FileNotFoundError:
                        paper.parsing_status = "failed"
                        await db.commit()
                        continue
                    # Clear anything a partial run left behind before starting over
                    for model in (PaperChunk, PaperSection):
                        for row in (await db.execute(select(model).where(model.paper_id == paper_id))).scalars().all():
                            await db.delete(row)
                    await db.commit()
                    try:
                        await self.ingest_paper(db, paper_id, pdf_bytes)
                    except Exception:
                        logger.exception(f"Resumed ingestion failed for paper {paper_id}")
            for paper_id in missing:
                if paper_id in stuck:
                    continue
                async with AsyncSessionLocal() as db:
                    await self.embed_chunks(db, paper_id, only_missing=True)
        except Exception as e:
            logger.warning(f"Resuming incomplete ingestions failed: {e}")

    async def backfill_loop(self, interval_seconds: int = 1200) -> None:
        """
        Periodically embeds chunks that are still missing vectors (e.g. after the daily
        embedding quota ran out), so the library completes itself once the quota resets.
        """
        import time
        while True:
            await asyncio.sleep(interval_seconds)
            if time.time() < embedding_service.paused_until:
                continue
            try:
                async with AsyncSessionLocal() as db:
                    missing = (await db.execute(select(PaperChunk.paper_id).where(PaperChunk.embedding.is_(None)).distinct())).scalars().all()
                for paper_id in missing:
                    if time.time() < embedding_service.paused_until:
                        break
                    async with AsyncSessionLocal() as db:
                        await self.embed_chunks(db, paper_id, only_missing=True)
            except Exception as e:
                logger.warning(f"Embedding backfill pass failed: {e}")

    async def _embed_missing_later(self, paper_id: uuid.UUID, delay_seconds: int = 90) -> None:
        await asyncio.sleep(delay_seconds)
        try:
            async with AsyncSessionLocal() as db:
                await self.embed_chunks(db, paper_id, only_missing=True)
        except Exception as e:
            logger.warning(f"Deferred embedding for paper {paper_id} failed: {e}")

paper_ingestion_service = PaperIngestionService()
