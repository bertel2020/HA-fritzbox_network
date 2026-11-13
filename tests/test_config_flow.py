"""Config flow."""

from fritzconnection.core.exceptions import FritzAuthorizationError
from homeassistant.data_entry_flow import FlowResultType, InvalidData
from homeassistant.helpers.service_info.ssdp import SsdpServiceInfo
import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

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
    # the entry reloads in the background; do not leave that to the teardown
    await hass.async_block_till_done()


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


def _ssdp(
    host="192.168.178.1", udn="uuid:a1b2c3d4-0000-0000-0000-02000000cc01", model="FRITZ!Box 7590 AX"
):
    return SsdpServiceInfo(
        ssdp_usn=f"{udn}::urn:schemas-upnp-org:device:fritzbox:1",
        ssdp_st="urn:schemas-upnp-org:device:fritzbox:1",
        ssdp_location=f"http://{host}:49000/tr64desc.xml",
        upnp={"friendlyName": model, "modelName": model, "UDN": udn},
    )


async def _discover(hass, info):
    return await hass.config_entries.flow.async_init(DOMAIN, context={"source": "ssdp"}, data=info)


async def test_a_box_found_by_ssdp_asks_for_the_login_and_is_set_up(hass, fake_client):
    result = await _discover(hass, _ssdp())
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "confirm"
    assert result["description_placeholders"]["host"] == "192.168.178.1"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"username": "user", "password": "secret"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"]["host"] == "192.168.178.1"
    assert result["result"].unique_id == "SERIAL1"


async def test_the_confirmation_shows_a_wrong_login_and_goes_on(hass, fake_client, monkeypatch):
    result = await _discover(hass, _ssdp())

    def _raise():
        raise FritzAuthorizationError("401")

    monkeypatch.setattr(fake_client, "connect", _raise)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"username": "user", "password": "wrong"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "invalid_auth"}


async def test_a_box_already_set_up_is_not_offered_again_and_keeps_its_address(hass, fake_client):
    # the UDN ends with the MAC, which is the serial number of the box
    known = MockConfigEntry(
        domain=DOMAIN,
        unique_id="02000000CC01",
        data={"host": "192.168.178.1", "username": "user", "password": "secret"},
    )
    known.add_to_hass(hass)

    result = await _discover(hass, _ssdp(host="192.168.178.77"))
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"
    # whoever claims the UDN does not get the login: the address stays as it was
    assert known.data["host"] == "192.168.178.1"


async def test_a_box_at_an_address_that_is_set_up_is_not_offered_again(hass, fake_client, entry):
    result = await _discover(hass, _ssdp(udn="uuid:no-mac-here"))
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_a_repeater_found_by_ssdp_is_not_offered(hass, fake_client):
    result = await _discover(hass, _ssdp(model="FRITZ!Repeater 1200 AX"))
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "mesh_repeater"


async def test_an_ipv6_link_local_address_is_not_used(hass, fake_client):
    result = await _discover(hass, _ssdp(host="[fe80::1]"))
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "ignore_ip6_link_local"


async def test_the_same_box_found_twice_is_one_flow(hass, fake_client):
    first = await _discover(hass, _ssdp())
    assert first["type"] is FlowResultType.FORM
    second = await _discover(hass, _ssdp())
    assert second["type"] is FlowResultType.ABORT
    assert second["reason"] == "already_in_progress"


async def test_a_repeater_that_shows_up_at_the_login_is_refused(hass, fake_client):
    fake_client.repeater = True
    result = await _discover(hass, _ssdp())
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"username": "user", "password": "secret"}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "mesh_repeater"


async def test_reconfigure_can_drop_the_port(hass, fake_client, entry):
    hass.config_entries.async_update_entry(entry, data={**entry.data, "port": 49443})
    await hass.config_entries.async_setup(entry.entry_id)
    result = await entry.start_reconfigure_flow(hass)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"host": "192.168.178.2", "use_tls": False}
    )

    assert result["type"] is FlowResultType.ABORT
    assert "port" not in entry.data


async def test_a_confirmed_box_that_is_known_does_not_change_the_address_of_the_entry(
    hass, fake_client
):
    # a UDN without a serial: the box is only recognised after the login, by its serial number
    known = MockConfigEntry(
        domain=DOMAIN,
        unique_id="SERIAL1",
        data={"host": "192.168.178.1", "username": "user", "password": "secret"},
    )
    known.add_to_hass(hass)
    result = await _discover(hass, _ssdp(host="192.168.178.77", udn="uuid:no-serial-here"))
    assert result["step_id"] == "confirm"

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"username": "user", "password": "secret"}
    )

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"
    assert known.data["host"] == "192.168.178.1"
