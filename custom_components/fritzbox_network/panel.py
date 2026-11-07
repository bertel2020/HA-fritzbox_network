"""Serves the frontend of the integration: the dashboard cards and the sidebar panel.

The files are served under a URL that carries a hash of all of them. A change in any file gives
every file a new URL, so the browser never mixes old and new parts, and the files can be cached
for good.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN

FRONTEND_DIR = Path(__file__).parent / "frontend"
BRAND_DIR = Path(__file__).parent / "brand"
STATIC_ROOT = f"/{DOMAIN}_static"
CARD_FILE = FRONTEND_DIR / "fritzbox-network-topology-card.js"
PANEL_FILE = FRONTEND_DIR / "fritzbox-network-panel.js"
PANEL_PATH = "fritzbox-network"
PANEL_ELEMENT = "fritzbox-network-panel"
# where the files are served from, once registered (it carries the hash)
KEY_BASE_URL = f"{DOMAIN}_frontend_base_url"


def frontend_version() -> str:
    """Hash of all frontend files: a change in any of them gives a new URL."""
    digest = hashlib.sha256()
    for path in sorted(FRONTEND_DIR.glob("*.js")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    if (icon := BRAND_DIR / "icon.png").is_file():
        digest.update(icon.read_bytes())
    return digest.hexdigest()[:8]


async def async_serve_frontend(hass: HomeAssistant) -> None:
    """Serve the frontend files and load the dashboard cards in the frontend.

    Skipped where there is no frontend (tests, headless installs).
    """
    if getattr(hass, "http", None) is None or "frontend" not in hass.config.components:
        return
    from homeassistant.components.frontend import add_extra_js_url  # noqa: PLC0415
    from homeassistant.components.http import StaticPathConfig  # noqa: PLC0415

    base = f"{STATIC_ROOT}/{await hass.async_add_executor_job(frontend_version)}"
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(base, str(FRONTEND_DIR), True),
            # the logo in the header of the panel, next to the scripts that load it
            StaticPathConfig(f"{base}/brand", str(BRAND_DIR), True),
        ]
    )
    add_extra_js_url(hass, f"{base}/{CARD_FILE.name}")
    hass.data[KEY_BASE_URL] = base


async def async_ensure_panel(hass: HomeAssistant) -> None:
    """Show the sidebar panel (administrators only), once however many boxes there are."""
    base = hass.data.get(KEY_BASE_URL)
    if base is None:
        return
    from homeassistant.components import panel_custom  # noqa: PLC0415
    from homeassistant.components.frontend import DATA_PANELS  # noqa: PLC0415

    if PANEL_PATH in hass.data.get(DATA_PANELS, {}):
        return
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_PATH,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title="FRITZ!Box",
        sidebar_icon="mdi:lan",
        module_url=f"{base}/{PANEL_FILE.name}",
        require_admin=True,
    )


@callback
def async_drop_panel(hass: HomeAssistant) -> None:
    """Take the sidebar panel away when the last box is gone."""
    if hass.data.get(KEY_BASE_URL) is None:
        return
    from homeassistant.components import frontend  # noqa: PLC0415

    if PANEL_PATH in hass.data.get(frontend.DATA_PANELS, {}):
        frontend.async_remove_panel(hass, PANEL_PATH)
