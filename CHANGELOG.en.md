# Changelog

All notable changes to this integration are recorded here.

## Unreleased

### New

- Side panel, device page: **data volume** per device (today, 7 and 30 days, download and upload). The integration reads the per-device internet counters from the mesh topology of the box, adds up the difference per day (a counter that was reset starts anew) and keeps 35 days in `.storage`. The history starts with the first poll after the update. `history/device` and `history/summary` also return `traffic`.
- Side panel: the table has the sortable column **Volume (7 d)**, the internet page the ranking **Data volume per device** (today, 7 or 30 days, the ten largest devices with bars and the sum of all devices).
- Side panel: the charts show time and value on hover (or tap). The LAN icon is a network now instead of a plug. An **Internet** button in the header of the main page opens the internet page.
- Side panel: the list is **flat** by default and a sortable table (click the column heads) with connection, rate, signal, a sparkline of the last 24 hours and "Last online", with pages (50 rows, choose 25/50/100/all, the panel remembers the choice). Grouping by access point, band and group stays available.
- The integration keeps online times, signal and rate per device (a day in steps of five minutes, a week in hours) in the `.storage` of Home Assistant, so the sparklines survive a restart. New websocket commands `history/summary` and `history/device`.
- Side panel, device page: history of signal and rate over 24 hours or 7 days with the lowest, mean and highest value.
- Side panel: a network map as a second view next to the list (switch **List | Network map**, the panel remembers the choice). The FRITZ!Box and every repeater are areas of their own, the devices hang as buttons with initials on lines for LAN and the Wi-Fi bands. The line to a repeater shows whether it is linked by cable or Wi-Fi. Filtered devices are left out of the map, with the note "N hidden by the filter".
- The topology adds `uplink` per repeater: type, band and signal of its link, from the mesh topology.
- An action whose entity is switched off in Home Assistant shows the known value (access profile, priority) and an **Enable** button, with two or more also **Enable all**. Home Assistant then reloads the integration briefly.

- Side panel, internet page: redesigned. The connection on top with a tinted header, below it side by side the load (large live values for download and upload, the course with a tooltip per point) and the **data volume** (today, 7 and 30 days, bars per day with a tooltip, the ten most used devices as a ranking with their download and upload share).

### Changed

- Side panel: the pages are underlined tabs at the left under the title. The lines of the connection path sit at the same height, with the label below. "Clean up" takes fixed steps (3, 7, 14, 30, 90 days, 1 year) as buttons instead of the slider. The group "No access point" is now "Not assigned".
- Side panel: a device opens as a page of its own instead of a column on the right. Back leads to the list or the map with filter, scroll position and focus; ‹ › or `j`/`k` page through the devices shown. New at the top of the page is the connection path (internet, FRITZ!Box, repeater, device); from 900 px the actions and the master data stand side by side.
- Side panel: instead of a long row of filters there are three fixed ones (All, Online, Offline) and the "More" menu with the other filters and the groups, on a phone as a sheet from the bottom. The row and the radio boxes wrap instead of scrolling sideways.
- Access profile: the built-in profiles of the box come without a name; they are now called "Standard", "Guest" and "Unrestricted" after their type instead of "filtprof1", "filtprof2" and "filtprof3".

## 0.1.0 – 2026-10-25

First version.

### New

- The network devices of the FRITZ!Box as Home Assistant devices, tracked by MAC address. Entity ids never change, the device name follows the name in the box, names you set yourself are kept.
  - Presence, IP address, connection type (LAN/WLAN), access point, "online since" and "last online".
  - Block and allow the internet access per device, Wake on LAN.
  - Optional, off by default: signal strength, link rate, Wi-Fi band, network name and a guest network flag.
  - The FRITZ!Box and its repeaters as devices of their own with model, firmware and the number of connected devices.
- Tidying up: delete offline devices by hand (they stay hidden), filters for the guest network, private MAC addresses and single devices, and an option not to create devices for offline hosts. Repeaters are never filtered.
- Side panel for administrators: the whole network in the sidebar with status filters and counts, search, grouping, radio data per access point and a detail page per device (block internet, priority, access profile, Wake on LAN, rename). Plus groups through Home Assistant labels (filter, grouping, block all, option `label` on the devices card, input "Group" in the schedule blueprint), links to the logbook and the history on the device page, an internet page (connection, addresses, load with a course, DSL line quality with the signal over the frequency, notes on anything unusual, recent events), plus sensors for the connection, the throughput and the DSL line, the port forwardings of the box (view only), an update entity for the firmware of the box, a switch for the guest Wi-Fi, repairs for a line that stays weak or a connection that keeps dropping, notes on the network in the panel (a busy radio, a weakly linked repeater), actions "Reconnect" and "Restart the box" in the panel and events (also in the logbook) for a lost and a new connection and a new external IPv4, bulk clean-up of long-offline devices and the device filter with a preview that shows what would be removed with its entities.
- Dashboard cards: a Wi-Fi card (channel, load, noise and device count per radio of every access point) and a devices card (chosen devices with block or allow internet, Wake on LAN and one button for all). Topology card for the dashboard: the devices by access point at a glance, with online dot, link, signal and a warning for a weak link. A tap on a device opens its page in the side panel, a tap on the heading the overview; search, filters, details and actions are there. It has a visual editor (title, collapsed access points, maximum height, threshold for weak links), loads itself and needs an administrator account.
- More switches and a select, off by default: access profile, priority and automatic Wake on LAN per device. Optional: the vendor from the MAC address, without any network access.
- Actions `set_name` and `wake_on_lan`, an event when a device changes its access point, logbook entries for all events and, optionally, a repair that offers to hide devices that have been offline for long.
- Setup: a new address and a new password without setting up again, a mesh repeater is refused, diagnostics with the poll duration.
