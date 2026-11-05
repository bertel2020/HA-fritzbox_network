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
CONF_SHOW_VENDOR = "show_vendor"
CONF_STALE_REPAIR = "stale_repair"
CONF_STALE_DAYS = "stale_days"

FILTER_ALL = "all"
FILTER_INCLUDE = "include"
FILTER_EXCLUDE = "exclude"

DEFAULT_SCAN_INTERVAL = 30
DEFAULT_CONSIDER_HOME = 180
DEFAULT_IGNORE_GUESTS = False
DEFAULT_IGNORE_PRIVATE_MACS = False
DEFAULT_ADOPT_NAMES = True
DEFAULT_SKIP_OFFLINE = False
DEFAULT_SHOW_VENDOR = False
DEFAULT_STALE_REPAIR = False
DEFAULT_STALE_DAYS = 30

# After repeated failures the poll interval doubles, never beyond this.
MAX_BACKOFF_SECONDS = 300
# The box takes a while to show a changed internet access in its host list;
# until then the switch shows what was just asked for.
WAN_OVERRIDE_SECONDS = 120
# The access profiles of the box rarely change: read them every n-th poll.
FILTER_PROFILE_REFRESH_POLLS = 20
# A new firmware is not urgent to the minute: ask for it every n-th poll (about an hour).
FIRMWARE_REFRESH_POLLS = 120
# the fixed-address state of a device comes from the web interface, one request per device:
# a few devices per poll, each read again after this many seconds
RESERVATION_PER_POLL = 3
RESERVATION_REFRESH_SECONDS = 3600
BACKOFF_AFTER_FAILURES = 3
# The addresses, link rates and DSL line change rarely: read them every n-th poll, and at once
# after the box reconnected.
INTERNET_DETAIL_POLLS = 10
# How many throughput samples and events of the internet connection are kept in memory.
INTERNET_HISTORY = 240

# the history of the devices: a day in steps of five minutes, a week in hours
HISTORY_FINE_SECONDS = 300
HISTORY_OFFLINE_SECONDS = 1800
HISTORY_COARSE_SECONDS = 3600
HISTORY_DAYS = 7
# the data volume per day is kept for this many days
TRAFFIC_DAYS = 35
HISTORY_SAVE_DELAY = 300
INTERNET_EVENTS = 20
# what the history keeps of the connection: events, and the addresses per kind
INTERNET_EVENTS_KEPT = 200
INTERNET_ADDRESSES_KEPT = 20
# What counts as a problem worth a repair: a noise margin below this many dB for this many seconds,
# or this many new connections within a day.
INTERNET_NOISE_WARN_DB = 10
INTERNET_LOW_MARGIN_SECONDS = 3600
INTERNET_RECONNECTS_WARN = 5

EVENT_DEVICE_RENAMED = f"{DOMAIN}_device_renamed"
EVENT_NEW_DEVICE = f"{DOMAIN}_new_device"
EVENT_DEVICE_ROAMED = f"{DOMAIN}_device_roamed"
EVENT_INTERNET_DISCONNECTED = f"{DOMAIN}_internet_disconnected"
EVENT_INTERNET_RECONNECTED = f"{DOMAIN}_internet_reconnected"
EVENT_INTERNET_IP_CHANGED = f"{DOMAIN}_internet_ip_changed"
# A new access point must show in this many polls in a row before it counts as roaming.
ROAM_CONFIRM_POLLS = 2

# Keys of the entities per client device (also part of the unique id).
KEY_TRACKER = "tracker"
KEY_IP_ADDRESS = "ip_address"
KEY_CONNECTION_TYPE = "connection_type"
KEY_VENDOR = "vendor"
KEY_ACCESS_POINT = "access_point"
KEY_ONLINE_SINCE = "online_since"
KEY_LAST_ONLINE = "last_online"

# Keys of the diagnostic sensors of the box.
# Keys of the device counters of the box.
KEY_DEVICES_ONLINE = "devices_online"
KEY_DEVICES_OFFLINE = "devices_offline"
KEY_DEVICES_TOTAL = "devices_total"

# Keys of the internet connection of the box (device of the box).
KEY_FIRMWARE = "firmware"
KEY_GUEST_WIFI = "guest_wifi"
KEY_INTERNET_CONNECTED = "internet_connected"
KEY_VPN = "vpn"
KEY_VPN_SWITCH = "vpn_switch"
KEY_VPN_STATUS = "vpn_status"
KEY_VPN_SINCE = "vpn_since"
KEY_VPN_UID = "vpn_uid"
# seconds the box needs before a switched VPN connection shows its new state
VPN_VERIFY_SECONDS = 1.5
# polls in a row with no WireGuard list (empty or missing) before the box is believed: right after
# a reboot or a dropped session it often answers with nothing
VPN_EMPTY_POLLS = 3
KEY_INTERNET_DOWNLOAD = "internet_download"
KEY_INTERNET_UPLOAD = "internet_upload"
KEY_INTERNET_UPTIME = "internet_uptime"
KEY_EXTERNAL_IPV4 = "external_ipv4"
KEY_EXTERNAL_IPV6 = "external_ipv6"
KEY_DSL_RATE_DOWN = "dsl_rate_down"
KEY_DSL_RATE_UP = "dsl_rate_up"
KEY_DSL_NOISE_DOWN = "dsl_noise_margin_down"
KEY_DSL_NOISE_UP = "dsl_noise_margin_up"
KEY_DSL_ATTENUATION_DOWN = "dsl_attenuation_down"
KEY_DSL_ATTENUATION_UP = "dsl_attenuation_up"
KEY_DSL_FEC_ERRORS = "dsl_fec_errors"
KEY_DSL_CRC_ERRORS = "dsl_crc_errors"

KEY_LAST_UPDATE = "last_update"
KEY_FAILED_POLLS = "failed_polls"
KEY_MESH_STATUS = "mesh_status"
KEY_DHCP_POOL = "dhcp_pool"
KEY_ADDRESS_ASSIGNMENT = "address_assignment"
KEY_REFRESH = "refresh"

# Keys of the Wi-Fi radio sensors of an access point; the band is added to the unique id.
KEY_RADIO_CHANNEL = "radio_channel"
KEY_RADIO_UTILIZATION = "radio_utilization"
KEY_RADIO_NOISE = "radio_noise"
KEY_INTERNET_ACCESS = "internet_access"
KEY_WAKE_ON_LAN = "wake_on_lan"
KEY_ACCESS_PROFILE = "access_profile"
KEY_PRIORITY = "priority"
KEY_AUTO_WOL = "auto_wake_on_lan"
KEY_CLIENTS = "clients"
KEY_MESH_CONNECTED = "mesh_connected"
KEY_UPLINK = "uplink"
KEY_GUEST = "guest"
KEY_SIGNAL_STRENGTH = "signal_strength"
KEY_LINK_RATE_DOWNLOAD = "link_rate_download"
KEY_LINK_RATE_UPLOAD = "link_rate_upload"
KEY_WLAN_BAND = "wlan_band"
KEY_SSID = "ssid"

HOSTS_SERVICE = "Hosts1"
HOST_FILTER_SERVICE_PREFIX = "X_AVM-DE_HostFilter"
