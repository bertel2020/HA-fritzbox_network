<p align="center">
  <img src="https://raw.githubusercontent.com/bertel2020/HA-fritzbox_network/main/custom_components/fritzbox_network/brand/logo.png" alt="FRITZ!Box Netzwerk" width="160">
</p>

<h1 align="center">FRITZ!Box Netzwerk</h1>

<p align="center">
  Die Netzwerkgeräte deiner FRITZ!Box in Home Assistant, geführt über die MAC-Adresse: stabile Entity-IDs, Namen, die der Box folgen, und die wichtigsten Infos und Aktionen pro Gerät.
</p>

<p align="center">
  <a href="https://github.com/hacs/integration"><img src="https://img.shields.io/badge/HACS-Custom-41BDF5.svg" alt="HACS Custom"></a>
  <a href="https://www.home-assistant.io/"><img src="https://img.shields.io/badge/Home%20Assistant-Custom%20Integration-18BCF2.svg?logo=home-assistant&logoColor=white" alt="Home Assistant"></a>
  <a href="https://github.com/bertel2020/HA-fritzbox_network/releases"><img src="https://img.shields.io/github/v/release/bertel2020/HA-fritzbox_network?sort=semver&include_prereleases" alt="Release"></a>
  <a href="https://github.com/bertel2020/HA-fritzbox_network/actions/workflows/tests.yml"><img src="https://github.com/bertel2020/HA-fritzbox_network/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <a href="https://github.com/bertel2020/HA-fritzbox_network/actions/workflows/hassfest.yml"><img src="https://github.com/bertel2020/HA-fritzbox_network/actions/workflows/hassfest.yml/badge.svg" alt="Hassfest"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/bertel2020/HA-fritzbox_network" alt="Lizenz"></a>
</p>

<p align="center">
  <a href="https://buymeacoffee.com/bertel2020"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-FFDD00?logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee"></a>
  <a href="https://ko-fi.com/bertel2020"><img src="https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
  <a href="https://paypal.me/RobertoMartins"><img src="https://img.shields.io/badge/PayPal-donate-00457C?logo=paypal&logoColor=white" alt="PayPal"></a>
</p>

<p align="center"><em><a href="README.en.md">English version</a></em></p>

**FRITZ!Box Netzwerk** zeigt die Geräte deines Heimnetzes so in Home Assistant, wie sie in der FRITZ!Box stehen, und führt jedes Gerät über seine **MAC-Adresse**. Dadurch ändern sich die Entity-IDs nie, auch wenn du ein Gerät in der Box umbenennst; der Gerätename folgt dagegen der Box. Dazu kommen Anwesenheit, Verbindungsdaten und Aktionen wie das Sperren des Internetzugangs.

Die Integration arbeitet lokal mit der FRITZ!Box (TR-064) und baut keine Internetverbindungen auf. Sie ist eine Alternative zum Gerätetracking der Core-Integration „AVM FRITZ!Box Tools“ und wird dafür von Grund auf nach MAC-Adressen geführt.

## Highlights

- **Geräte nach MAC-Adresse**: Ein Home-Assistant-Gerät pro Netzwerkgerät, mit Entity-IDs wie `device_tracker.fritz_3c2af4a1b2c3`. Sie bleiben beim Umbenennen gleich.
- **Namen folgen der Box**: Ändert sich der Name in der FRITZ!Box, ändert sich der Gerätename in Home Assistant mit. Namen, die du selbst vergibst, werden nie überschrieben.
- **Anwesenheit**: Device Tracker mit einstellbarer Wartezeit, bevor ein Gerät als abwesend gilt.
- **Verbindungsdaten pro Gerät**: IP-Adresse, LAN oder WLAN, Access Point und „Zuletzt gesehen“. Optional (standardmäßig aus): Signalstärke, Link-Rate (Download/Upload), WLAN-Band, Netzwerkname und ein Gastnetz-Hinweis.
- **Aktionen**: Internetzugang pro Gerät sperren und freigeben, Wake on LAN.
- **Mesh**: Die FRITZ!Box und ihre Repeater sind eigene Geräte mit Modell, Firmware und der Anzahl der verbundenen Geräte.
- **Aufgeräumt**: Offline-Geräte lassen sich von Hand löschen und bleiben ausgeblendet. Dazu Filter für Gastnetz, private MAC-Adressen und einzelne Geräte, und eine Option, für Offline-Geräte keine Geräte anzulegen.
- **Schonend**: Pro Abfrage nur zwei Anfragen an die FRITZ!Box (Geräteliste und Mesh), nie eine pro Gerät.
- **Einfache Einrichtung**: Neue Adresse oder neues Kennwort ohne Neueinrichtung, Diagnosedaten zum Weitergeben.

## Schnellstart

1. **FRITZ!Box vorbereiten**: TR-064 aktivieren (*Heimnetz → Netzwerk → Netzwerkeinstellungen → „Zugriff für Anwendungen zulassen“*) und einen eigenen Benutzer mit dem Recht „FRITZ!Box Einstellungen“ anlegen (*System → FRITZ!Box-Benutzer*).
2. **Installieren**: Die Integration über den Button in HACS öffnen, herunterladen und Home Assistant neu starten.

   [![HACS-Repository in My Home Assistant öffnen](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=bertel2020&repository=HA-fritzbox_network&category=integration)

3. **Integration hinzufügen**: *Einstellungen → Geräte & Dienste → Integration hinzufügen → FRITZ!Box Netzwerk* oder über den Button.

   [![FRITZ!Box Netzwerk zu My Home Assistant hinzufügen](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=fritzbox_network)

Voraussetzung ist **Home Assistant 2026.8 oder neuer**. Alles Weitere (Installation von Hand, Optionen, Entitäten, Fehlerbehebung) steht in der **[Anleitung](docs/USER-GUIDE.de.md)**.

## Datenschutz in Kürze

- Die Kommunikation mit der FRITZ!Box bleibt im lokalen Netz. Es gibt keine Verbindung ins Internet.
- MAC- und IP-Adressen sowie Gerätenamen stehen als Entitätsattribute in Home Assistant. Wer dort Zugriff hat, sieht sie.
- Die Diagnosedaten entfernen MAC- und IP-Adressen, Namen, Zugangsdaten und die Adresse der Box.

## Mitwirken

Siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Änderungsverlauf

Siehe [CHANGELOG.md](CHANGELOG.md).

## Haftungsausschluss

FRITZ!Box Netzwerk ist ein privat entwickeltes, kostenloses Open-Source-Projekt und wird ohne Gewähr bereitgestellt. Die Nutzung erfolgt auf eigene Gefahr. Die Integration kann Einstellungen in der FRITZ!Box ändern (etwa den Internetzugang eines Geräts sperren). Sie ist ein inoffizielles Projekt und steht in keiner Verbindung zu AVM; FRITZ! und FRITZ!Box sind Marken ihrer Inhaber (siehe [Markenhinweis](docs/USER-GUIDE.de.md#markenhinweis)).

## Lizenz

Dieses Projekt steht unter der [MIT-Lizenz](LICENSE).
Copyright 2026 bertel2020.
