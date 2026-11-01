# Changelog

All notable changes to this integration are recorded here.

## 0.1.0 – 2026-10-25

First version.

### New

- The network devices of the FRITZ!Box as Home Assistant devices, tracked by MAC address. Entity ids never change, the device name follows the name in the box, names you set yourself are kept.
  - Presence, IP address, connection type (LAN/WLAN), access point, "online since" and "last online".
  - Block and allow the internet access per device, Wake on LAN.
  - Optional, off by default: signal strength, link rate, Wi-Fi band, network name and a guest network flag.
  - The FRITZ!Box and its repeaters as devices of their own with model, firmware and the number of connected devices.
- Tidying up: delete offline devices by hand (they stay hidden), filters for the guest network, private MAC addresses and single devices, and an option not to create devices for offline hosts. Repeaters are never filtered.
- Topology card for the dashboard: the devices by access point, with search, filters and signal. It has a visual editor (title, start filter, collapsed access points, maximum height, threshold for weak links and more), loads itself and needs an administrator account.
- More switches and a select, off by default: access profile, priority and automatic Wake on LAN per device. Optional: the vendor from the MAC address, without any network access.
- Actions `set_name` and `wake_on_lan`, an event when a device changes its access point, logbook entries for all events and, optionally, a repair that offers to hide devices that have been offline for long.
- Setup: a new address and a new password without setting up again, a mesh repeater is refused, diagnostics with the poll duration.
