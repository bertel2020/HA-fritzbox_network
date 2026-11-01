"""Synchronous TR-064 client for the FRITZ!Box host list and mesh topology.

All methods on FritzNetworkClient perform blocking network I/O and must only
be called from an executor thread (see coordinator.py). A lock serializes the
calls, the box never sees two requests at once.

Per poll the client reads two documents, never one request per host:
- Hosts1 / X_AVM-DE_GetHostListPath: XML with all known hosts
- Hosts1 / X_AVM-DE_GetMeshListPath: JSON with the mesh topology
"""

from __future__ import annotations

import logging
import re
import threading
from typing import Any

from fritzconnection import FritzConnection
from fritzconnection.core.exceptions import (
    FritzActionError,
    FritzAuthorizationError,
    FritzLookUpError,
    FritzServiceError,
)
from homeassistant.helpers.device_registry import format_mac

from .const import HOST_FILTER_SERVICE_PREFIX, HOSTS_SERVICE
from .models import (
    Host,
    MeshTopology,
    parse_filter_profiles,
    parse_hosts,
    parse_mesh,
    parse_rights,
)

_LOGGER = logging.getLogger(__name__)

DEVICEINFO_SERVICE = "DeviceInfo1"
# the actions that read the internet connection: (service, action), at every poll or now and then
INTERNET_FAST = (
    ("WANIPConn1", "GetStatusInfo"),
    ("WANCommonIFC1", "GetTotalBytesSent"),
    ("WANCommonIFC1", "GetTotalBytesReceived"),
)
INTERNET_SLOW = (
    ("WANCommonIFC1", "GetCommonLinkProperties"),
    ("WANIPConn1", "GetExternalIPAddress"),
    ("WANIPConn1", "X_AVM_DE_GetExternalIPv6Address"),
    ("WANIPConn1", "X_AVM_DE_GetIPv6Prefix"),
    ("WANIPConn1", "X_AVM_DE_GetDNSServer"),
    ("WANIPConn1", "X_AVM_DE_GetIPv6DNSServer"),
    ("WANDSLInterfaceConfig1", "X_AVM-DE_GetDSLInfo"),
)
SECURITY_SERVICE = "LANConfigSecurity1"
RIGHT_ADMIN = "BoxAdmin"

# seconds for connecting and for each read, also of the direct list downloads
REQUEST_TIMEOUT = 10


