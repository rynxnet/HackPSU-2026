import re
import httpx
from bs4 import BeautifulSoup
from typing import Dict, Any, Optional, Tuple
import logging

logger = logging.getLogger(__name__)

class DoiArxivService:
    """
    Resolves academic identifiers (DOI, arXiv ID) to metadata and full-text PDF bytes.
    """

    ARXIV_REGEX = re.compile(r'(?:arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)', re.IGNORECASE)
    DOI_REGEX = re.compile(r'10\.\d{4,9}/[-._;()/:A-Z0-9]+', re.IGNORECASE)

    async def resolve_identifier(self, identifier: str) -> Tuple[Optional[Dict[str, Any]], Optional[bytes]]:
        identifier = identifier.strip()

        # Check arXiv
        arxiv_match = self.ARXIV_REGEX.search(identifier)
        if arxiv_match or "arxiv.org" in identifier.lower():
            clean_id = arxiv_match.group(1) if arxiv_match else identifier.split("/")[-1].replace(".pdf", "")
            return await self._fetch_arxiv(clean_id)

        # Check DOI
        doi_match = self.DOI_REGEX.search(identifier)
        if doi_match:
            clean_doi = doi_match.group(0)
            return await self._fetch_doi(clean_doi)

        # If neither matches cleanly, attempt direct URL or fallback
        if identifier.startswith("http"):
            return await self._fetch_direct_url(identifier)

        return None, None

    async def _fetch_arxiv(self, arxiv_id: str) -> Tuple[Optional[Dict[str, Any]], Optional[bytes]]:
        api_url = f"http://export.arxiv.org/api/query?id_list={arxiv_id}"
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"

        metadata = {
            "arxiv_id": arxiv_id,
            "doi": None,
            "title": f"arXiv Paper {arxiv_id}",
            "authors": [],
            "year": None,
            "abstract": ""
        }

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            try:
                # 1. Fetch metadata via arXiv Atom API
                res_meta = await client.get(api_url)
                if res_meta.status_code == 200:
                    soup = BeautifulSoup(res_meta.text, "xml")
                    entry = soup.find("entry")
                    if entry:
                        title_el = entry.find("title")
                        if title_el:
                            metadata["title"] = " ".join(title_el.get_text().split())
                        
                        summary_el = entry.find("summary")
                        if summary_el:
                            metadata["abstract"] = " ".join(summary_el.get_text().split())

                        published_el = entry.find("published")
                        if published_el and published_el.text:
                            metadata["year"] = int(published_el.text[:4])

                        authors = []
                        for author_el in entry.find_all("author"):
                            name_el = author_el.find("name")
                            if name_el:
                                authors.append({"name": name_el.get_text().strip()})
                        metadata["authors"] = authors

                        # Check for DOI
                        doi_el = entry.find("arxiv:doi")
                        if doi_el:
                            metadata["doi"] = doi_el.get_text().strip()
            except Exception as e:
                logger.warning(f"Failed to fetch arXiv metadata for {arxiv_id}: {e}")

            # 2. Download PDF bytes
            try:
                headers = {"User-Agent": "ResearchIDE/1.0 (academic-research-tool)"}
                res_pdf = await client.get(pdf_url, headers=headers)
                if res_pdf.status_code == 200 and len(res_pdf.content) > 1000:
                    return metadata, res_pdf.content
                else:
                    logger.warning(f"Could not download arXiv PDF from {pdf_url}: status {res_pdf.status_code}")
            except Exception as e:
                logger.error(f"Error downloading arXiv PDF {arxiv_id}: {e}")

        return metadata, None

    async def _fetch_doi(self, doi: str) -> Tuple[Optional[Dict[str, Any]], Optional[bytes]]:
        crossref_url = f"https://api.crossref.org/works/{doi}"
        metadata = {
            "doi": doi,
            "arxiv_id": None,
            "title": f"Paper DOI: {doi}",
            "authors": [],
            "year": None,
            "abstract": ""
        }
        pdf_bytes = None

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            try:
                res = await client.get(crossref_url, headers={"User-Agent": "ResearchIDE/1.0 (mailto:dev@researchide.org)"})
                if res.status_code == 200:
                    data = res.json().get("message", {})
                    metadata["title"] = data.get("title", [metadata["title"]])[0]
                    
                    if "published-print" in data:
                        metadata["year"] = data["published-print"]["date-parts"][0][0]
                    elif "published-online" in data:
                        metadata["year"] = data["published-online"]["date-parts"][0][0]

                    authors = []
                    for author in data.get("author", []):
                        name = f"{author.get('given', '')} {author.get('family', '')}".strip()
                        if name:
                            authors.append({"name": name, "affiliation": author.get("affiliation", [])})
                    metadata["authors"] = authors

                    if data.get("abstract"):
                        # Clean JATS XML from CrossRef abstract
                        clean_abs = re.sub(r'<[^>]+>', '', data["abstract"]).strip()
                        metadata["abstract"] = clean_abs

                    # Try to locate open-access link
                    link_candidates = data.get("link", [])
                    for link in link_candidates:
                        if link.get("content-type") == "application/pdf":
                            try:
                                pdf_res = await client.get(link["URL"])
                                if pdf_res.status_code == 200 and len(pdf_res.content) > 1000:
                                    pdf_bytes = pdf_res.content
                                    break
                            except Exception:
                                pass
            except Exception as e:
                logger.error(f"CrossRef lookup failed for {doi}: {e}")

        return metadata, pdf_bytes

    async def _fetch_direct_url(self, url: str) -> Tuple[Optional[Dict[str, Any]], Optional[bytes]]:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            try:
                res = await client.get(url)
                if res.status_code == 200 and "application/pdf" in res.headers.get("content-type", ""):
                    meta = {
                        "title": url.split("/")[-1].replace(".pdf", ""),
                        "authors": [],
                        "year": None,
                        "abstract": ""
                    }
                    return meta, res.content
            except Exception as e:
                logger.error(f"Direct URL download failed: {e}")
        return None, None

doi_arxiv_service = DoiArxivService()
