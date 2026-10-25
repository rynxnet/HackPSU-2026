import io
import re
import logging
from typing import Any, Dict, List

import pandas as pd
import matplotlib
matplotlib.use("Agg") # headless rendering inside the container
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator

from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

CHART_TYPES = ("line", "bar", "scatter", "histogram")

def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug[:60] or "figure"

def load_dataframe(s3_key: str, file_type: str) -> pd.DataFrame:
    buf = io.BytesIO(storage_service.download_file(s3_key))
    if file_type == "parquet":
        return pd.read_parquet(buf)
    if file_type == "tsv":
        return pd.read_csv(buf, sep="\t")
    return pd.read_csv(buf)

def validate_spec(spec: Dict[str, Any], columns: List[str]) -> Dict[str, Any]:
    chart = spec.get("chart", "line")
    if chart not in CHART_TYPES:
        raise ValueError(f"Unknown chart type '{chart}'. Use one of: {', '.join(CHART_TYPES)}")
    x = spec.get("x")
    if x not in columns:
        raise ValueError(f"Column '{x}' is not in the dataset")
    y = spec.get("y") or []
    if isinstance(y, str):
        y = [y]
    if chart != "histogram":
        if not y:
            raise ValueError("Pick at least one Y column")
        missing = [c for c in y if c not in columns]
        if missing:
            raise ValueError(f"Columns not in the dataset: {', '.join(missing)}")
    return {
        "chart": chart,
        "x": x,
        "y": y if chart != "histogram" else [],
        "title": spec.get("title") or "",
        "xlabel": spec.get("xlabel") or x,
        "ylabel": spec.get("ylabel") or (", ".join(y) if chart != "histogram" else "Count"),
    }

async def render_figure(fig, dataset) -> None:
    """Re-renders a Figure from its dataset's current file. Records the error on the figure instead of raising."""
    import asyncio
    try:
        df = await asyncio.to_thread(load_dataframe, dataset.s3_key, dataset.file_type)
        spec = validate_spec(fig.spec or {}, [str(c) for c in df.columns])
        png = await asyncio.to_thread(render_png, df, spec)
        key = f"figures/{fig.project_id}/{fig.id}.png"
        storage_service.upload_bytes(png, key, content_type="image/png")
        fig.s3_key = key
        fig.spec = spec
        fig.render_error = None
    except Exception as e:
        logger.warning(f"Rendering figure {fig.id} failed: {e}")
        fig.render_error = str(e)
    fig.version = (fig.version or 0) + 1


def render_png(df: pd.DataFrame, spec: Dict[str, Any]) -> bytes:
    """Renders a publication-style chart (white background, 300 dpi) and returns PNG bytes."""
    chart, x, ys = spec["chart"], spec["x"], spec["y"]
    fig, ax = plt.subplots(figsize=(6.4, 4.0), dpi=300)
    try:
        if chart == "histogram":
            ax.hist(pd.to_numeric(df[x], errors="coerce").dropna(), bins=20, color="#4C72B0", edgecolor="white")
        elif chart == "bar":
            # Average repeated x values so each category gets one bar per series
            grouped = df.groupby(x, sort=False)[ys].mean(numeric_only=True)
            grouped.plot(kind="bar", ax=ax, rot=0, legend=False, width=0.75)
            # Tilt category labels when they would collide (many bars or long names)
            label_chars = sum(len(str(v)) for v in grouped.index)
            if len(grouped) > 8 or label_chars > 55:
                plt.setp(ax.get_xticklabels(), rotation=30, ha="right", rotation_mode="anchor")
        elif chart == "scatter":
            for y in ys:
                ax.scatter(df[x], df[y], s=14, alpha=0.8, label=y)
        else:
            data = df.sort_values(x) if pd.api.types.is_numeric_dtype(df[x]) or pd.api.types.is_datetime64_any_dtype(df[x]) else df
            for y in ys:
                ax.plot(data[x], data[y], marker="o" if len(data) <= 30 else None, markersize=3, linewidth=1.5, label=y)

        if len(ys) > 1:
            # Legend beside the plot so it never covers data
            ax.legend(frameon=False, loc="upper left", bbox_to_anchor=(1.01, 1.0), fontsize=8)
        # Counts and other whole-number series shouldn't get fractional ticks
        plotted = [x] if chart == "histogram" else ys
        values = pd.concat([pd.to_numeric(df[c], errors="coerce") for c in plotted]).dropna()
        if chart == "histogram" or (len(values) and (values % 1 == 0).all()):
            ax.yaxis.set_major_locator(MaxNLocator(integer=True))

        if spec.get("title"):
            ax.set_title(spec["title"], fontsize=11)
        ax.set_xlabel(spec.get("xlabel") or x, fontsize=10)
        ax.set_ylabel(spec.get("ylabel") or "", fontsize=10)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.grid(axis="y", alpha=0.25)
        fig.tight_layout()

        out = io.BytesIO()
        fig.savefig(out, format="png", facecolor="white")
        return out.getvalue()
    finally:
        plt.close(fig)
