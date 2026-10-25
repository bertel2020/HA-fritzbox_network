"""Constants for the FRITZ!Box network integration."""

from __future__ import annotations

DOMAIN = "fritzbox_network"

CONF_USE_TLS = "use_tls"

CONF_SCAN_INTERVAL = "scan_interval"
CONF_CONSIDER_HOME = "consider_home"
CONF_FILTER_MODE = "filter_mode"
CONF_FILTER_DEVICES = "filter_devices"
CONF_IGNORE_GUESTS = "ignore_guests"
CONF_IGNORE_PRIVATE_MACS = "ignore_private_macs"
CONF_ADOPT_NAMES = "adopt_names"
CONF_HIDDEN_MACS = "hidden_macs"
CONF_SKIP_OFFLINE = "skip_offline"

FILTER_ALL = "all"
FILTER_INCLUDE = "include"
FILTER_EXCLUDE = "exclude"

DEFAULT_SCAN_INTERVAL = 30
DEFAULT_CONSIDER_HOME = 180
DEFAULT_IGNORE_GUESTS = False
DEFAULT_IGNORE_PRIVATE_MACS = False
DEFAULT_ADOPT_NAMES = True
DEFAULT_SKIP_OFFLINE = False

# After repeated failures the poll interval doubles, never beyond this.
MAX_BACKOFF_SECONDS = 300
BACKOFF_AFTER_FAILURES = 3

EVENT_DEVICE_RENAMED = f"{DOMAIN}_device_renamed"

# Keys of the entities per client device (also part of the unique id).
KEY_TRACKER = "tracker"
KEY_IP_ADDRESS = "ip_address"
KEY_CONNECTION_TYPE = "connection_type"
KEY_ACCESS_POINT = "access_point"
KEY_LAST_SEEN = "last_seen"
KEY_INTERNET_ACCESS = "internet_access"
KEY_WAKE_ON_LAN = "wake_on_lan"

HOSTS_SERVICE = "Hosts1"
HOST_FILTER_SERVICE_PREFIX = "X_AVM-DE_HostFilter"
