"""The client against a mocked fritzconnection."""

from unittest.mock import MagicMock

from fritzconnection.core.exceptions import FritzLookUpError
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
