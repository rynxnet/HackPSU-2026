import io
import re
import fitz # PyMuPDF
from typing import Dict, Any, List
import logging

logger = logging.getLogger(__name__)

class FallbackPdfParser:
    """
    Structured academic PDF fallback parser using PyMuPDF.
    Detects title, font-based headings, sections, page boundaries, and abstract.
    """

    def parse_pdf(self, pdf_bytes: bytes) -> Dict[str, Any]:
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        except Exception as e:
            logger.error(f"PyMuPDF failed to open document: {e}")
            return {
                "title": "Document Parsing Failed",
                "authors": [],
                "year": None,
                "abstract": "",
                "sections": [],
                "references": []
            }

        page_count = len(doc)
        full_text_blocks = []
        raw_text_per_page = []

        for page_idx in range(page_count):
            page = doc[page_idx]
            raw_text_per_page.append(page.get_text())
            blocks = page.get_text("blocks") # (x0, y0, x1, y1, text, block_no, block_type)
            for b in blocks:
                if b[4].strip():
                    full_text_blocks.append({
                        "page": page_idx + 1,
                        "text": b[4].strip(),
                        "bbox": (b[0], b[1], b[2], b[3])
                    })

        # Heuristic 1: Title from first page top prominent block
        title = "Untitled Research Paper"
        if full_text_blocks:
            first_page_blocks = [b for b in full_text_blocks if b["page"] == 1]
            if first_page_blocks:
                title = first_page_blocks[0]["text"].replace("\n", " ")

        # Heuristic 2: Abstract extraction
        full_text = "\n".join(raw_text_per_page)
        abstract = ""
        abstract_match = re.search(r'(?:Abstract|ABSTRACT)[\s:—–-]+(.*?)(?:1[\.\s]|I[\.\s]|Introduction|Index Terms|Categories and Subject Descriptors)', full_text, re.DOTALL | re.IGNORECASE)
        if abstract_match:
            abstract = abstract_match.group(1).strip()
            # Clean up line wraps
            abstract = re.sub(r'\s+', ' ', abstract)[:2000]

        # Heuristic 3: Identify sections by numbered headings or common academic keywords
        section_pattern = re.compile(
            r'^(?:(?:\d+|[IVXLCDM]+)[\.\s]+[A-Z][\w\s-]{2,40}|Introduction|Related Work|Background|Methodology|Methods|System Architecture|Experiments|Evaluation|Results|Discussion|Conclusion|References)$',
            re.MULTILINE
        )

        sections: List[Dict[str, Any]] = []
        current_section_title = "Introduction"
        current_section_text: List[str] = []
        current_start_page = 1
        current_page = 1

        for b in full_text_blocks:
            text = b["text"]
            lines = text.split("\n")
            first_line = lines[0].strip()
            
            if section_pattern.match(first_line) or (len(lines) == 1 and len(first_line) < 50 and first_line.isupper() and len(first_line) > 3):
                # Flush previous section
                if current_section_text:
                    sections.append({
                        "title": current_section_title,
                        "index": len(sections),
                        "start_page": current_start_page,
                        "end_page": current_page,
                        "content": "\n\n".join(current_section_text)
                    })
                    current_section_text = []

                current_section_title = first_line
                current_start_page = b["page"]
                # Append rest of lines in this block if any
                if len(lines) > 1:
                    current_section_text.append("\n".join(lines[1:]))
            else:
                current_section_text.append(text)
            
            current_page = b["page"]

        # Flush last section
        if current_section_text:
            sections.append({
                "title": current_section_title,
                "index": len(sections),
                "start_page": current_start_page,
                "end_page": current_page,
                "content": "\n\n".join(current_section_text)
            })

        # If no sections could be demarcated, chunk by pages
        if not sections or (len(sections) == 1 and len(sections[0]["content"]) < 100):
            sections = []
            for page_idx, page_text in enumerate(raw_text_per_page):
                if page_text.strip():
                    sections.append({
                        "title": f"Page {page_idx + 1}",
                        "index": page_idx,
                        "start_page": page_idx + 1,
                        "end_page": page_idx + 1,
                        "content": page_text.strip()
                    })

        return {
            "title": title[:500],
            "authors": [],
            "year": None,
            "abstract": abstract,
            "sections": sections,
            "references": [],
            "page_count": page_count
        }

fallback_parser = FallbackPdfParser()
