"""The client against a mocked fritzconnection."""

import threading
import time
from unittest.mock import MagicMock

from fritzconnection.core.exceptions import FritzLookUpError, FritzServiceError
import pytest

from custom_components.fritzbox_network.api import REQUEST_TIMEOUT, FritzNetworkClient


def _client() -> FritzNetworkClient:
    client = FritzNetworkClient("192.168.178.1", None, "user", "secret")
    client._fc = MagicMock()
    client._fc.services = {"X_AVM-DE_HostFilter1": object()}
    client._fc.call_action.side_effect = FritzLookUpError("714")
    return client


def test_allowing_an_address_that_is_not_blocked_is_not_an_error():
    _client().set_internet_access("192.0.2.1", True)


def test_blocking_still_raises_on_a_lookup_error():
    with pytest.raises(FritzLookUpError):
        _client().set_internet_access("192.0.2.1", False)


def test_downloads_carry_a_timeout():
    client = _client()
    response = client._fc.session.get.return_value.__enter__.return_value
    response.text = "<x/>"

    assert client._download("/hosts.xml") == "<x/>"
    assert client._fc.session.get.call_args.kwargs["timeout"] == REQUEST_TIMEOUT


def test_polling_and_switching_never_talk_to_the_box_at_the_same_time():
    client = _client()
    inside = 0
    overlaps = 0
    guard = threading.Lock()

    def call_action(*args, **kwargs):
        nonlocal inside, overlaps
        with guard:
            inside += 1
            overlaps += inside > 1
        time.sleep(0.01)
        with guard:
            inside -= 1
        return {"NewX_AVM-DE_HostListPath": "/hosts.xml"}

    client._fc.call_action.side_effect = call_action
    client._fc.session.get.return_value.__enter__.return_value.text = "<List/>"

    workers = [threading.Thread(target=client.get_hosts) for _ in range(4)] + [
        threading.Thread(target=client.set_internet_access, args=("192.0.2.1", False))
        for _ in range(4)
    ]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()

    assert overlaps == 0


def test_host_ip_asks_for_the_one_host():
    client = _client()
    client._fc.call_action.side_effect = None
    client._fc.call_action.return_value = {"NewIPAddress": "192.0.2.7"}

    assert client.get_host_ip("02:00:00:00:00:03") == "192.0.2.7"
    client._fc.call_action.assert_called_once_with(
        "Hosts1", "GetSpecificHostEntry", NewMACAddress="02:00:00:00:00:03".upper()
    )


def test_host_ip_is_none_without_an_address_or_an_entry():
    client = _client()
    client._fc.call_action.side_effect = None
    client._fc.call_action.return_value = {"NewIPAddress": ""}
    assert client.get_host_ip("02:00:00:00:00:03") is None

    client._fc.call_action.side_effect = FritzLookUpError("714")
    assert client.get_host_ip("02:00:00:00:00:03") is None


def test_filter_profiles_and_setting_one():
    client = _client()
    client._fc.services = {"X_AVM-DE_HostFilter1": object()}
    client._fc.call_action.side_effect = None
    client._fc.call_action.return_value = {
        "NewFilterProfileList": (
            "<List><Item><ProfileID>p1</ProfileID><Name>Kids</Name></Item></List>"
        )
    }

    assert client.get_filter_profiles() == {"p1": "Kids"}
    client.set_filter_profile("192.0.2.1", "p1")
    client._fc.call_action.assert_called_with(
        "X_AVM-DE_HostFilter1",
        "AddHostEntryToFilterProfile",
        NewIPv4Address="192.0.2.1",
        NewFilterProfileID="p1",
    )


def test_no_filter_profiles_without_the_service():
    client = _client()
    client._fc.services = {}

    assert client.get_filter_profiles() == {}


def _priority_client(argument_names):
    client = _client()
    client._fc.call_action.side_effect = None
    arguments = {n: MagicMock(direction="in") for n in argument_names}
    action = MagicMock(arguments=arguments)
    client._fc.services = {"Hosts1": MagicMock(actions={"X_AVM-DE_SetPrioritizationByIP": action})}
    return client


def test_priority_finds_the_argument_names_in_the_box_description():
    client = _priority_client(["NewPrioritization", "NewIPAddress"])

    client.set_priority("192.0.2.1", True)

    client._fc.call_action.assert_called_once_with(
        "Hosts1",
        "X_AVM-DE_SetPrioritizationByIP",
        NewIPAddress="192.0.2.1",
        NewPrioritization=True,
    )


def test_priority_refuses_arguments_it_does_not_understand():
    with pytest.raises(FritzServiceError):
        _priority_client(["NewA", "NewB"]).set_priority("192.0.2.1", True)
