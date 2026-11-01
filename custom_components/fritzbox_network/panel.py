"""Serves the frontend of the integration: the dashboard cards and, later, the sidebar panel.

The files are served under a URL that carries a hash of all of them. A change in any file gives
every file a new URL, so the browser never mixes old and new parts, and the files can be cached
for good.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from .const import DOMAIN

FRONTEND_DIR = Path(__file__).parent / "frontend"
STATIC_ROOT = f"/{DOMAIN}_static"
CARD_FILE = FRONTEND_DIR / "fritzbox-network-topology-card.js"


def frontend_version() -> str:
    """Hash of all frontend files: a change in any of them gives a new URL."""
    digest = hashlib.sha256()
    for path in sorted(FRONTEND_DIR.glob("*.js")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()[:8]
