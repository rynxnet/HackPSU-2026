import httpx
from bs4 import BeautifulSoup
from typing import Dict, Any, List, Optional
import logging
from app.config import settings

logger = logging.getLogger(__name__)

class GrobidService:
    def __init__(self, base_url: Optional[str] = None):
        self.base_url = (base_url or settings.GROBID_URL).rstrip("/")
        self.timeout = settings.GROBID_TIMEOUT_SECONDS

    async def is_alive(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(f"{self.base_url}/api/isalive")
                return res.status_code == 200
        except Exception:
            return False

    async def process_pdf(self, pdf_bytes: bytes) -> Optional[Dict[str, Any]]:
        """
        Sends PDF to GROBID /api/processFulltextDocument and extracts TEI-XML structure.
        """
        url = f"{self.base_url}/api/processFulltextDocument"
        files = {
            "input": ("paper.pdf", pdf_bytes, "application/pdf")
        }
        data = {
            "generateIDs": "1",
            "consolidateHeader": "1",
            "consolidateCitations": "0",
            "includeRawAffiliations": "1"
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.post(url, files=files, data=data)
                if res.status_code != 200:
                    logger.warning(f"GROBID responded with status code {res.status_code}")
                    return None
                
                tei_xml = res.text
                return self.parse_tei_xml(tei_xml)
        except Exception as e:
            logger.error(f"GROBID extraction failed or timed out: {e}")
            return None

    def parse_tei_xml(self, xml_content: str) -> Dict[str, Any]:
        soup = BeautifulSoup(xml_content, "xml")

        # Extract Title
        title_tag = soup.find("title", attrs={"type": "main"})
        title = title_tag.get_text(strip=True) if title_tag else "Untitled Academic Paper"

        # Extract Authors
        authors: List[Dict[str, Any]] = []
        for author_tag in soup.find_all("author"):
            pers_name = author_tag.find("persName")
            if pers_name:
                forenames = [fn.get_text(strip=True) for fn in pers_name.find_all("forename")]
                surname_tag = pers_name.find("surname")
                surname = surname_tag.get_text(strip=True) if surname_tag else ""
                full_name = f"{' '.join(forenames)} {surname}".strip()
                
                aff_tag = author_tag.find("affiliation")
                affiliation = aff_tag.get_text(strip=True) if aff_tag else ""

                if full_name:
                    authors.append({"name": full_name, "affiliation": affiliation})

        # Extract Publication Year
        year = None
        date_tag = soup.find("date", attrs={"type": "published"})
        if date_tag and date_tag.get("when"):
            try:
                year = int(date_tag["when"][:4])
            except (ValueError, IndexError):
                pass

        # Extract Abstract
        abstract = ""
        abstract_tag = soup.find("abstract")
        if abstract_tag:
            abstract = " ".join([p.get_text(strip=True) for p in abstract_tag.find_all("p")])

        # Extract Sections
        sections: List[Dict[str, Any]] = []
        body = soup.find("body")
        if body:
            div_tags = body.find_all("div")
            for idx, div in enumerate(div_tags):
                head = div.find("head")
                head_text = head.get_text(strip=True) if head else f"Section {idx + 1}"
                paragraphs = [p.get_text(strip=True) for p in div.find_all("p") if p.get_text(strip=True)]
                content = "\n\n".join(paragraphs)
                if content:
                    sections.append({
                        "title": head_text,
                        "index": idx,
                        "content": content
                    })

        # Extract References
        references: List[str] = []
        for bibl in soup.find_all("biblStruct"):
            ref_title = bibl.find("title", attrs={"type": "main"}) or bibl.find("title")
            if ref_title:
                references.append(ref_title.get_text(strip=True))

        return {
            "title": title,
            "authors": authors,
            "year": year,
            "abstract": abstract,
            "sections": sections,
            "references": references[:100],
            "raw_tei": xml_content[:5000] # preview
        }

grobid_service = GrobidService()
