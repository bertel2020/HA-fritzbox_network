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
import threading

from fritzconnection import FritzConnection
from fritzconnection.core.exceptions import FritzActionError, FritzServiceError

from .const import HOST_FILTER_SERVICE_PREFIX, HOSTS_SERVICE
from .models import Host, MeshTopology, parse_hosts, parse_mesh, parse_rights

_LOGGER = logging.getLogger(__name__)

DEVICEINFO_SERVICE = "DeviceInfo1"
SECURITY_SERVICE = "LANConfigSecurity1"
RIGHT_ADMIN = "BoxAdmin"


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
                timeout=10,
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
        with fc.session.get(f"{fc.address}:{fc.port}{path}") as response:
            response.raise_for_status()
            return response.text

    def get_hosts(self) -> list[Host]:
        with self._lock:
            result = self._connection.call_action(HOSTS_SERVICE, "X_AVM-DE_GetHostListPath")
            return parse_hosts(self._download(result["NewX_AVM-DE_HostListPath"]))

    def get_mesh(self) -> MeshTopology | None:
        """Read the mesh topology; None if this box does not provide one."""
        with self._lock:
            try:
                result = self._connection.call_action(HOSTS_SERVICE, "X_AVM-DE_GetMeshListPath")
            except (FritzActionError, FritzServiceError):
                _LOGGER.debug("The box provides no mesh topology")
                return None
            return parse_mesh(self._download(result["NewX_AVM-DE_MeshListPath"]))

    def set_internet_access(self, ip: str, allowed: bool) -> None:
        """Allow or block the internet access of the host with this IPv4 address."""
        with self._lock:
            fc = self._connection
            service = next(
                (n for n in fc.services if n.startswith(HOST_FILTER_SERVICE_PREFIX)), None
            )
            if service is None:
                raise FritzServiceError("The box provides no host filter service")
            fc.call_action(
                service,
                "DisallowWANAccessByIP",
                NewIPv4Address=ip,
                NewDisallow=not allowed,
            )

    def wake_on_lan(self, mac: str) -> None:
        with self._lock:
            self._connection.call_action(
                HOSTS_SERVICE,
                "X_AVM-DE_WakeOnLANByMACAddress",
                NewMACAddress=mac.upper(),
            )
