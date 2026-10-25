import io
import math
import pandas as pd
from typing import Dict, Any, List, Optional
from app.services.storage_service import storage_service
import logging

logger = logging.getLogger(__name__)

class DatasetService:
    """
    Parses and manages research datasets (CSV, Parquet, TSV).
    Extracts column schemas, summary statistics, and provides preview/query tools.
    """

    def analyze_dataset_file(self, file_bytes: bytes, filename: str) -> Dict[str, Any]:
        ext = filename.split(".")[-1].lower()
        buf = io.BytesIO(file_bytes)

        try:
            if ext == "parquet":
                df = pd.read_parquet(buf)
            elif ext == "tsv":
                df = pd.read_csv(buf, sep="\t", nrows=100000)
            else: # Default CSV
                df = pd.read_csv(buf, nrows=100000)
        except Exception as e:
            logger.error(f"Failed to parse dataset {filename}: {e}")
            raise ValueError(f"Unable to parse dataset: {e}")

        row_count = len(df)
        col_count = len(df.columns)

        column_info: List[Dict[str, Any]] = []
        for col in df.columns:
            dtype_str = str(df[col].dtype)
            sample_vals = df[col].dropna().head(3).tolist()
            # Convert non-serializable types to strings
            sample_vals = [str(v) if not isinstance(v, (int, float, bool, str)) else v for v in sample_vals]
            
            column_info.append({
                "name": str(col),
                "type": dtype_str,
                "null_count": int(df[col].isnull().sum()),
                "sample_values": sample_vals
            })

        # Summary statistics
        summary_stats = {}
        try:
            desc = df.describe().to_dict()
            # Empty numeric columns produce NaN, which isn't valid JSON for the JSONB column
            summary_stats = {
                str(k): {stat: (None if isinstance(val, float) and not math.isfinite(val) else round(val, 4) if isinstance(val, float) else val)
                         for stat, val in v.items()}
                for k, v in desc.items()
            }
        except Exception:
            pass

        return {
            "file_type": ext,
            "row_count": row_count,
            "column_count": col_count,
            "column_info": column_info,
            "summary_stats": summary_stats
        }

    def get_preview(self, s3_key: str, file_type: str, page: int = 1, page_size: int = 50) -> Dict[str, Any]:
        data = storage_service.download_file(s3_key)
        buf = io.BytesIO(data)

        if file_type == "parquet":
            df = pd.read_parquet(buf)
        elif file_type == "tsv":
            df = pd.read_csv(buf, sep="\t")
        else:
            df = pd.read_csv(buf)

        total_rows = len(df)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        slice_df = df.iloc[start_idx:end_idx]

        # Clean NaN/Inf for JSON compliance
        slice_df = slice_df.fillna("None")

        return {
            "columns": list(df.columns),
            "rows": slice_df.to_dict(orient="records"),
            "total_rows": total_rows,
            "page": page,
            "page_size": page_size
        }

    def query_dataset_summary(self, s3_key: str, file_type: str, query_description: str) -> str:
        """
        Executes a basic aggregation or inspection on dataset for the AI chat agent.
        """
        try:
            data = storage_service.download_file(s3_key)
            buf = io.BytesIO(data)
            df = pd.read_parquet(buf) if file_type == "parquet" else pd.read_csv(buf)

            head_text = df.head(5).to_string()
            info_text = f"Shape: {df.shape[0]} rows, {df.shape[1]} columns.\nColumns: {list(df.columns)}\nPreview:\n{head_text}"
            return info_text
        except Exception as e:
            return f"Error querying dataset: {e}"

dataset_service = DatasetService()
