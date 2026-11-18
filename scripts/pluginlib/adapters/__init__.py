"""Host projections and compatibility reports."""

from .base import compatibility_report
from .claude import render_marketplace as render_claude_marketplace
from .openai import render_marketplace as render_openai_marketplace
from .perplexity import build_archive, validate_archive

__all__ = [
    "build_archive",
    "compatibility_report",
    "render_claude_marketplace",
    "render_openai_marketplace",
    "validate_archive",
]
