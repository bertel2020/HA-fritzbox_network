"""Which of the hosts the box lists become devices: the filters of the options, as one function."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .const import (
    CONF_FILTER_DEVICES,
    CONF_FILTER_MODE,
    CONF_HIDDEN_MACS,
    CONF_IGNORE_GUESTS,
    CONF_IGNORE_PRIVATE_MACS,
    DEFAULT_IGNORE_GUESTS,
    DEFAULT_IGNORE_PRIVATE_MACS,
    FILTER_EXCLUDE,
    FILTER_INCLUDE,
)
from .models import Host, MeshTopology, is_private_mac

# The options the filters read: what the panel may preview and change.
FILTER_OPTIONS = (
    CONF_FILTER_MODE,
    CONF_FILTER_DEVICES,
    CONF_IGNORE_GUESTS,
    CONF_IGNORE_PRIVATE_MACS,
)


def select_hosts(
    hosts: list[Host], mesh: MeshTopology | None, options: Mapping[str, Any]
) -> dict[str, Host]:
    """The hosts that get a device with these options, by MAC.

    The box itself and the hidden devices never do. Repeaters always do: they are part of
    the network and no filter hides them.
    """
    hidden = set(options.get(CONF_HIDDEN_MACS, []))
    mode = options.get(CONF_FILTER_MODE)
    selection = set(options.get(CONF_FILTER_DEVICES, []))
    ignore_guests = options.get(CONF_IGNORE_GUESTS, DEFAULT_IGNORE_GUESTS)
    ignore_private = options.get(CONF_IGNORE_PRIVATE_MACS, DEFAULT_IGNORE_PRIVATE_MACS)
    box = mesh.master if mesh else None

    selected: dict[str, Host] = {}
    for host in hosts:
        node = mesh.node_of(host) if mesh else None
        if host.mac in hidden or (node is not None and node is box):
            continue
        if node is not None:
            selected[host.mac] = host
            continue
        if ignore_guests and host.guest:
            continue
        if ignore_private and is_private_mac(host.mac):
            continue
        if mode == FILTER_INCLUDE and host.mac not in selection:
            continue
        if mode == FILTER_EXCLUDE and host.mac in selection:
            continue
        selected[host.mac] = host
    return selected
