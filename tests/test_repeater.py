"""Repeaters the user chose to control: their own login, slow poll and entities on their device."""

from dataclasses import replace
from unittest.mock import patch

from fritzconnection.core.exceptions import FritzActionError, FritzConnectionException
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr, entity_registry as er
import pytest

from custom_components.fritzbox_network.const import DOMAIN
from custom_components.fritzbox_network.models import WifiNetwork

from .conftest import REPEATER

ID = REPEATER.replace(":", "")


class FakeRepeater:
    """What a repeater answers: only a few services, the login of the box works."""

    instances: list["FakeRepeater"] = []

    def __init__(self, host, port, username, password, use_tls=False, verify_tls=False):
        self.args = (host, port, username, password, use_tls)
        self.calls: list[tuple] = []
        self.uptime = 3 * 3600
        self.cpu = 65
        self.fail = False
        self.wifi = {
            "2_4ghz": WifiNetwork(True, "Home", "02:aa", "ax"),
            "5ghz": WifiNetwork(True, "Home", "02:ab", "ax"),
        }
        self.firmware = {"NewUpgradeAvailable": False}
        self.guest = None
        FakeRepeater.instances.append(self)

    def connect(self):
        self.calls.append(("connect",))
        if self.fail:
            raise FritzConnectionException("down")

    def read_uptime(self):
        return self.uptime

    def get_wifi_networks(self):
        return dict(self.wifi)

    def get_firmware(self):
        return dict(self.firmware)

    def get_guest_wifi_info(self):
        return None if self.guest is None else {"enabled": self.guest, "ssid": "Gast"}

    def set_guest_wifi(self, enabled):
        self.calls.append(("guest", enabled))
        self.guest = enabled

    def get_guest_wifi_qr(self):
        return b"\x89PNG-repeater"

    def get_cpu_temperature(self):
        self.calls.append(("cpu",))
        return self.cpu

    def set_wifi_enabled(self, key, enabled):
        self.calls.append(("wifi", key, enabled))
        if self.fail:
            raise FritzActionError("refused")

    def reboot(self):
        self.calls.append(("reboot",))
        if self.fail:
            raise FritzActionError("refused")

    def install_firmware(self):
        self.calls.append(("install",))


_plain_init = FakeRepeater.__init__


def _guest_init(self, *args, **kwargs):
    _plain_init(self, *args, **kwargs)
    self.guest = True


@pytest.fixture(autouse=True)
def repeater_client():
    FakeRepeater.instances = []
    with patch("custom_components.fritzbox_network.repeater.FritzNetworkClient", FakeRepeater):
        yield FakeRepeater


def _with_repeater(fake_client):
    fake_client.hosts = [
        *fake_client.hosts,
        replace(
            fake_client.hosts[0],
            mac=REPEATER,
            mac_list=[REPEATER],
            name="repeater",
            ip="192.0.2.77",
            active=True,
        ),
    ]


async def _setup(hass, entry, chosen=(REPEATER,)):
    hass.config_entries.async_update_entry(entry, options={"repeaters": list(chosen)})
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry.runtime_data


async def test_a_chosen_repeater_is_asked_with_the_login_of_the_box_at_its_own_address(
    hass, fake_client, entry
):
    _with_repeater(fake_client)
    await _setup(hass, entry)

    (client,) = FakeRepeater.instances
    assert client.args == ("192.0.2.77", None, "user", "secret", False)


async def test_the_repeater_gets_its_entities_on_the_device_the_mesh_made(hass, fake_client, entry):
    _with_repeater(fake_client)
    await _setup(hass, entry)
    registry = er.async_get(hass)

    uptime = hass.states.get(f"sensor.fritz_{ID}_box_uptime")
    assert uptime is not None and uptime.state != "unknown"
    for band in ("2_4ghz", "5ghz"):
        assert hass.states.get(f"switch.fritz_{ID}_wifi_{band}").state == "on"
    assert hass.states.get(f"update.fritz_{ID}_firmware").state == "off"
    reboot = registry.async_get(f"button.fritz_{ID}_reboot")
    assert reboot is not None and reboot.disabled_by == er.RegistryEntryDisabler.INTEGRATION
    # one device: the one of the mesh node, not a second one
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, REPEATER)})
    assert device is not None
    entities = er.async_entries_for_device(registry, device.id, include_disabled_entities=True)
    assert {e.unique_id for e in entities} >= {f"{REPEATER}_wifi_5ghz", f"{REPEATER}_box_uptime"}


async def test_a_repeater_that_is_not_chosen_is_not_asked_and_has_no_controls(
    hass, fake_client, entry
):
    _with_repeater(fake_client)
    await _setup(hass, entry, chosen=())

    assert FakeRepeater.instances == []
    assert hass.states.get(f"switch.fritz_{ID}_wifi_5ghz") is None


async def test_a_wifi_switch_of_the_repeater_switches_and_shows_at_once(hass, fake_client, entry):
    _with_repeater(fake_client)
    await _setup(hass, entry)
    (client,) = FakeRepeater.instances
    entity_id = f"switch.fritz_{ID}_wifi_5ghz"

    await hass.services.async_call("switch", "turn_off", {"entity_id": entity_id}, blocking=True)
    await hass.async_block_till_done()

    assert ("wifi", "5ghz", False) in client.calls
    assert hass.states.get(entity_id).state == "off"


