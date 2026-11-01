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
- [Topology card](#topology-card) with the [Wi-Fi card](#wi-fi-card) and the [devices card](#devices-card)
- [Side panel](#side-panel)
- [Blueprints](#blueprints)
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
| Notify about devices offline for long | off | A repair lists the devices that have been offline longer than the days below and offers to hide them. Nothing is hidden without your choice. Devices without a time on record are left out. Checked every hour, the first time a minute after the start. Dismiss the repair and it stays quiet. |
| Days offline before a device counts as gone | 30 (7–365) | Only used with the option above. |
| Show the vendor of a device | off | The vendor comes from the MAC address, from a list that ships with Home Assistant; nothing is sent anywhere. It shows as the manufacturer of the device, in the new device event (`vendor`) and in the topology card. Private (randomized) addresses have none. Turning it off does not remove a manufacturer already entered. |
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
| Sensor | Online since | on | Timestamp of going online; unknown while the device is offline. Changes only when going online and survives a restart |
| Sensor | Last online | on | Timestamp of the last poll that saw the device; unknown while it is online. Changes only when going offline and survives a restart |
| Switch | Internet access | on | On = may use the internet. Only with the right "FRITZ!Box settings" and only for devices with an IPv4 address. The box sometimes reports the change only after about a minute; the switch shows it at once until then. |
| Switch | Automatic Wake on LAN | off | On = the box wakes the device itself when something from the network wants to reach it. Not for devices known to be on Wi-Fi. The setting is not in the host list: every enabled switch asks the box on its own every 10 minutes, one after the other. The action is not verified against every firmware yet |
| Switch | Priority | off | On = the router prefers the device when the line is busy. Only with the right. Set by IPv4 address like the internet access. The names of the action's arguments are read from the description the box gives, the action itself is not verified against every firmware yet |
| Select | Access profile | off | The access profile of the box the device is in, for example "Kids". Only with the right and when the box lists profiles. Set by IPv4 address like the internet access; the profile names are read from the box every 20th poll. The box layout of the list is not verified against every firmware yet |
| Button | Refresh | on | On the box device: polls the box now instead of at the next interval |
| Button | Wake on LAN | off | Only with the right; not for devices known to be on Wi-Fi |
| Binary sensor | Guest network | on for guest devices only | Diagnostic |
| Sensor | Signal strength | off | in dBm, Wi-Fi devices only; how the access point sees the device |
| Sensor | Link rate download / upload | off | in Mbit/s, from the device's point of view |
| Sensor | Wi-Fi band | off | 2.4 / 5 / 6 GHz |
| Sensor | Network name (SSID) | off | |

Signal strength, link rate, band and SSID come from the mesh data of the box, without an extra request. They are created only for devices the box knows a connection for, and are diagnostic entities.

### Box and repeaters

The FRITZ!Box and every repeater are devices of their own with model and firmware. Each has the sensor **Connected devices** (the number of devices connected to that access point). A repeater is also its entry in the host list, so it is a single device.

The FRITZ!Box device also counts the devices of your network (after the filters): **Devices online**, **Devices offline** and **Devices total**. Online follows the presence of the device trackers, including the consider-home time.

The box and every repeater also have diagnostic sensors for each of their Wi-Fi bands, off by default: **Channel**, **Channel utilization** (in percent, as the box reports it) and **Noise** (in dBm). They answer "why is the Wi-Fi bad tonight": a busy channel or a high noise level at the access point the device sits on. The guest network shares the radio and is not listed twice. They come from the mesh data that is polled anyway, so they cost no extra request.

The box also has sensors for its **internet connection** once it reports one: the connection state (binary sensor "Internet connection") and the **throughput** for download and upload in Mbit/s, both on by default so the history in Home Assistant is there from the start. The throughput is worked out from the byte counters of the box between two updates. Off by default are the connection time, the external IPv4 address and, on DSL, line rate, noise margin, attenuation and FEC and CRC errors, each for download and upload. They let you build automations ("the address changed", "noise margin below 8 dB") and look at the course over days. They cost no extra request, the values come from the read behind the internet page.

The box device also has three diagnostic, off by default: **Last update** (the last successful poll), **Failed polls** (how many polls in a row failed) and **Mesh status** (whether the mesh topology came with the last poll). They stay available while the box cannot be reached.

### Actions

Both need the right "FRITZ!Box settings" and take a device, an entity or an area as the target.

| Action | What it does |
|--------|--------------|
| `fritzbox_network.set_name` | Renames the device in the FRITZ!Box itself (`name`). The name in Home Assistant follows if names are taken over; entity ids never change. Refused for devices whose name the box does not let change. |
| `fritzbox_network.wake_on_lan` | Sends the Wake on LAN signal of the box to the device, without the (off by default) button. |

### Events

When a device is renamed in the box, Home Assistant fires the event `fritzbox_network_device_renamed` with `mac`, `old_name` and `new_name`.

When the box lists a device it did not list before, Home Assistant fires the event `fritzbox_network_new_device` with `mac`, `name`, `ip` and `vendor` (empty unless the vendor option is on). Use it to be notified about new devices in your network. What the box lists at startup is not new, so devices that joined while Home Assistant was down are not announced, and neither are devices a filter excludes.

When a device moves to another access point (the box or a repeater), Home Assistant fires `fritzbox_network_device_roamed` with `mac`, `name`, `old_ap`, `old_ap_mac`, `new_ap`, `new_ap_mac`, `link_type`, `band` and `signal_dbm`. The new access point has to show in two polls in a row, so a device that flaps between two does not fire on every poll; with the default interval a very short visit is missed. Seeing a device for the first time is not roaming. Use it for presence by room: the access point of a repeater tells where in the house a phone is.

The internet connection fires `fritzbox_network_internet_disconnected` when the box loses it, `fritzbox_network_internet_reconnected` when it is set up again (also when the box reconnected between two polls, which the online time shows) and `fritzbox_network_internet_ip_changed` with `old_ip` and `new_ip` when the external IPv4 address changes. They also show in the logbook, without the addresses. The first reading after Home Assistant starts fires nothing.

All three events also show in the **Logbook** (for example "phone moved from FRITZ!Repeater to FRITZ!Box") and in the history of the device's tracker. To see the raw data, listen to the event name under **Tools → Events**.

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

## Topology card

The integration ships a dashboard card that shows at a glance who hangs on which access point: the box and every repeater as a group, the devices below with an online dot, Wi-Fi or LAN and signal. Online devices come first. Search, filters, details and actions live in the [side panel](#side-panel): a tap on a device opens its page there, a tap on the heading opens the overview.

Add it in the dashboard editor under **Add card → FRITZ!Box Network topology**, or in YAML:

```yaml
type: custom:fritzbox-network-topology-card
title: Network
```

| Option | Meaning |
|--------|---------|
| `title` | Heading of the card |
| `entry_id` | Only needed with more than one box: the id of the config entry |
| `collapsed` | `true`: the access points start collapsed (default `false`) |
| `max_height` | Maximum height of the list in pixels, it scrolls beyond that; 0 or empty: no limit |
| `weak_threshold` | Weak link below this percentage of the highest rate (1–99, default 33) |

All options are also in the visual editor of the card. The options `default_filter`, `compact`, `hide_vendor`, `hide_rate`, `hide_signal`, `hide_radio` and `tap_action` of an earlier version are gone; existing cards still load, the values are ignored.

A device is on a weak link when it is online and its current rate is below a third (adjustable with `weak_threshold`) of the highest rate its link can do, in one direction or the other; the card marks it with a warning icon that shows the percentage. A device that is idle can run at a lower rate for a while, so read the mark as a hint, not as a fault. The numbers next to an access point are shown / total. Devices the box does not assign to an access point are listed at the end. Without a mesh topology there are no access points and all devices sit in that group. Channel and load of the radios are in the [Wi-Fi card](#wi-fi-card), actions like block internet in the [devices card](#devices-card).

The card needs an administrator account because it shows MAC and IP addresses. It loads automatically, a hard refresh of the browser after the update brings the new version.

### Wi-Fi card

The Wi-Fi card shows, per access point and band, the channel, the load as a bar (in the warning color from 70 %), the noise and the number of devices that are online on that band right now. It shows which radio is overloaded or sits on a noisy channel. The data come from the mesh topology of the box; you do not have to enable the radio sensors.

```yaml
type: custom:fritzbox-network-radio-card
```

| Option | Meaning |
|--------|---------|
| `title` | Heading of the card |
| `entry_id` | Only needed with more than one box: the id of the config entry |
| `hide_noise` | Hide the noise (default `false`) |
| `hide_clients` | Hide the number of devices (default `false`) |

The box does not report load and noise for every band; missing values stay empty. Without a mesh topology the card says that the box reports no radio data.

### Devices card

The devices card shows chosen devices with status, access point, link rate and signal, and the actions **block or allow internet**, priority and Wake on LAN. With two or more devices that have an internet switch there is one more button that blocks them all at once (when all may go online) or allows them (otherwise the blocked ones). The actions are the same switches and buttons as on the device and need the same "FRITZ!Box settings" permission; an action only shows when its entity exists and is enabled.

```yaml
type: custom:fritzbox-network-device-card
title: Kids
entities:
  - device_tracker.fritz_3c2af4a1b2c3
  - device_tracker.fritz_3c2af4a1b2c4
```

| Option | Meaning |
|--------|---------|
| `entities` | The device trackers of the devices, in the order of the card. A picker in the editor. A device that no longer exists shows as "Unknown device" |
| `title` | Heading of the card |
| `label` | A group (label): also shows every device of that group, also ones added later |
| `entry_id` | Only needed with more than one box |
| `hide_rate`, `hide_signal` | Hide the rate or the signal (default `false`) |

A tap on the name opens the device. Both cards need an administrator account like the topology card and load themselves.

## Side panel

The integration adds a **FRITZ!Box Network** entry to the sidebar. It shows the whole network on one page and is only visible to administrators. The panel gets its data over the same connection as the dashboard cards and does not query the box additionally.

**Network.** At the top are the search (name, IP, MAC or vendor; the `/` key jumps into it), a choice each for sorting (name, signal, rate, last online) and grouping (access point, band / LAN, group, flat) and the switch **List | Network map**. The panel remembers the view you chose last in this browser; the first time it shows the list. Search, filters and groups apply to both views, sorting and grouping only to the list.

Below are the filters: **All**, **Online** and **Offline** as fixed buttons with the number of devices, plus **More ▾**. The menu holds the other filters (Wi-Fi, LAN, Guest, Blocked, Weak link, New (7 days), Long offline, No access point) and the groups, each with a count; filters with no match stay away. It works with the arrow keys and Esc, and on a phone it opens as a sheet from the bottom. A filter chosen in the menu stands as a button of its own with ×; a tap on it shows all again. The row wraps when it must and never scrolls sideways.

In the **list** every access point is a card with a summary ("1 Wi-Fi · 3 LAN · min. 52 Mbit/s"), channel, load and noise of its radios and the devices. Online devices come first.

The **network map** shows the internet at the top, the FRITZ!Box below as a wide area and every repeater below that as an area of its own. The line from the box to a repeater is solid when it is linked by cable, dashed for Wi-Fi (with band and signal) and dotted when the box does not say. In every area the devices hang as buttons with their initials on lines for LAN and the Wi-Fi bands, drawn the same way. Green means online, dashed grey offline, orange with "!" a weak link, red with ⦸ internet blocked; a cable device is square, a Wi-Fi device round, and a small bar shows the signal. Devices the filter hides are left out of the map, and the area then says "N hidden by the filter". "Hide names" makes the map denser, "Read as list" switches to the list. On a phone the areas stand below each other and the lines run down the left as a trunk; the map can be read without zooming.

- **New (7 days)** and **Long offline** (30 days) are only known to Home Assistant: "New" counts from when the device was created in Home Assistant, "Long offline" only counts devices whose last time online is known. After a fresh install everything is new at first.
- **Blocked** means the box reports no internet access for the device. When it reports nothing, the device does not count as blocked.

**Internet.** In the network map the internet is a button with its state (green dot: connected) and the current throughput. A tap opens the page `#/internet` (back or Esc returns to the map):

- **Connection:** connected or disconnected, access type (DSL, cable …), time online, external IPv4, IPv6 prefix, DNS servers and the last error.
- **Load now** as a bar against the line rate, and a course of the last hours. The box does not report the throughput itself: the panel works it out from the byte counters of the box between two updates, so the first rate shows after the second update. The course is kept in the memory of Home Assistant and starts again after a restart.
- **Line quality** (DSL only): line rate and what the line could do, noise margin, attenuation and the errors since synchronisation (FEC, CRC) and a chart of the signal over the frequency for download and upload. The height is relative; gaps are bands the line does not use, dips point at interference on a frequency. If the noise margin falls or the errors rise, the line is the cause, not a device.
- **Notes** at the top of the page when something stands out: no connection, a noise margin below 10 dB (below 6 dB as serious), three or more new connections in 24 hours and a line that was full in the last measurements.
- **Actions:** **Reconnect** (the box hangs up and dials in again, usually with a new external IPv4) and **Restart the box**. Both interrupt the network and ask first in a dialog; they need the right "FRITZ!Box settings" and are deliberately only in the panel, not a switch or button in Home Assistant, so an automation cannot cut your network by accident. After a restart the panel shows the data of the box again in a few minutes.
- **Recent events:** connection lost or set up again and a new external IPv4. The integration notices them itself and keeps the last 20 since it started; they do not go to the logbook.

Which values the box gives depends on the model and the connection; what it does not report is missing on the page. The access type is named (DSL, Ethernet, fibre, cable, mobile), an unknown one as the box writes it. It was developed and tested on a DSL box; on cable, fibre and mobile the page shows the connection, addresses, throughput and the rate of the link, and the line quality section is DSL only. `tools/spike_wan.py` reads what a box reports about it, read-only; if something is missing on your connection, its output (`spike_out/wan.txt`, addresses masked) helps in an issue. The integration reads three small values more per update for this (status and two byte counters), addresses and line only every ten updates or right after a new connection. If the connection is missing altogether, the node stays a plain word.

**Device.** A tap on a device opens its page (address `#/device/<MAC without colons>`, the back button of the browser works). It takes the place of the list or the map, on every screen width. The button at the top left is named after the view you came from ("List" or "Network map") and takes you back there, with the same filter, the same scroll position and the focus on the device; Esc does the same. With ‹ › or the keys `j` and `k` you page through the devices shown there ("20 / 79"). At the top is the **connection path** (internet → FRITZ!Box → repeater → device, with lines as in the map), below it rate, highest rate, signal and band (the port for LAN). From 900 px wide the actions and the master data stand side by side. "In the network map" shows the device marked in the map. The actions:

| Action | Note |
|--------|------|
| Internet access | Switch, without a question: blocking and allowing can be undone at any time |
| Priority | Switch |
| Access profile | Choice among the profiles of the box, when the box supplies profiles |
| Wake on LAN | only for devices that are offline |
| Rename | Dialog; calls the `set_name` action |
| In Home Assistant | opens the device in the settings |

An action is off and says why when the box user lacks the "FRITZ!Box settings" right or the device has no IPv4 address. When its entity is switched off in Home Assistant (access profile and priority are off by default), the row still shows the value the box reports, with "Off in Home Assistant" and an **Enable** button. With two or more of them there is **Enable all** at the top. It switches the entities on without asking (you can undo it in the entity settings at any time); Home Assistant then reloads the integration after about 30 seconds, and until then the row says "Being enabled". With more than one box you pick the box at the top right.

**Groups.** A group is a Home Assistant **label**, put on the "Internet access" switch of the device (not on the device: a label on the device would also reach the priority switch). On the device page you set groups with a tap or make a new one; the label is then also visible and usable in Home Assistant itself. In the network every group with devices appears in the "More" menu as a filter with a count and as the grouping "Group". While a group is the filter, a button at the top says **Block all** (when all may go online) or **Allow all** (otherwise the blocked ones): it names the devices first, and the server switches exactly those switches, not "everything with the label". The same group works in the devices card (option `label`) and in the schedule blueprint (input "Group"). A device without the "Internet access" entity cannot be in a group.

**History.** The device page has two buttons that lead to the logbook and the history of Home Assistant for the device. Roaming and the times online are there. The panel keeps no history of its own: signal and rate only have one if you enable their sensors in the device settings (they are off by default).

**Clean up.** The box remembers every device it has ever seen. Here are the offline devices whose last time online is known, with a slider for the days (preset with the option "Days offline until a device counts as gone", 7 to 365). Pick devices or all of them and tap "Hide N devices": a dialog names the devices and the consequences, and only then are they hidden and removed from Home Assistant with their entities. The server refuses online devices, the box and repeaters, even if the panel offered them. Below is the **Hidden** list with "Show again", which reloads the integration. It is the same list as the hidden devices in the options and the repair for long-offline devices.

**Filter.** The device filter of the options (all devices, only selected, all except selected, ignore guest network and private MAC addresses) with a **preview**: it shows which devices stay, come back or are **removed with their entities** before anything is written. "Apply filter" asks again with the names of the devices that disappear. The panel sends the list you saw: if it changed meanwhile (a device went online, the box lists another one), the server writes nothing and you see the new preview. Removed devices lose their own names, their entity ids and their history; references in automations then point nowhere. "Do not create devices for offline devices" stays in the options only.

The panel follows the look of the author's other panels, follows the light and dark theme of Home Assistant and needs no sideways scrolling down to 360 px wide.

## Blueprints

Two automation blueprints ship with the integration. Import them with the buttons; they appear under **Settings → Automations & scenes → Blueprints**.

| Blueprint | What it does | Import |
|-----------|--------------|--------|
| New device notification | Sends a notification for every `fritzbox_network_new_device` event | [![Import new device notification](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https://github.com/bertel2020/HA-fritzbox_network/blob/main/blueprints/automation/fritzbox_network/new_device_notification.yaml) |
| Internet access schedule | Blocks the internet access of devices at one time and allows it at another, on chosen days | [![Import internet access schedule](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https://github.com/bertel2020/HA-fritzbox_network/blob/main/blueprints/automation/fritzbox_network/internet_schedule.yaml) |

The schedule needs the right "FRITZ!Box settings". If the address of a device changed since the last update, that device is not switched and the run reports an error. Nothing happens at startup, so a restart during the blocked period leaves the access as it is. Instead of single devices you can choose a **group** (a label on the "Internet access" switches); the schedule then covers every switch with that label, also ones added later.

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
| Internet access cannot be switched | The device needs an IPv4 address; IPv6-only devices cannot be blocked. The box blocks by address: if the address changed since the last update, the switch refuses and works again after the next update |
| A device appears twice | It has two MAC addresses (LAN and WLAN), or a private MAC has changed; delete the extra device or hide it with the filter |
| Too many entities | Turn on "Do not create devices for offline hosts", use the filter |

For detailed messages search **Settings → System → Logs** for `fritzbox_network`. With log level `debug` for `custom_components.fritzbox_network` the duration of every poll shows up.

## Development and tests

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/ruff check custom_components tests tools
.venv/bin/pytest
node --test tests/js/*.test.mjs
```

The last line tests the logic of the topology card and needs Node.js.

The tests run against a fake client with anonymised captures of a FRITZ!Box (`tests/fixtures/`). `tools/spike.py` reads a real box without changing anything (host list, mesh, a few services); the credentials come from the environment variables `FRITZ_HOST`, `FRITZ_USER`, `FRITZ_PASSWORD` and optionally `FRITZ_TLS=1`. It writes to `spike_out/` (not in the repository).

How to contribute is described in [CONTRIBUTING.md](../CONTRIBUTING.md).
