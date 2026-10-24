import re
from typing import List, Dict, Any, Optional

class ChunkingService:
    """
    Section-aware chunker that splits academic paper sections into ~500-800 token chunks
    with 100-token sliding window overlap, preserving sentence boundaries and section context.
    """

    def __init__(self, target_tokens: int = 650, max_tokens: int = 800, overlap_tokens: int = 100):
        self.target_tokens = target_tokens
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens

    def estimate_tokens(self, text: str) -> int:
        # 1 token is roughly 4 characters or 0.75 words in academic English
        return max(1, int(len(text) / 3.8))

    def split_into_sentences(self, text: str) -> List[str]:
        # Split on sentence terminals while keeping punctuation
        sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z0-9])', text)
        return [s.strip() for s in sentences if s.strip()]

    def chunk_section(
        self,
        section_text: str,
        section_title: str,
        page_number: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        if not section_text.strip():
            return []

        sentences = self.split_into_sentences(section_text)
        if not sentences:
            sentences = [section_text]

        chunks: List[Dict[str, Any]] = []
        current_sentences: List[str] = []
        current_tokens = 0

        for sentence in sentences:
            sent_tokens = self.estimate_tokens(sentence)

            # If a single sentence is massive, split it by words
            if sent_tokens > self.max_tokens:
                words = sentence.split()
                sub_sentence = ""
                for word in words:
                    sub_sentence += word + " "
                    if self.estimate_tokens(sub_sentence) >= self.target_tokens:
                        current_sentences.append(sub_sentence.strip())
                        chunk_content = " ".join(current_sentences)
                        chunks.append({
                            "chunk_text": f"[{section_title}]\n{chunk_content}",
                            "token_count": self.estimate_tokens(chunk_content),
                            "section_title": section_title,
                            "page_number": page_number
                        })
                        current_sentences = []
                        sub_sentence = ""
                if sub_sentence:
                    current_sentences.append(sub_sentence.strip())
                continue

            if current_tokens + sent_tokens > self.max_tokens and current_sentences:
                # Flush current chunk
                chunk_content = " ".join(current_sentences)
                chunks.append({
                    "chunk_text": f"[{section_title}]\n{chunk_content}",
                    "token_count": self.estimate_tokens(chunk_content),
                    "section_title": section_title,
                    "page_number": page_number
                })

                # Calculate overlap: retain the trailing sentences that roughly sum to overlap_tokens
                overlap_collector: List[str] = []
                acc_tokens = 0
                for sent in reversed(current_sentences):
                    acc_tokens += self.estimate_tokens(sent)
                    overlap_collector.insert(0, sent)
                    if acc_tokens >= self.overlap_tokens:
                        break

                current_sentences = list(overlap_collector)
                current_tokens = acc_tokens

            current_sentences.append(sentence)
            current_tokens += sent_tokens

        # Flush final remaining sentences
        if current_sentences:
            chunk_content = " ".join(current_sentences)
            chunks.append({
                "chunk_text": f"[{section_title}]\n{chunk_content}",
                "token_count": self.estimate_tokens(chunk_content),
                "section_title": section_title,
                "page_number": page_number
            })

        # Add index
        for idx, chunk in enumerate(chunks):
            chunk["chunk_index"] = idx

        return chunks

chunking_service = ChunkingService()
