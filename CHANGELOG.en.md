# Changelog

All notable changes to this integration are recorded here.

## 0.1.0 – 2026-10-25

First version.

### New

- The network devices of the FRITZ!Box as Home Assistant devices, tracked by MAC address. Entity ids never change, the device name follows the name in the box, names you set yourself are kept.
  - Presence, IP address, connection type (LAN/WLAN), access point and "last seen".
  - Block and allow the internet access per device, Wake on LAN.
  - Optional, off by default: signal strength, link rate, Wi-Fi band, network name and a guest network flag.
  - The FRITZ!Box and its repeaters as devices of their own with model, firmware and the number of connected devices.
- Tidying up: delete offline devices by hand (they stay hidden), filters for the guest network, private MAC addresses and single devices, and an option not to create devices for offline hosts. Repeaters are never filtered.
- Setup: a new address and a new password without setting up again, a mesh repeater is refused, diagnostics with the poll duration.
