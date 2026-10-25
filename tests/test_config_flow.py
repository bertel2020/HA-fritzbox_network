"""Config flow."""

from fritzconnection.core.exceptions import FritzAuthorizationError
from homeassistant.data_entry_flow import FlowResultType

from custom_components.fritzbox_network.const import DOMAIN

USER_INPUT = {"host": "192.168.178.1", "username": "user", "password": "secret"}


async def test_user_flow_creates_entry(hass, fake_client):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], USER_INPUT)

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "FRITZ!Box 7590 AX (192.168.178.1)"
    assert result["result"].unique_id == "SERIAL1"


async def test_user_flow_wrong_password(hass, fake_client, monkeypatch):
    def _raise():
        raise FritzAuthorizationError("401")

    monkeypatch.setattr(fake_client, "connect", _raise)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], USER_INPUT)

    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "invalid_auth"}


async def test_user_flow_already_configured(hass, fake_client, entry):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], USER_INPUT)

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_reconfigure_changes_the_host(hass, fake_client, entry):
    result = await entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"host": "192.168.178.2"}
    )

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reconfigure_successful"
    assert entry.data["host"] == "192.168.178.2"
    assert entry.data["password"] == "secret"


async def test_reconfigure_refuses_another_box(hass, fake_client, entry):
    fake_client.serial_number = "OTHER"
    result = await entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"host": "192.168.178.2"}
    )

    assert result["reason"] == "wrong_device"
    assert entry.data["host"] == "192.168.178.1"
