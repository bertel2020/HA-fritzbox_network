# FRITZ!Box Network

Home Assistant integration for the network devices of an AVM FRITZ!Box. Every
device is tracked by its **MAC address**: entity ids never change, and the name
follows the name in the FRITZ!Box automatically.

[Deutsche Version](README.md)

## Features

- One device per network device, with presence (device tracker), IP address,
  connection type (LAN/WLAN), access point and "last seen".
- Entity ids by MAC, e.g. `device_tracker.fritz_3c2af4a1b2c3` and
  `sensor.fritz_3c2af4a1b2c3_ip_address`. They stay the same when a device is renamed.
- When the name changes in the FRITZ!Box, the device name in Home Assistant changes
  with it. Names you set yourself in Home Assistant are kept.
- Block or allow the internet access per device, Wake on LAN (button, disabled by
  default).
- Optional, off by default: signal strength (dBm), link rate (download/upload), Wi-Fi band
  and network name per device, also for devices on a repeater. The values come from the
  mesh data of the box, without an extra request. The signal strength is how the access
  point sees the device.
- Offline devices can be deleted by hand. Deleted devices stay hidden and can be
  shown again in the options.
- Filters for guest network devices, devices with a private MAC address and a
  selection of single devices.
- The box is asked only twice per poll (host list and mesh), never once per device.

## Installation

### Via HACS (recommended)

[![Open the HACS repository in My Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=bertel2020&repository=HA-fritzbox_network&category=integration)
[![Add FRITZ!Box Network to My Home Assistant](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=fritzbox_network)

1. Use the first button to open the FRITZ!Box Network repository in HACS.
2. Download **FRITZ!Box Network** and restart Home Assistant.
3. Use the second button to add the integration. Alternatively open **Settings →
   Devices & services → Add integration → FRITZ!Box Network** in Home Assistant.

If the first button does not work, add `https://github.com/bertel2020/HA-fritzbox_network`
in HACS under **Integrations → Custom repositories** with the category **Integration**.

### Manual

Copy the directory `custom_components/fritzbox_network` to
`/config/custom_components/fritzbox_network` and restart Home Assistant.

## Setup

1. In the FRITZ!Box, enable **Allow access for applications** under **Home Network →
   Network → Network Settings** (TR-064).
2. Create a dedicated user under **System → FRITZ!Box Users** with the right
   **FRITZ!Box settings**, without access from the internet.
   Without this right the devices are shown, but the internet access switches and
   the Wake on LAN buttons are missing; a notice under **Settings → Repairs**
   explains why.
3. Add the integration and enter the credentials.

## Notes

- **Running next to the core integration "AVM FRITZ!Box Tools"** is possible but not
  recommended: both report the same devices and ask the box twice. Turn off device
  tracking in the core integration or remove it.
- The box remembers devices that have been offline for a long time. All of them are
  created; the device filter or deleting by hand keeps the list short.
- A laptop on LAN and WLAN appears twice in the box (two MACs) and is therefore two
  devices here.
- The box can only block the internet access of devices that have an IPv4 address.

## Options

Polling interval, how long a device counts as home after going offline, take over
names, ignore guest network and private MACs, device filter and the list of hidden
devices.
