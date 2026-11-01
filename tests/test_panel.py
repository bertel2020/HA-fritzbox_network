"""The sidebar panel is registered once, for administrators, and goes with the last box."""

from unittest.mock import AsyncMock, MagicMock

from homeassistant.components import frontend, panel_custom

from custom_components.fritzbox_network import panel


async def test_the_panel_is_registered_once_for_administrators(hass, monkeypatch):
    hass.data[panel.KEY_BASE_URL] = "/fritzbox_network_static/abc12345"
    register = AsyncMock()
    monkeypatch.setattr(panel_custom, "async_register_panel", register)

    await panel.async_ensure_panel(hass)

    register.assert_awaited_once()
    kwargs = register.await_args.kwargs
    assert kwargs["frontend_url_path"] == panel.PANEL_PATH
    assert kwargs["webcomponent_name"] == panel.PANEL_ELEMENT
    assert kwargs["require_admin"] is True
    assert kwargs["module_url"] == "/fritzbox_network_static/abc12345/fritzbox-network-panel.js"

    hass.data[frontend.DATA_PANELS] = {panel.PANEL_PATH: object()}
    await panel.async_ensure_panel(hass)
    register.assert_awaited_once()


async def test_without_a_frontend_there_is_no_panel(hass, monkeypatch):
    register = AsyncMock()
    monkeypatch.setattr(panel_custom, "async_register_panel", register)

    await panel.async_serve_frontend(hass)
    await panel.async_ensure_panel(hass)

    register.assert_not_awaited()
    assert panel.KEY_BASE_URL not in hass.data


async def test_the_panel_goes_with_the_last_box(hass, monkeypatch):
    remove = MagicMock()
    monkeypatch.setattr(frontend, "async_remove_panel", remove)
    hass.data[panel.KEY_BASE_URL] = "/fritzbox_network_static/abc12345"

    panel.async_drop_panel(hass)
    remove.assert_not_called()  # it was never shown

    hass.data[frontend.DATA_PANELS] = {panel.PANEL_PATH: object()}
    panel.async_drop_panel(hass)
    remove.assert_called_once_with(hass, panel.PANEL_PATH)
