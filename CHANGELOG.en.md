# Changelog

All notable changes to this integration are recorded here.

## Unreleased

### New

- Side panel: a network map as a second view next to the list (switch **List | Network map**, the panel remembers the choice). The FRITZ!Box and every repeater are areas of their own, the devices hang as buttons with initials on lines for LAN and the Wi-Fi bands. The line to a repeater shows whether it is linked by cable or Wi-Fi. Filtered devices are left out of the map, with the note "N hidden by the filter".
- The topology adds `uplink` per repeater: type, band and signal of its link, from the mesh topology.
- An action whose entity is switched off in Home Assistant shows the known value (access profile, priority) and an **Enable** button, with two or more also **Enable all**. Home Assistant then reloads the integration briefly.

### Changed

- Side panel: a device opens as a page of its own instead of a column on the right. Back leads to the list or the map with filter, scroll position and focus; ‹ › or `j`/`k` page through the devices shown. New at the top of the page is the connection path (internet, FRITZ!Box, repeater, device); from 900 px the actions and the master data stand side by side.
- Side panel: instead of a long row of filters there are three fixed ones (All, Online, Offline) and the "More" menu with the other filters and the groups, on a phone as a sheet from the bottom. The row and the radio boxes wrap instead of scrolling sideways.

## 0.1.0 – 2026-10-25

First version.

### New

- The network devices of the FRITZ!Box as Home Assistant devices, tracked by MAC address. Entity ids never change, the device name follows the name in the box, names you set yourself are kept.
  - Presence, IP address, connection type (LAN/WLAN), access point, "online since" and "last online".
  - Block and allow the internet access per device, Wake on LAN.
  - Optional, off by default: signal strength, link rate, Wi-Fi band, network name and a guest network flag.
  - The FRITZ!Box and its repeaters as devices of their own with model, firmware and the number of connected devices.
- Tidying up: delete offline devices by hand (they stay hidden), filters for the guest network, private MAC addresses and single devices, and an option not to create devices for offline hosts. Repeaters are never filtered.
- Side panel for administrators: the whole network in the sidebar with status filters and counts, search, grouping, radio data per access point and a detail page per device (block internet, priority, access profile, Wake on LAN, rename). Plus groups through Home Assistant labels (filter, grouping, block all, option `label` on the devices card, input "Group" in the schedule blueprint), links to the logbook and the history on the device page, an internet page (connection, addresses, load with a course, DSL line quality with the signal over the frequency, notes on anything unusual, recent events), plus sensors for the connection, the throughput and the DSL line, actions "Reconnect" and "Restart the box" in the panel and events (also in the logbook) for a lost and a new connection and a new external IPv4, bulk clean-up of long-offline devices and the device filter with a preview that shows what would be removed with its entities.
- Dashboard cards: a Wi-Fi card (channel, load, noise and device count per radio of every access point) and a devices card (chosen devices with block or allow internet, Wake on LAN and one button for all). Topology card for the dashboard: the devices by access point at a glance, with online dot, link, signal and a warning for a weak link. A tap on a device opens its page in the side panel, a tap on the heading the overview; search, filters, details and actions are there. It has a visual editor (title, collapsed access points, maximum height, threshold for weak links), loads itself and needs an administrator account.
- More switches and a select, off by default: access profile, priority and automatic Wake on LAN per device. Optional: the vendor from the MAC address, without any network access.
- Actions `set_name` and `wake_on_lan`, an event when a device changes its access point, logbook entries for all events and, optionally, a repair that offers to hide devices that have been offline for long.
- Setup: a new address and a new password without setting up again, a mesh repeater is refused, diagnostics with the poll duration.
