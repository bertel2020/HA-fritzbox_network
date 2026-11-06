"""The rules a new static route must keep, so that it cannot cut the box off from the home network.

A wrong route can send the traffic of Home Assistant or of the box itself into the void, so the
checks are made here, on the server, and not only in the panel (which shows the same checks while
the user types, see ``frontend/panel-routes.js``).
"""

from __future__ import annotations

import ipaddress
from typing import Any

MAX_METRIC = 65535


class RouteRefused(ValueError):
    """A route that must not be added; ``code`` names the rule, the same codes the panel knows."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def home_network(
    info: dict[str, Any] | None,
) -> tuple[ipaddress.IPv4Network, ipaddress.IPv4Address] | None:
    """The home network and the box address in it, from ``parse_network``; None if unknown."""
    if not info or not info.get("gateway") or not info.get("mask"):
        return None
    try:
        box = ipaddress.IPv4Address(info["gateway"])
        return ipaddress.IPv4Network(f"{box}/{info['mask']}", strict=False), box
    except ValueError:
        return None


def validate_route(
    network: str,
    gateway: str,
    metric: int,
    existing: list[dict[str, Any]],
    home: tuple[ipaddress.IPv4Network, ipaddress.IPv4Address],
) -> tuple[ipaddress.IPv4Network, ipaddress.IPv4Address]:
    """The destination and the gateway as addresses, or ``RouteRefused`` naming the rule broken.

    The destination must be a network (no host bits set), not the whole internet, not the home
    network or a part or a superset of it. The gateway must be a device in the home network, not
    the box itself and not inside the destination. A network that already has a route is refused:
    the box names a route by its destination, so the two could not be told apart.
    """
    try:
        target = ipaddress.IPv4Network(network.strip(), strict=True)
    except ValueError as err:
        raise RouteRefused("invalid_network") from err
    if target.is_loopback or target.is_multicast or target.is_link_local:
        raise RouteRefused("invalid_network")
    if target.prefixlen == 0:
        raise RouteRefused("all_traffic")
    lan, box = home
    if target.overlaps(lan) or box in target:
        raise RouteRefused("overlaps_home")
    try:
        via = ipaddress.IPv4Address(gateway.strip())
    except ValueError as err:
        raise RouteRefused("invalid_gateway") from err
    if via not in lan:
        raise RouteRefused("gateway_outside")
    if via == box:
        raise RouteRefused("gateway_is_box")
    if via in target:
        raise RouteRefused("gateway_in_target")
    if not isinstance(metric, int) or isinstance(metric, bool) or not 0 <= metric <= MAX_METRIC:
        raise RouteRefused("invalid_metric")
    if any(route["network"] == str(target) for route in existing):
        raise RouteRefused("duplicate")
    return target, via