async def test_the_repeater_restarts_and_installs_firmware_when_asked(hass, fake_client, entry):
    _with_repeater(fake_client)
    await _setup(hass, entry)
    (client,) = FakeRepeater.instances
    registry = er.async_get(hass)
    registry.async_update_entity(f"button.fritz_{ID}_reboot", disabled_by=None)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    client = FakeRepeater.instances[-1]
    client.firmware = {"NewUpgradeAvailable": True, "NewX_AVM-DE_Version": "8.30"}
    await entry.runtime_data.repeaters[REPEATER].async_refresh()
    await hass.async_block_till_done()

    await hass.services.async_call(
        "button", "press", {"entity_id": f"button.fritz_{ID}_reboot"}, blocking=True
    )
    assert ("reboot",) in client.calls
    await hass.services.async_call(
        "update", "install", {"entity_id": f"update.fritz_{ID}_firmware"}, blocking=True
    )
    assert ("install",) in client.calls

    client.fail = True
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(
            "button", "press", {"entity_id": f"button.fritz_{ID}_reboot"}, blocking=True
        )


async def test_the_cpu_temperature_is_asked_once_and_read_only_while_its_sensor_is_on(
    hass, fake_client, entry
):
    _with_repeater(fake_client)
    await _setup(hass, entry)
    (client,) = FakeRepeater.instances
    registry = er.async_get(hass)
    reg = registry.async_get(f"sensor.fritz_{ID}_cpu_temperature")
    assert reg is not None and reg.disabled_by == er.RegistryEntryDisabler.INTEGRATION
    assert client.calls.count(("cpu",)) == 1

    registry.async_update_entity(reg.entity_id, disabled_by=None)
    await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    coordinator = entry.runtime_data.repeaters[REPEATER]
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert hass.states.get(f"sensor.fritz_{ID}_cpu_temperature").state == "65"


async def test_a_repeater_without_the_sensor_gets_no_temperature_entity(hass, fake_client, entry):
    _with_repeater(fake_client)
    with patch.object(FakeRepeater, "get_cpu_temperature", lambda self: None):
        await _setup(hass, entry)
    assert er.async_get(hass).async_get(f"sensor.fritz_{ID}_cpu_temperature") is None


async def test_a_repeater_that_does_not_answer_makes_only_its_own_entities_unavailable(
    hass, fake_client, entry
):
    _with_repeater(fake_client)
    coordinator = await _setup(hass, entry)
    repeater = coordinator.repeaters[REPEATER]
    repeater.client = None  # connect again, as after any failure
    with patch.object(FakeRepeater, "connect", side_effect=FritzConnectionException("down")):
        await repeater.async_refresh()
        await hass.async_block_till_done()

    assert hass.states.get(f"switch.fritz_{ID}_wifi_5ghz").state == "unavailable"
    assert hass.states.get("sensor.fritz_network_devices_total").state != "unavailable"


async def test_a_new_address_of_the_repeater_is_followed(hass, fake_client, entry):
    _with_repeater(fake_client)
    coordinator = await _setup(hass, entry)
    fake_client.hosts = [
        replace(h, ip="192.0.2.99") if h.mac == REPEATER else h for h in fake_client.hosts
    ]
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    await coordinator.repeaters[REPEATER].async_refresh()

    assert FakeRepeater.instances[-1].args[0] == "192.0.2.99"


async def test_without_the_right_to_change_settings_no_repeater_is_controlled(
    hass, fake_client, entry
):
    fake_client.writable = False
    _with_repeater(fake_client)
    coordinator = await _setup(hass, entry)

    assert coordinator.repeaters == {}
    assert FakeRepeater.instances == []


async def test_the_options_offer_the_repeaters_of_the_mesh(hass, fake_client, entry):
    _with_repeater(fake_client)
    await _setup(hass, entry, chosen=())
    result = await hass.config_entries.options.async_init(entry.entry_id)

    schema = {str(k): k for k in result["data_schema"].schema}
    field = result["data_schema"].schema[schema["repeaters"]]
    values = [o["value"] for o in field.config["options"]]
    assert REPEATER in values


async def test_a_repeater_with_a_guest_network_gets_its_switch_and_qr_code(hass, fake_client, entry):
    _with_repeater(fake_client)
    with patch.object(FakeRepeater, "__init__", _guest_init):
        await _setup(hass, entry)
    (client,) = FakeRepeater.instances
    switch_id = f"switch.fritz_{ID}_guest_wifi"
    assert hass.states.get(switch_id).state == "on"
    assert hass.states.get(f"image.fritz_{ID}_guest_wifi_qr") is None  # off by default

    await hass.services.async_call("switch", "turn_off", {"entity_id": switch_id}, blocking=True)
    await hass.async_block_till_done()
    assert ("guest", False) in client.calls
    assert hass.states.get(switch_id).state == "off"


async def test_a_repeater_without_a_guest_network_gets_neither(hass, fake_client, entry):
    _with_repeater(fake_client)
    await _setup(hass, entry)
    assert hass.states.get(f"switch.fritz_{ID}_guest_wifi") is None
