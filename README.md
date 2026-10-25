# FRITZ!Box Netzwerk

Home-Assistant-Integration für die Netzwerkgeräte einer AVM FRITZ!Box. Jedes Gerät
wird über seine **MAC-Adresse** geführt: Die Entity-IDs ändern sich nie, und der
Name folgt automatisch dem Namen in der FRITZ!Box.

[English version](README.en.md)

## Funktionen

- Ein Gerät pro Netzwerkgerät, mit Anwesenheit (Device Tracker), IP-Adresse,
  Verbindungsart (LAN/WLAN), Access Point und „Zuletzt gesehen“.
- Entity-IDs nach MAC, z. B. `device_tracker.fritz_3c2af4a1b2c3` und
  `sensor.fritz_3c2af4a1b2c3_ip_address`. Sie bleiben beim Umbenennen gleich.
- Ändert sich der Name in der FRITZ!Box, ändert sich der Gerätename in Home
  Assistant mit. Namen, die du selbst in Home Assistant vergibst, bleiben erhalten.
- Internetzugang pro Gerät sperren oder freigeben, Wake on LAN (Button, standardmäßig
  deaktiviert).
- Geräte lassen sich von Hand löschen, wenn sie offline sind. Gelöschte Geräte
  bleiben ausgeblendet und lassen sich in den Optionen wieder einblenden.
- Filter für Gastnetz-Geräte, Geräte mit privater MAC-Adresse und eine Auswahl
  einzelner Geräte.
- Die FRITZ!Box wird pro Abfrage nur zweimal gefragt (Geräteliste und Mesh),
  nie einmal pro Gerät.

## Installation

### Über HACS (empfohlen)

[![HACS-Repository in My Home Assistant öffnen](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=bertel2020&repository=HA-fritzbox_network&category=integration)
[![FRITZ!Box Netzwerk zu My Home Assistant hinzufügen](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=fritzbox_network)

1. Über den ersten Button das FRITZ!Box-Netzwerk-Repository in HACS öffnen.
2. **FRITZ!Box Netzwerk** herunterladen und Home Assistant neu starten.
3. Über den zweiten Button die Integration hinzufügen. Alternativ in Home
   Assistant **Einstellungen → Geräte & Dienste → Integration hinzufügen →
   FRITZ!Box Netzwerk** öffnen.

Falls der erste Button nicht funktioniert, in HACS unter **Integrationen →
Benutzerdefinierte Repositories** `https://github.com/bertel2020/HA-fritzbox_network`
als Kategorie **Integration** eintragen.

### Manuell

Das Verzeichnis `custom_components/fritzbox_network` nach
`/config/custom_components/fritzbox_network` kopieren und Home Assistant neu
starten.

## Einrichtung

1. In der FRITZ!Box unter **Heimnetz → Netzwerk → Netzwerkeinstellungen** den
   **Zugriff für Anwendungen zulassen** aktivieren (TR-064).
2. Unter **System → FRITZ!Box-Benutzer** einen eigenen Benutzer mit dem Recht
   **FRITZ!Box Einstellungen** anlegen, ohne Zugriff aus dem Internet.
   Ohne dieses Recht werden die Geräte angezeigt, aber die Schalter für den
   Internetzugang und die Wake-on-LAN-Buttons fehlen; ein Hinweis unter
   **Einstellungen → Reparaturen** erklärt das.
3. Die Integration hinzufügen und die Zugangsdaten eingeben.

## Hinweise

- **Parallel zur Core-Integration „AVM FRITZ!Box Tools“** ist möglich, wird aber nicht
  empfohlen: Beide melden dieselben Geräte und fragen die Box doppelt ab. Schalte im
  Core das Gerätetracking aus oder entferne die Core-Integration.
- Die Box merkt sich auch Geräte, die lange offline sind. Sie werden alle angelegt;
  mit dem Gerätefilter oder dem Löschen von Hand hältst du die Liste klein.
- Ein Laptop mit LAN und WLAN steht in der Box zweimal (zwei MACs) und ist hier
  deshalb zwei Geräte.
- Den Internetzugang kann die Box nur für Geräte mit IPv4-Adresse sperren.

## Optionen

Abfrageintervall, Anwesenheit nach dem Offline-Gehen, Namen übernehmen, Gastnetz
und private MACs ignorieren, Gerätefilter und die Liste der ausgeblendeten Geräte.
