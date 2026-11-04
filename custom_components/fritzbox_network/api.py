"""Synchronous TR-064 client for the FRITZ!Box host list and mesh topology.

All methods on FritzNetworkClient perform blocking network I/O and must only
be called from an executor thread (see coordinator.py). A lock serializes the
calls, the box never sees two requests at once.

Per poll the client reads two documents, never one request per host:
- Hosts1 / X_AVM-DE_GetHostListPath: XML with all known hosts
- Hosts1 / X_AVM-DE_GetMeshListPath: JSON with the mesh topology
"""

from __future__ import annotations

import contextlib
import hashlib
import http.client
import json
import logging
import re
import socket
import ssl
import threading
import time
from typing import Any
from urllib.parse import urlencode
import xml.etree.ElementTree as ET

from fritzconnection import FritzConnection
from fritzconnection.core.exceptions import (
    FritzActionError,
    FritzArrayIndexError,
    FritzAuthorizationError,
    FritzLookUpError,
    FritzServiceError,
)
from homeassistant.helpers.device_registry import format_mac
import requests

from . import pcap
from .const import HOST_FILTER_SERVICE_PREFIX, HOSTS_SERVICE
from .models import (
    Host,
    MeshTopology,
    parse_capture_interfaces,
    parse_device_log,
    parse_filter_profiles,
    parse_hosts,
    parse_ip_form,
    parse_mesh,
    parse_network,
    parse_rights,
)

_LOGGER = logging.getLogger(__name__)

