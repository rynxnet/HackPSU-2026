import uuid
from typing import Dict, Any, Optional
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

            paper.metadata = {
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
            logger.info(f"Successfully ingested paper {paper.id} with {len(all_chunks_to_insert)} vector chunks.")
            return paper

        except Exception as e:
            logger.error(f"Paper ingestion failed for {paper_id}: {e}", exc_info=True)
            paper.parsing_status = "failed"
            paper.metadata = {"error": str(e)}
            await db.commit()
            raise

paper_ingestion_service = PaperIngestionService()
