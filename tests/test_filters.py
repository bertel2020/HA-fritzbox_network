"""select_hosts: which hosts the filters turn into devices."""

from dataclasses import replace

from custom_components.fritzbox_network.filters import select_hosts

from .conftest import BOX, LAN, REPEATER, WLAN


def _macs(fake_client, **options):
    hosts = list(fake_client.hosts)
    return set(select_hosts(hosts, fake_client.mesh, options))


def test_without_options_everything_but_the_box_is_selected(fake_client):
    selected = _macs(fake_client)
    assert LAN in selected and WLAN in selected
    assert BOX not in selected


def test_include_keeps_only_the_chosen_devices(fake_client):
    assert _macs(fake_client, filter_mode="include", filter_devices=[LAN]) == {LAN}


def test_exclude_drops_the_chosen_devices(fake_client):
    selected = _macs(fake_client, filter_mode="exclude", filter_devices=[LAN])
    assert LAN not in selected and WLAN in selected


def test_hidden_devices_are_never_selected(fake_client):
    assert LAN not in _macs(fake_client, hidden_macs=[LAN])


def test_guests_and_private_macs_can_be_ignored(fake_client):
    fake_client.hosts = [replace(h, guest=True) if h.mac == WLAN else h for h in fake_client.hosts]
    assert WLAN not in _macs(fake_client, ignore_guests=True)
    assert WLAN in _macs(fake_client)
    # the fake MACs are locally administered, so all of them are private
    assert not _macs(fake_client, ignore_private_macs=True) - {REPEATER}


def test_a_repeater_is_never_filtered(fake_client):
    fake_client.hosts = [
        *fake_client.hosts,
        replace(fake_client.hosts[0], mac=REPEATER, mac_list=[REPEATER], name="repeater"),
    ]
    selected = _macs(
        fake_client, filter_mode="include", filter_devices=[], ignore_private_macs=True
    )
    assert REPEATER in selected
