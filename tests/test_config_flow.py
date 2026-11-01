"""Config flow."""

from fritzconnection.core.exceptions import FritzAuthorizationError
from homeassistant.data_entry_flow import FlowResultType, InvalidData
import pytest

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
    await hass.config_entries.async_setup(entry.entry_id)
    result = await entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"host": "192.168.178.2"}
    )

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reconfigure_successful"
    assert entry.data["host"] == "192.168.178.2"
    assert entry.data["password"] == "secret"
    await hass.async_block_till_done()
    await hass.config_entries.async_unload(entry.entry_id)


async def test_reconfigure_refuses_another_box(hass, fake_client, entry):
    fake_client.serial_number = "OTHER"
    result = await entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"host": "192.168.178.2"}
    )

    assert result["reason"] == "wrong_device"
    assert entry.data["host"] == "192.168.178.1"


async def test_user_flow_refuses_a_mesh_repeater(hass, fake_client):
    fake_client.repeater = True
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], USER_INPUT)

    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "mesh_repeater"}


async def test_reauth_refuses_another_box(hass, fake_client, entry):
    entry.add_to_hass(hass)
    fake_client.serial_number = "OTHER"
    result = await entry.start_reauth_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"username": "user", "password": "new"}
    )

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "wrong_device"
    assert entry.data["password"] == "secret"


@pytest.mark.parametrize("port", [0, 65536])
async def test_user_flow_rejects_a_port_out_of_range(hass, fake_client, port):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})

    with pytest.raises(InvalidData):
        await hass.config_entries.flow.async_configure(
            result["flow_id"], {**USER_INPUT, "port": port}
        )


@pytest.mark.parametrize(
    ("error", "key"),
    [(OSError("down"), "cannot_connect"), (ValueError("odd"), "unknown")],
)
async def test_user_flow_reports_other_errors_and_recovers(
    hass, fake_client, monkeypatch, error, key
):
    def _raise():
        raise error

    monkeypatch.setattr(fake_client, "connect", _raise)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], USER_INPUT)
    assert result["errors"] == {"base": key}

    monkeypatch.undo()
    result = await hass.config_entries.flow.async_configure(result["flow_id"], USER_INPUT)
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def test_reauth_updates_the_password(hass, fake_client, entry):
    entry.add_to_hass(hass)
    result = await entry.start_reauth_flow(hass)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"username": "user", "password": "new"}
    )

    assert result["reason"] == "reauth_successful"
    assert entry.data["password"] == "new"


async def test_reauth_and_reconfigure_show_connection_errors(hass, fake_client, entry, monkeypatch):
    entry.add_to_hass(hass)
    monkeypatch.setattr(fake_client, "connect", lambda: (_ for _ in ()).throw(OSError("down")))

    result = await entry.start_reauth_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"username": "user", "password": "new"}
    )
    assert result["errors"] == {"base": "cannot_connect"}

    result = await entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"host": "192.168.178.2"}
    )
    assert result["errors"] == {"base": "cannot_connect"}


async def test_options_flow_saves_and_lists_known_devices(hass, fake_client, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"scan_interval": 60, "filter_mode": "all"}
    )

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options["scan_interval"] == 60
    await hass.async_block_till_done()
    await hass.config_entries.async_unload(entry.entry_id)