class FritzNetworkClient:
    """Thin wrapper around fritzconnection."""

    def __init__(
        self,
        host: str,
        port: int | None,
        username: str,
        password: str,
        use_tls: bool = False,
    ) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._use_tls = use_tls
        self._lock = threading.Lock()
        self._fc: FritzConnection | None = None

    def connect(self) -> None:
        """Open the connection; raises fritzconnection exceptions on failure."""
        with self._lock:
            self._fc = FritzConnection(
                address=self._host,
                port=self._port,
                user=self._username,
                password=self._password,
                use_tls=self._use_tls,
                timeout=REQUEST_TIMEOUT,
                use_cache=True,
            )

    @property
    def _connection(self) -> FritzConnection:
        if self._fc is None:
            raise RuntimeError("connect() has not been called")
        return self._fc

    @property
    def model_name(self) -> str:
        return self._connection.modelname

    @property
    def system_version(self) -> str | None:
        return self._connection.system_version

    @property
    def serial_number(self) -> str | None:
        with self._lock:
            info = self._connection.call_action(DEVICEINFO_SERVICE, "GetInfo")
        return info.get("NewSerialNumber") or None

    def can_write(self) -> bool:
        """Return True if the user may change settings (BoxAdmin: readwrite)."""
        with self._lock:
            try:
                result = self._connection.call_action(SECURITY_SERVICE, "X_AVM-DE_GetCurrentUser")
            except (FritzActionError, FritzServiceError):
                return False
        rights = parse_rights(result.get("NewX_AVM-DE_CurrentUserRights"))
        return rights.get(RIGHT_ADMIN) == "readwrite"

    def _download(self, path: str) -> str:
        fc = self._connection
        with fc.session.get(f"{fc.address}:{fc.port}{path}", timeout=REQUEST_TIMEOUT) as response:
            response.raise_for_status()
            return response.text

    def get_hosts(self) -> list[Host]:
        with self._lock:
            result = self._connection.call_action(HOSTS_SERVICE, "X_AVM-DE_GetHostListPath")
            return parse_hosts(self._download(result["NewX_AVM-DE_HostListPath"]))

    def get_internet(self, details: bool) -> tuple[dict[str, Any], dict[str, Any]]:
        """The results of the actions that read the internet connection, by action name.

        The status and the byte counters are read every time, the addresses, link rates and DSL
        line only with ``details``. An action the box or the user's rights refuse is left out:
        which ones work differs by model and by provider (DSL, cable, fibre).
        """

        def read(actions: tuple[tuple[str, str], ...]) -> dict[str, Any]:
            results: dict[str, Any] = {}
            for service, action in actions:
                try:
                    results[action] = self._connection.call_action(service, action)
                except (
                    FritzActionError,
                    FritzServiceError,
                    FritzAuthorizationError,
                    KeyError,
                ) as err:
                    _LOGGER.debug("The box does not answer %s/%s: %s", service, action, err)
            return results

        with self._lock:
            fast = read(INTERNET_FAST)
            slow = read(INTERNET_SLOW) if details else {}
        return fast, slow

    def reconnect(self) -> None:
        """Hang up and dial in again, which usually brings a new external address."""
        with self._lock:
            self._connection.call_action("WANIPConn1", "ForceTermination")

    def reboot(self) -> None:
        """Restart the box."""
        with self._lock:
            self._connection.call_action("DeviceConfig1", "Reboot")

    def get_host_ip(self, mac: str) -> str | None:
        """The IPv4 address the box has for this MAC now; None if it has none or no entry.

        One small request instead of the whole host list.
        """
        with self._lock:
            try:
                result = self._connection.call_action(
                    HOSTS_SERVICE, "GetSpecificHostEntry", NewMACAddress=mac.upper()
                )
            except FritzLookUpError:
                return None
        return result.get("NewIPAddress") or None

    def get_mesh(self) -> MeshTopology | None:
        """Read the mesh topology; None if this box does not provide one."""
        with self._lock:
            try:
                result = self._connection.call_action(HOSTS_SERVICE, "X_AVM-DE_GetMeshListPath")
            except (FritzActionError, FritzServiceError):
                _LOGGER.debug("The box provides no mesh topology")
                return None
            return parse_mesh(self._download(result["NewX_AVM-DE_MeshListPath"]))

    def is_mesh_repeater(self) -> bool:
        """Whether this device is a mesh repeater, whose host list is incomplete.

        The serial number of a FRITZ!Box is its MAC address; the mesh topology
        tells which role the node with that MAC has.
        """
        serial = self.serial_number
        if not serial or not re.fullmatch(r"[0-9A-Fa-f]{12}", serial):
            return False
        mesh = self.get_mesh()
        if mesh is None:
            return False
        mac = format_mac(serial)
        node = next((n for n in mesh.nodes.values() if mac in n.macs), None)
        return node is not None and node.role == "slave"

    def _host_filter_service(self) -> str | None:
        return next(
            (n for n in self._connection.services if n.startswith(HOST_FILTER_SERVICE_PREFIX)),
            None,
        )

    def get_filter_profiles(self) -> dict[str, str]:
        """The access profiles of the box as {id: name}; empty if it has none to offer."""
        with self._lock:
            if (service := self._host_filter_service()) is None:
                return {}
            try:
                result = self._connection.call_action(service, "GetFilterProfiles")
            except (FritzActionError, FritzServiceError):
                _LOGGER.debug("The box provides no access profiles")
                return {}
        return parse_filter_profiles(result.get("NewFilterProfileList"))

    def set_filter_profile(self, ip: str, profile_id: str) -> None:
        """Put the host with this IPv4 address into an access profile."""
        with self._lock:
            if (service := self._host_filter_service()) is None:
                raise FritzServiceError("The box provides no host filter service")
            self._connection.call_action(
                service,
                "AddHostEntryToFilterProfile",
                NewIPv4Address=ip,
                NewFilterProfileID=profile_id,
            )

    def set_internet_access(self, ip: str, allowed: bool) -> None:
        """Allow or block the internet access of the host with this IPv4 address."""
        with self._lock:
            fc = self._connection
            service = self._host_filter_service()
            if service is None:
                raise FritzServiceError("The box provides no host filter service")
            try:
                fc.call_action(
                    service,
                    "DisallowWANAccessByIP",
                    NewIPv4Address=ip,
                    NewDisallow=not allowed,
                )
            except FritzLookUpError:
                # Error 714: the box keeps blocked addresses in a list. Allowing
                # an address that is not on it is already what was asked for.
                if not allowed:
                    raise
                _LOGGER.debug("%s was not blocked, nothing to allow", ip)

    def set_priority(self, ip: str, enabled: bool) -> None:
        """Give the host with this IPv4 address priority in the router, or take it away.

        The argument names are looked up in the description the box gives of the
        action: the address is the one with "ip" in its name, the other one is the flag.
        """
        with self._lock:
            fc = self._connection
            action_name = "X_AVM-DE_SetPrioritizationByIP"
            action = fc.services[HOSTS_SERVICE].actions[action_name]
            names = [n for n, a in action.arguments.items() if a.direction == "in"]
            ip_names = [n for n in names if "ip" in n.lower()]
            if len(names) != 2 or len(ip_names) != 1:
                raise FritzServiceError(f"Unexpected arguments of {action_name}: {names}")
            flag_name = next(n for n in names if n != ip_names[0])
            fc.call_action(HOSTS_SERVICE, action_name, **{ip_names[0]: ip, flag_name: enabled})

    def get_auto_wol(self, mac: str) -> bool:
        """Whether the box wakes the device itself when something wants to reach it."""
        with self._lock:
            result = self._connection.call_action(
                HOSTS_SERVICE, "X_AVM-DE_GetAutoWakeOnLANByMACAddress", NewMACAddress=mac.upper()
            )
        return bool(result["NewAutoWOLEnabled"])

    def set_auto_wol(self, mac: str, enabled: bool) -> None:
        with self._lock:
            self._connection.call_action(
                HOSTS_SERVICE,
                "X_AVM-DE_SetAutoWakeOnLANByMACAddress",
                NewMACAddress=mac.upper(),
                NewAutoWOLEnabled=enabled,
            )

    def set_friendly_name(self, mac: str, name: str) -> None:
        """Rename the device in the box itself."""
        with self._lock:
            self._connection.call_action(
                HOSTS_SERVICE,
                "X_AVM-DE_SetFriendlyNameByMAC",
                NewMACAddress=mac.upper(),
                **{"NewX_AVM-DE_FriendlyName": name},
            )

    def wake_on_lan(self, mac: str) -> None:
        with self._lock:
            self._connection.call_action(
                HOSTS_SERVICE,
                "X_AVM-DE_WakeOnLANByMACAddress",
                NewMACAddress=mac.upper(),
            )
