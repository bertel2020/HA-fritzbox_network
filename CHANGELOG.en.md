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
### Fixed

- "Last seen" survives a restart, also for devices that stayed online.
