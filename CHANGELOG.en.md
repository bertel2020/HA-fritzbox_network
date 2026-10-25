# Changelog

## Unreleased

### New

- Network devices of the FRITZ!Box as Home Assistant devices, tracked by MAC address.
  - Presence, IP address, connection type, access point and "last seen".
  - Block and allow internet access, Wake on LAN.
  - The device name follows the name in the FRITZ!Box, names you set yourself are kept.
  - Offline devices can be deleted by hand and then stay hidden.
  - Options for interval, presence, guest network, private MACs, device filter.
  - Devices excluded by a filter are removed. Repeaters are never filtered.
- Option not to create devices for offline hosts; they appear once the device comes online.
- The connection (address, port, TLS) can be changed later, for example when the FRITZ!Box has a new IP.
- Setup refuses a mesh repeater, because only the mesh master knows all devices.
- The FRITZ!Box and its repeaters are devices of their own with model, firmware and the number of connected devices; a repeater is also its entry in the host list.
- "Guest network" flag per device; enabled from the start only for devices in the guest network.
- The diagnostics show how long the last and the slowest poll took.

### Fixed

- "Last seen" survives a restart, also for devices that stayed online.
- The internet access switch shows a change at once, even when the box reports it only after a minute, and allowing a device that is not blocked is no longer an error.
