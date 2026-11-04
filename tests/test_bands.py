"""Which band a Wi-Fi access point of the box carries, found by the devices on it."""

from custom_components.fritzbox_network import capture as capture_module
from custom_components.fritzbox_network.const import DOMAIN

from .test_pcap import _dns, _file, _frame, _udp

BOX = bytes.fromhex("3ca62f000001")
BANDS = {
    "aa:bb:cc:00:00:01": "2_4ghz",
    "aa:bb:cc:00:00:02": "2_4ghz",
    "aa:bb:cc:00:00:03": "5ghz",
    "aa:bb:cc:00:00:04": "5ghz",
    "aa:bb:cc:00:00:05": "5ghz",
}


def _mac(n):
    return bytes.fromhex(f"aabbcc0000{n:02x}")


class Antenna:
    """A box that sends packets to the given devices on each interface."""

    def __init__(self, receivers, senders=()):
        self.receivers = receivers  # interface -> [device numbers]
        self.senders = dict(senders)  # interface -> [device numbers that only send]
        self.calls = []

    def capture(self, interface, path, seconds, max_bytes, stop, progress):
        self.calls.append(interface)
        frames = [
            _frame(
                BOX,
                _mac(n),
                (192, 168, 1, 1),
                (192, 168, 1, 50 + n),
                17,
                _udp(53, 5000, _dns("a.org")),
            )
            for n in self.receivers.get(interface, [])
        ]
        frames += [
            _frame(
                _mac(n),
                BOX,
                (192, 168, 1, 50 + n),
                (192, 168, 1, 1),
                17,
                _udp(5000, 53, _dns("a.org")),
            )
            for n in self.senders.get(interface, [])
        ]
        if not frames:
            raise ValueError("the box sent no data (an unused or quiet interface?)")
        _file(path, frames)
        return "time"


def test_each_access_point_gets_the_band_of_the_devices_it_sends_to(tmp_path):
    box = Antenna({"1-vap0": [1, 2], "1-vap1": [3, 4, 5]})

    result, votes = capture_module.detect_wifi_bands(
        box, ["1-vap0", "1-vap1"], BANDS, tmp_path, seconds=1, pause=0
    )

    assert result == {"1-vap0": "2_4ghz", "1-vap1": "5ghz"}
    assert votes == {"1-vap0": {"2_4ghz": 2}, "1-vap1": {"5ghz": 3}}
    assert list(tmp_path.iterdir()) == []  # the recordings are deleted again


def test_a_device_that_only_looks_for_networks_does_not_count(tmp_path):
    # a 5 GHz device sends probes on the 2.4 GHz access point; nothing is sent to it there
    box = Antenna({"1-vap0": [1, 2], "1-vap1": [3, 4]}, senders={"1-vap0": [3, 4, 5]})

    result, _ = capture_module.detect_wifi_bands(box, ["1-vap0", "1-vap1"], BANDS, tmp_path, 1, 0)

    assert result == {"1-vap0": "2_4ghz", "1-vap1": "5ghz"}


def test_devices_seen_on_both_access_points_say_nothing(tmp_path):
    # a recording that still carried the one before: every device appears on both
    box = Antenna({"1-vap0": [1, 2, 3], "1-vap1": [1, 2, 3, 4, 5]})

    result, votes = capture_module.detect_wifi_bands(
        box, ["1-vap0", "1-vap1"], BANDS, tmp_path, 1, 0
    )

    assert votes["1-vap0"] == {}
    assert votes["1-vap1"] == {"5ghz": 2}
    assert result == {"1-vap0": None, "1-vap1": "5ghz"}


def test_too_few_or_mixed_devices_leave_the_access_point_unnamed(tmp_path):
    box = Antenna({"1-vap0": [1, 3], "1-vap1": [4]})  # one of each band; one device

    result, _ = capture_module.detect_wifi_bands(box, ["1-vap0", "1-vap1"], BANDS, tmp_path, 1, 0)

    assert result == {"1-vap0": None, "1-vap1": None}


def test_an_access_point_without_traffic_is_just_unnamed(tmp_path):
    box = Antenna({"1-vap1": [3, 4]})  # the box sends nothing on vap0

    result, _ = capture_module.detect_wifi_bands(box, ["1-vap0", "1-vap1"], BANDS, tmp_path, 1, 0)

    assert result == {"1-vap0": None, "1-vap1": "5ghz"}


async def _call(client, command, **data):
    await client.send_json_auto_id({"type": command, **data})
    return await client.receive_json()


async def test_the_bands_are_found_on_request_kept_and_shown_in_the_list(
    hass, hass_ws_client, fake_client, entry, monkeypatch
):
    seen = {}

    def fake_detect(client, interfaces, bands, directory, seconds=10, pause=2.0):
        seen["interfaces"] = interfaces
        seen["bands"] = bands
        return {i: "2_4ghz" for i in interfaces}, {i: {"2_4ghz": 2} for i in interfaces}

    monkeypatch.setattr(capture_module, "detect_wifi_bands", fake_detect)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)

    result = (await _call(client, f"{DOMAIN}/capture/bands", entry_id=entry.entry_id))["result"]

    assert seen["interfaces"] == ["1-vap0"]  # what the fake box offers; only access points
    assert result["bands"] == {"1-vap0": "2_4ghz"}
    assert result["undecided"] == []
    listed = {i["id"]: i["band"] for i in result["interfaces"]}
    assert listed == {"2-1": None, "1-lan": None, "1-vap0": "2_4ghz", "3-17": None}
    # it stays: the next state shows it too
    state = (await _call(client, f"{DOMAIN}/capture/status", entry_id=entry.entry_id))["result"]
    assert {i["id"]: i["band"] for i in state["interfaces"]}["1-vap0"] == "2_4ghz"


async def test_the_bands_are_refused_while_a_capture_runs(hass, hass_ws_client, fake_client, entry):
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    client = await hass_ws_client(hass)
    manager = hass.data[capture_module.KEY_CAPTURES][entry.entry_id]
    manager.detecting = True  # as while the box is being listened to

    busy = await _call(client, f"{DOMAIN}/capture/bands", entry_id=entry.entry_id)
    assert busy["error"]["code"] == "busy"
    refused = await _call(
        client,
        f"{DOMAIN}/capture/start",
        entry_id=entry.entry_id,
        interface="1-lan",
        seconds=30,
        mb=10,
    )
    assert refused["error"]["code"] == "busy"
    manager.detecting = False
