<p align="center">
  <img src="https://raw.githubusercontent.com/bertel2020/HA-fritzbox_network/main/custom_components/fritzbox_network/brand/logo.png" alt="FRITZ!Box Network" width="160">
</p>

<h1 align="center">FRITZ!Box Network</h1>

<p align="center">
  The network devices of your FRITZ!Box in Home Assistant, tracked by MAC address: stable entity ids, names that follow the box, and the most useful info and actions per device.
</p>

<p align="center">
  <a href="https://github.com/hacs/integration"><img src="https://img.shields.io/badge/HACS-Custom-41BDF5.svg" alt="HACS Custom"></a>
  <a href="https://www.home-assistant.io/"><img src="https://img.shields.io/badge/Home%20Assistant-Custom%20Integration-18BCF2.svg?logo=home-assistant&logoColor=white" alt="Home Assistant"></a>
  <a href="https://github.com/bertel2020/HA-fritzbox_network/releases"><img src="https://img.shields.io/github/v/release/bertel2020/HA-fritzbox_network?sort=semver&include_prereleases" alt="Release"></a>
  <a href="https://github.com/bertel2020/HA-fritzbox_network/actions/workflows/tests.yml"><img src="https://github.com/bertel2020/HA-fritzbox_network/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <a href="https://github.com/bertel2020/HA-fritzbox_network/actions/workflows/hassfest.yml"><img src="https://github.com/bertel2020/HA-fritzbox_network/actions/workflows/hassfest.yml/badge.svg" alt="Hassfest"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/bertel2020/HA-fritzbox_network" alt="License"></a>
</p>

<p align="center">
  <a href="https://buymeacoffee.com/bertel2020"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-FFDD00?logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee"></a>
  <a href="https://ko-fi.com/bertel2020"><img src="https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
  <a href="https://paypal.me/RobertoMartins"><img src="https://img.shields.io/badge/PayPal-donate-00457C?logo=paypal&logoColor=white" alt="PayPal"></a>
</p>

<p align="center"><em><a href="README.md">Deutsche Version</a></em></p>

**FRITZ!Box Network** shows the devices of your home network in Home Assistant the way they are listed in the FRITZ!Box, and tracks every device by its **MAC address**. That is why entity ids never change, even when you rename a device in the box; the device name, on the other hand, follows the box. On top of that you get presence, connection data and actions such as blocking a device's internet access.

The integration works locally with the FRITZ!Box (TR-064) and makes no connections to the internet. It is an alternative to the device tracking of the core integration "AVM FRITZ!Box Tools", built from the ground up around MAC addresses.

## Highlights

- **Devices by MAC address**: One Home Assistant device per network device, with entity ids like `device_tracker.fritz_3c2af4a1b2c3`. They stay the same when a device is renamed.
- **Names follow the box**: When the name changes in the FRITZ!Box, the device name in Home Assistant changes with it. Names you set yourself are never overwritten.
- **Presence**: Device tracker with an adjustable wait before a device counts as away.
- **Connection data per device**: IP address, LAN or Wi-Fi, access point and "last seen". Optional (off by default): signal strength, link rate (download/upload), Wi-Fi band, network name and a guest network flag.
- **Actions**: Block and allow the internet access per device, Wake on LAN.
- **Mesh**: The FRITZ!Box and its repeaters are devices of their own with model, firmware and the number of connected devices.
- **Tidy**: Offline devices can be deleted by hand and stay hidden. Plus filters for the guest network, private MAC addresses and single devices, and an option not to create devices for offline hosts.
- **Gentle**: Only two requests to the FRITZ!Box per poll (host list and mesh), never one per device.
- **Easy setup**: A new address or a new password without setting up again, diagnostics to share.

## Quick start

1. **Prepare the FRITZ!Box**: Enable TR-064 (*Home Network → Network → Network Settings → "Allow access for applications"*) and create a dedicated user with the right "FRITZ!Box settings" (*System → FRITZ!Box Users*).
2. **Install**: Open the integration in HACS with the button, download it and restart Home Assistant.

   [![Open the HACS repository in My Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=bertel2020&repository=HA-fritzbox_network&category=integration)

3. **Add the integration**: *Settings → Devices & services → Add integration → FRITZ!Box Network* or with the button.

   [![Add FRITZ!Box Network to My Home Assistant](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=fritzbox_network)

**Home Assistant 2026.8 or newer** is required. Everything else (manual installation, options, entities, troubleshooting) is covered in the [user guide](docs/USER-GUIDE.md).

## Privacy in short

- Communication with the FRITZ!Box stays on your local network. There is no connection to the internet.
- MAC and IP addresses and device names appear as entity attributes in Home Assistant; whoever has access there can see them.
- The diagnostics remove MAC and IP addresses, names, credentials and the address of the box.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Changelog

See [CHANGELOG.en.md](CHANGELOG.en.md).

## Disclaimer

FRITZ!Box Network is a privately developed, free open-source project provided without warranty. Use is at your own risk. The integration can change settings in the FRITZ!Box (for example block a device's internet access). It is an unofficial project and not affiliated with AVM; FRITZ! and FRITZ!Box are trademarks of their owners (see [trademark notice](docs/USER-GUIDE.md#trademark-notice)).

## License

This project is released under the [MIT License](LICENSE).
Copyright 2026 bertel2020.