DEVICEINFO_SERVICE = "DeviceInfo1"
# the actions that read the internet connection: (service, action), at every poll or now and then
INTERNET_FAST = (
    ("WANIPConn1", "GetStatusInfo"),
    # the byte counters, 64 bit on most boxes; where this action is missing the two below do
    ("WANCommonIFC1", "GetAddonInfos"),
)
INTERNET_COUNTERS = (
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

# the most port forwardings read: the box lists a few dozen at the most
MAX_PORT_MAPPINGS = 128

# seconds for connecting and for each read, also of the direct list downloads
REQUEST_TIMEOUT = 10
# seconds without a byte from a capture before it counts as ended: a quiet line sends nothing
CAPTURE_READ_TIMEOUT = 20


def web_login_response(challenge: str, password: str) -> str:
    """The answer to the challenge of the login of the web interface (PBKDF2 or the old MD5)."""
    if challenge.startswith("2$"):
        _, iterations_1, salt_1, iterations_2, salt_2 = challenge.split("$")
        hash_1 = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_1), int(iterations_1)
        )
        hash_2 = hashlib.pbkdf2_hmac("sha256", hash_1, bytes.fromhex(salt_2), int(iterations_2))
        return f"{salt_2}${hash_2.hex()}"
    digest = hashlib.md5(f"{challenge}-{password}".encode("utf-16-le")).hexdigest()  # noqa: S324
    return f"{challenge}-{digest}"


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
        # the WLANConfiguration service of the guest network: looked for once, then known
        self._guest_service: str | None = None
        self._guest_searched = False
        # the session of the web interface, which the fixed addresses are read from
        self._web_sid: str | None = None
        self._web_uids: dict[str, str] = {}
        # what the edit forms said, per MAC: (when, answer); the address page reads many
        self._reservations: dict[str, tuple[float, dict[str, Any] | None]] = {}

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

    def _web_base(self) -> str:
        return f"{'https' if self._use_tls else 'http'}://{self._host}"

    def _web_post(self, path: str, data: dict[str, str]) -> str:
        session = self._connection.session
        response = session.post(
            f"{self._web_base()}{path}",
            data=data,
            timeout=REQUEST_TIMEOUT,
            verify=False,  # noqa: S501
        )
        response.raise_for_status()
        return response.text

    def _web_get(self, path: str) -> str:
        session = self._connection.session
        response = session.get(
            f"{self._web_base()}{path}",
            timeout=REQUEST_TIMEOUT,
            verify=False,  # noqa: S501
        )
        response.raise_for_status()
        return response.text

    def _web_login(self) -> str:
        """Log in to the web interface with the account of the integration."""
        url = "/login_sid.lua?version=2"
        # the challenge is asked with a GET: a POST without a body is refused by the box
        # ("getcgivars(): Unsupported Content-Type") and its answer is no XML
        root = ET.fromstring(self._web_get(url))
        challenge = root.findtext("Challenge") or ""
        answer = ET.fromstring(
            self._web_post(
                url,
                {
                    "username": self._username,
                    "response": web_login_response(challenge, self._password),
                },
            )
        )
        sid = answer.findtext("SID") or ""
        if not sid or set(sid) == {"0"}:
            raise PermissionError("the box did not accept the login to the web interface")
        self._web_sid = sid
        return sid

    def _web_data(self, **fields: str) -> Any:
        """One answer of data.lua; the session is renewed once when the box has dropped it."""
        for attempt in (0, 1):
            sid = self._web_sid or self._web_login()
            try:
                return json.loads(
                    self._web_post("/data.lua", {"sid": sid, "xhr": "1", "lang": "en", **fields})
                )
            except (requests.RequestException, ValueError):
                self._web_sid = None
                if attempt:
                    raise
        return None  # pragma: no cover

    def _new_connection(self) -> http.client.HTTPConnection:
        """A connection to the web interface for a stream: the box serves it over plain HTTP/1.0."""
        if self._use_tls:
            return http.client.HTTPSConnection(
                self._host,
                timeout=REQUEST_TIMEOUT,
                context=ssl._create_unverified_context(),  # noqa: S323, SLF001
            )
        return http.client.HTTPConnection(self._host, timeout=REQUEST_TIMEOUT)

    def get_capture_interfaces(self) -> list[dict[str, str]]:
        """The interfaces the capture page of the box lists for a packet capture."""
        with self._lock:
            sid = self._web_sid or self._web_login()
        connection = self._new_connection()
        try:
            connection.request("GET", f"/capture.lua?{urlencode({'sid': sid})}")
            response = connection.getresponse()
            if response.status != 200:
                raise ValueError(f"the box answered {response.status} {response.reason}")
            return parse_capture_interfaces(response.read().decode("utf-8", "replace"))
        finally:
            connection.close()

    def stop_captures(self, sid: str | None = None) -> None:
        """Ask the box to end every capture that still runs (the page of the box does the same).

        Best effort: a capture the connection of which was cut may run on in the box and load it.
        """
        try:
            if sid is None:
                with self._lock:
                    sid = self._web_sid or self._web_login()
            query = urlencode({"iface": "stopall", "capture": "Stop", "sid": sid})
            connection = self._new_connection()
            try:
                connection.request("GET", f"/cgi-bin/capture_notimeout?{query}")
                connection.getresponse().read()
            finally:
                connection.close()
        except (
            OSError,
            http.client.HTTPException,
            ValueError,
            PermissionError,
            ET.ParseError,
        ) as err:
            _LOGGER.debug("The captures could not be stopped: %s", err)

    def capture(
        self,
        interface: str,
        path: Any,
        seconds: int,
        max_bytes: int,
        stop: threading.Event,
        progress: Any,
    ) -> str:
        """Record the traffic on an interface of the box into a pcap file; returns why it ended.

        The box streams the capture while the connection is open. Only the login holds the lock:
        a capture runs for minutes and must not keep the polling waiting.
        """
        with self._lock:
            sid = self._web_sid or self._web_login()
        query = urlencode(
            {"ifaceorminor": interface, "snaplen": "1600", "capture": "Start", "sid": sid}
        )
        connection = self._new_connection()
        deadline = time.monotonic() + seconds
        written = 0
        reason = "time"
        finished = threading.Event()
        cut: list[str] = []
        sock: socket.socket | None = None

        def watch() -> None:
            """End the stream at the time limit or on stop; a blocked read cannot be asked to."""
            while not finished.is_set():
                if stop.is_set() or time.monotonic() >= deadline:
                    cut.append("stopped" if stop.is_set() else "time")
                    with contextlib.suppress(OSError, AttributeError):
                        sock.shutdown(socket.SHUT_RDWR)
                    return
                finished.wait(0.2)

        try:
            connection.request("GET", f"/cgi-bin/capture_notimeout?{query}")
            # the connection forgets its socket for an answer that ends by closing; keep it
            sock = connection.sock
            response = connection.getresponse()
            if response.status != 200:
                raise ValueError(f"the box answered {response.status} {response.reason}")
            sock.settimeout(CAPTURE_READ_TIMEOUT)
            threading.Thread(target=watch, daemon=True).start()
            with open(path, "wb") as target:
                while True:
                    try:
                        # read1 returns as soon as something has arrived
                        chunk = response.read1(65536)
                    except (OSError, http.client.HTTPException) as err:
                        if cut:
                            break  # the watcher closed the connection
                        if isinstance(err, TimeoutError) and written:
                            reason = "quiet"
                            break
                        if isinstance(err, TimeoutError):
                            raise ValueError(
                                f"the box sent nothing for {CAPTURE_READ_TIMEOUT} s "
                                "(a quiet interface?)"
                            ) from None
                        raise
                    if not chunk:
                        break
                    if written == 0 and chunk[:4] not in pcap.MAGICS:
                        # a refusal comes as text; anything else is shown as bytes
                        self._web_sid = None
                        raise ValueError(
                            f"the box did not send a capture: {chunk[:32].hex(' ')} "
                            f"({chunk[:60].decode('utf-8', 'replace').strip()})"
                        )
                    target.write(chunk)
                    written += len(chunk)
                    progress(written)
                    if written >= max_bytes:
                        reason = "size"
                        break
        finally:
            finished.set()
            connection.close()
            # the box ends a capture when the connection closes; make sure it did
            self.stop_captures(sid)
        if cut and reason == "time":
            reason = cut[0]
        if written == 0:
            raise ValueError("the box sent no data (an unused or quiet interface?)")
        return reason

    def get_device_log(self, group: str | None = None) -> list[dict[str, Any]]:
        """The event log of the box (DSL, network, Wi-Fi, phone, system), newest first.

        ``group`` is one of the groups the box knows: sys, net, fon, wlan, usb.
        """
        with self._lock:
            result = self._connection.call_action("DeviceInfo1", "X_AVM-DE_GetDeviceLogPath")
            path = result["NewDeviceLogPath"]
            if group:
                path = f"{path}&filter={group}"
            return parse_device_log(self._download(path))

    def get_network(self) -> dict[str, Any] | None:
        """Mask, gateway, DHCP range and reserved addresses of the home network, or None."""
        with self._lock:
            try:
                result = self._connection.call_action("LANHostConfigManagement1", "GetInfo")
            except (FritzActionError, FritzServiceError, FritzLookUpError):
                return None
        return parse_network(result)

    def set_address_range(self, first: str, last: str) -> None:
        """Set the range the DHCP server of the box hands out."""
        with self._lock:
            self._connection.call_action(
                "LANHostConfigManagement1",
                "SetAddressRange",
                NewMinAddress=first,
                NewMaxAddress=last,
            )

    def get_ip_reservations(self, macs: list[str], max_age: float = 600) -> dict[str, Any]:
        """The fixed-address state of several devices; one read per device, kept for a while."""
        now = time.monotonic()
        result: dict[str, Any] = {}
        for mac in macs:
            cached = self._reservations.get(mac)
            if cached and now - cached[0] < max_age:
                result[mac] = cached[1]
                continue
            result[mac] = self.get_ip_reservation(mac)
            self._reservations[mac] = (now, result[mac])
        return result

    def get_ip_reservation(self, mac: str) -> dict[str, Any] | None:
        """Whether the box gives a device always the same IP address: {"fixed", "editable"}.

        Read from the web interface, which has no counterpart in TR-064, so it is read on demand
        and only; None where the box does not tell (another firmware, no right for the interface).
        """
        with self._lock:
            try:
                uid = self._web_uids.get(mac)
                if uid is None:
                    listed = self._web_data(page="netDev", xhrId="all")["data"]
                    self._web_uids = {
                        format_mac(str(d["mac"])): str(d["UID"])
                        for group in ("active", "passive")
                        for d in listed.get(group, [])
                        if d.get("mac") and d.get("UID")
                    }
                    uid = self._web_uids.get(mac)
                if uid is None:
                    return None
                return parse_ip_form(self._web_data(page="edit_device", dev=uid))
            except (
                requests.RequestException,
                ValueError,
                KeyError,
                TypeError,
                PermissionError,
                ET.ParseError,
            ) as err:
                _LOGGER.debug("The fixed IP of %s could not be read: %s", mac, err)
                return None

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
            if "GetAddonInfos" not in fast:
                fast.update(read(INTERNET_COUNTERS))
            slow = read(INTERNET_SLOW) if details else {}
        return fast, slow

    def get_firmware(self) -> dict[str, Any]:
        """What the box says about a newer firmware, as the action answers; empty if nothing."""
        with self._lock:
            try:
                return self._connection.call_action("UserInterface1", "GetInfo")
            except (FritzActionError, FritzServiceError, FritzAuthorizationError, KeyError):
                return {}

    def get_port_mappings(self) -> list[dict[str, Any]]:
        """The port forwardings of the box, those set by hand and those a device opened by UPnP."""
        entries: list[dict[str, Any]] = []
        with self._lock:
            for index in range(MAX_PORT_MAPPINGS):
                try:
                    result = self._connection.call_action(
                        "WANIPConn1", "GetGenericPortMappingEntry", NewPortMappingIndex=index
                    )
                except (FritzArrayIndexError, FritzActionError):
                    break  # past the last entry the box answers with an error
                entries.append(
                    {
                        "description": result.get("NewPortMappingDescription") or None,
                        "protocol": result.get("NewProtocol"),
                        "external_port": result.get("NewExternalPort"),
                        "internal_port": result.get("NewInternalPort"),
                        "client": result.get("NewInternalClient") or None,
                        "enabled": bool(result.get("NewEnabled")),
                        "lease": result.get("NewLeaseDuration") or 0,
                    }
                )
        return entries

    def _guest_wifi_service(self) -> str | None:
        """The service of the guest Wi-Fi: the one whose access point type says "guest"."""
        if not self._guest_searched:
            self._guest_searched = True
            for number in range(1, 5):
                service = f"WLANConfiguration{number}"
                try:
                    info = self._connection.call_action(service, "GetInfo")
                except (FritzActionError, FritzServiceError, FritzAuthorizationError, KeyError):
                    continue
                if info.get("NewX_AVM-DE_APType") == "guest":
                    self._guest_service = service
                    break
        return self._guest_service

    def get_guest_wifi(self) -> bool | None:
        """Whether the guest Wi-Fi is on; None where the box has none."""
        with self._lock:
            if (service := self._guest_wifi_service()) is None:
                return None
            return bool(self._connection.call_action(service, "GetInfo").get("NewEnable"))

    def set_guest_wifi(self, enabled: bool) -> None:
        with self._lock:
            if (service := self._guest_wifi_service()) is None:
                raise FritzServiceError("The box has no guest Wi-Fi")
            self._connection.call_action(service, "SetEnable", NewEnable=enabled)

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
