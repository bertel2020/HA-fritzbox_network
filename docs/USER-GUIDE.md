# FRITZ!Box Network for Home Assistant – User guide

[← Back to the overview](../README.en.md)

Custom Home Assistant integration for the **network devices** of a FRITZ!Box. Every device is tracked by its **MAC address**, the name follows the FRITZ!Box, and each device gets presence, connection data and actions. It is based on TR-064 (`Hosts1`, `X_AVM-DE_HostFilter1`) and the mesh topology of the box, read with [`fritzconnection`](https://github.com/kbr/fritzconnection).

The integration works locally with the FRITZ!Box and makes no connections to the internet.

## Contents

- [Requirements on the FRITZ!Box](#requirements-on-the-fritzbox)
- [Installation](#installation)
- [Update](#update)
- [Options](#options)
- [Entities](#entities)
- [Names and entity ids](#names-and-entity-ids)
- [Deleting and hiding devices](#deleting-and-hiding-devices)
- [Next to the core integration](#next-to-the-core-integration)
- [Privacy and security](#privacy-and-security)
- [Trademark notice](#trademark-notice)
- [Troubleshooting](#troubleshooting)
- [Development and tests](#development-and-tests)
- [Changelog](../CHANGELOG.en.md)

## Requirements on the FRITZ!Box

| # | What | Where |
|---|------|-------|
| 1 | Enable TR-064 | Home Network → Network → Network Settings → "Allow access for applications" |
| 2 | A dedicated FRITZ!Box user for Home Assistant | System → FRITZ!Box Users → right "FRITZ!Box settings" (for the internet block and Wake on LAN), without access from the internet |
| 3 | The box is the **mesh master** | A mesh repeater does not know all devices; setup refuses it |

Without the right "FRITZ!Box settings" the devices are still shown, but the internet access switches and the Wake on LAN buttons are missing. A notice under **Settings → Repairs** explains this.

On the Home Assistant side, **Home Assistant 2026.8 or newer** is required.

## Installation

### Via HACS (recommended)

[![Open the HACS repository in My Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=bertel2020&repository=HA-fritzbox_network&category=integration)
[![Add FRITZ!Box Network to My Home Assistant](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=fritzbox_network)

1. Use the first button to open the FRITZ!Box Network repository in HACS.
2. Download **FRITZ!Box Network** and restart Home Assistant.
3. Use the second button to add the integration. Alternatively open **Settings → Devices & services → Add integration → FRITZ!Box Network** in Home Assistant.

If the first button does not work, add `https://github.com/bertel2020/HA-fritzbox_network` in HACS under **Integrations → Custom repositories** with the category **Integration**.

### Manual

Copy the directory `custom_components/fritzbox_network` to `/config/custom_components/fritzbox_network` and restart Home Assistant.

### Setup

Enter the host (default `192.168.178.1`), user and password, optionally the port and TLS. The serial number of the box becomes the identifier of the entry; the same box cannot be set up twice.

- **New address of the box**: ⋮ on the entry → **Reconfigure**. Address, port and TLS can be changed, the login stays. A different box is refused.
- **New password**: Home Assistant shows "Re-authenticate"; follow the notice.

## Update

Update through HACS and restart Home Assistant. Entity ids do not change.

## Options

**Settings → Devices & services → FRITZ!Box Network → Configure**

| Option | Default | Meaning |
|--------|---------|---------|
| Polling interval | 30 s (15–300) | How often the box is asked. Two requests per poll (host list, mesh). After repeated failures the interval doubles, up to 5 minutes. |
| Consider home for | 180 s (0–900) | How long a device still counts as home after going offline. |
| Take over device names | on | The name from the box becomes the device name. Names you set yourself in Home Assistant are never overwritten. |
| Do not create devices for offline hosts | off | The box remembers every device it ever saw. With this option a device is created only when it comes online. Existing devices stay. |
| Ignore devices in the guest network | off | Guest network devices are not created (existing ones are removed). |
| Ignore devices with a private MAC address | off | Devices with a random ("private") MAC are not created (existing ones are removed). |
| Device filter | all devices | All, only the selected, or all except the selected devices. |
| Hidden devices | empty | Devices deleted by hand. Deselect one to show it again. |

The box itself and its **repeaters** are never filtered.

## Entities

### Per network device

| Platform | Entity | Default | Note |
|----------|--------|---------|------|
| Device tracker | (device name) | on | Presence; attributes `ip`, `mac`, `host_name`, `interface_type`, `model`, `guest`, `vpn`, `mac_list` |
| Sensor | IP address | on | |
| Sensor | Connection | on | `lan` or `wlan` |
| Sensor | Access point | on | Name of the box or repeater the device is connected to |
| Sensor | Last seen | on | Timestamp; changes only when going online or offline and survives a restart |
| Switch | Internet access | on | On = may use the internet. Only with the right "FRITZ!Box settings" and only for devices with an IPv4 address. The box sometimes reports the change only after about a minute; the switch shows it at once until then. |
| Button | Wake on LAN | off | Only with the right; not for devices known to be on Wi-Fi |
| Binary sensor | Guest network | on for guest devices only | Diagnostic |
| Sensor | Signal strength | off | in dBm, Wi-Fi devices only; how the access point sees the device |
| Sensor | Link rate download / upload | off | in Mbit/s, from the device's point of view |
| Sensor | Wi-Fi band | off | 2.4 / 5 / 6 GHz |
| Sensor | Network name (SSID) | off | |

Signal strength, link rate, band and SSID come from the mesh data of the box, without an extra request. They are created only for devices the box knows a connection for, and are diagnostic entities.

### Box and repeaters

The FRITZ!Box and every repeater are devices of their own with model and firmware. Each has the sensor **Connected devices** (the number of devices connected to that access point). A repeater is also its entry in the host list, so it is a single device.

### Event

When a device is renamed in the box, Home Assistant fires the event `fritzbox_network_device_renamed` with `mac`, `old_name` and `new_name`.

## Names and entity ids

The entity id is created once, when the device is added, from the MAC address without colons:

- Tracker: `device_tracker.fritz_3c2af4a1b2c3`
- other entities: `<platform>.fritz_3c2af4a1b2c3_<key>`, e.g. `sensor.fritz_3c2af4a1b2c3_ip_address`, `switch.fritz_3c2af4a1b2c3_internet_access`

After that Home Assistant never changes them by itself. The **name**, on the other hand, follows the box: the name in the FRITZ!Box (display name, else host name, else `fritz_<MAC>`) becomes the device name, and the entities show it. A name you set on the device in Home Assistant takes precedence and is never overwritten.

A laptop on LAN and WLAN has two MAC addresses and appears twice in the box. It is therefore two devices here.

## Deleting and hiding devices

**Delete device** on the device in Home Assistant works for every device that is **not online right now**. The deleted device goes on the list of hidden devices, because the box keeps offline devices forever and would otherwise bring it back with the next poll. The box, repeaters and devices that are online are refused.

The deletion only affects Home Assistant. The device stays in the box; remove it there with the trash icon under **Home Network → Network → Network Connections**. It cannot be triggered through TR-064.

When a filter in the options excludes a device, its device and entities are removed with the next poll. They come back when the filter includes them again.

## Next to the core integration

The core integration "AVM FRITZ!Box Tools" can run in parallel. Since Home Assistant 2026.8 every device belongs to exactly one integration; you therefore get **two separate devices** per network device, with duplicate trackers and double the load on the box. Turn off device tracking in the core integration or remove it once you have switched to this one.

Automations that refer to core entity ids have to be changed to the new ids; there is no automatic migration.

## Privacy and security

- Communication with the FRITZ!Box stays on your local network (HTTP or, if chosen, HTTPS). There is no connection to the internet.
- The credentials are stored in the entry in Home Assistant. Create a dedicated user for the integration with only the necessary right, without access from the internet.
- MAC and IP addresses and device names appear as entity attributes in Home Assistant; whoever has access there can see them.
- The **diagnostics** (⋮ on the entry → Download diagnostics) remove credentials, the address of the box and the MAC and IP addresses and names of the devices. They also show how long the last and the slowest poll took. Look through the file before you share it anyway.
- The integration can block the internet access of devices. Whoever may operate switches in Home Assistant can do that too.

## Trademark notice

The integration ships its own icon in the local directory `custom_components/fritzbox_network/brand/` that Home Assistant supports, but no trademarks or logos of AVM.

> **Trademark notice:** This project is an independent, unofficial integration and not affiliated with AVM or FRITZ! GmbH. FRITZ!, FRITZ!Box and FRITZ!OS are registered trademarks of their respective owners. "Home Assistant" is a trademark of the Open Home Foundation.

## Troubleshooting

| Problem | Check |
|---------|-------|
| The integration is not found | The target folder is named exactly `custom_components/fritzbox_network`; `manifest.json` is directly inside it; Home Assistant was restarted |
| "Connection failed" during setup | Host reachable, TR-064 enabled, check the input for TLS or a different port |
| "User name or password wrong" | Sign in to the web interface of the box with the same data; the user needs the right "FRITZ!Box settings" |
| "Mesh repeater" during setup | Connect to the box that is the mesh master |
| Switches and Wake on LAN buttons are missing | Give the user the right "FRITZ!Box settings" (notice under Repairs) |
| A device is missing | Check the device filter, guest network, private MACs and the option for offline devices; look under "Hidden devices" |
| A deleted device comes back | It was online, or it was shown again in the options |
| The internet access switch shows the old state | The box sometimes reports changes only after about a minute; the switch shows the new position at once until then |
| Internet access cannot be switched | The device needs an IPv4 address; IPv6-only devices cannot be blocked |
| A device appears twice | It has two MAC addresses (LAN and WLAN), or a private MAC has changed; delete the extra device or hide it with the filter |
| Too many entities | Turn on "Do not create devices for offline hosts", use the filter |

For detailed messages search **Settings → System → Logs** for `fritzbox_network`. With log level `debug` for `custom_components.fritzbox_network` the duration of every poll shows up.

## Development and tests

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/ruff check custom_components tests tools
.venv/bin/pytest
```

The tests run against a fake client with anonymised captures of a FRITZ!Box (`tests/fixtures/`). `tools/spike.py` reads a real box without changing anything (host list, mesh, a few services); the credentials come from the environment variables `FRITZ_HOST`, `FRITZ_USER`, `FRITZ_PASSWORD` and optionally `FRITZ_TLS=1`. It writes to `spike_out/` (not in the repository).

How to contribute is described in [CONTRIBUTING.md](../CONTRIBUTING.md).
