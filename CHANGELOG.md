# Changelog

## Unreleased

### Neu

- Netzwerkgeräte der FRITZ!Box als Home-Assistant-Geräte, geführt über die MAC-Adresse.
  - Anwesenheit, IP-Adresse, Verbindungsart, Access Point und „Zuletzt gesehen“.
  - Internetzugang sperren und freigeben, Wake on LAN.
  - Der Gerätename folgt dem Namen in der FRITZ!Box, eigene Namen bleiben erhalten.
  - Offline-Geräte lassen sich von Hand löschen und bleiben dann ausgeblendet.
  - Optionen für Intervall, Anwesenheit, Gastnetz, private MACs, Gerätefilter.
  - Geräte, die ein Filter ausschließt, werden entfernt. Repeater werden nie gefiltert.
- Option, für Offline-Geräte keine Geräte anzulegen; sie entstehen, sobald das Gerät online kommt.
- Die Verbindung (Adresse, Port, TLS) lässt sich nachträglich ändern, etwa wenn die FRITZ!Box eine neue IP hat.
- Beim Einrichten wird ein Mesh-Repeater abgewiesen, weil nur der Mesh-Master alle Geräte kennt.
- Die FRITZ!Box und ihre Repeater sind eigene Geräte mit Modell, Firmware und der Anzahl verbundener Geräte; der Repeater ist zugleich der Eintrag in der Geräteliste.
- Hinweis „Gastnetz“ pro Gerät; er ist nur für Geräte im Gastnetz von Anfang an aktiv.
- Die Diagnose zeigt die Dauer der letzten und der langsamsten Abfrage.
- Optional (standardmäßig aus): Signalstärke, Link-Rate, WLAN-Band und Netzwerkname je Gerät, auch am Repeater.

### Behoben

- „Zuletzt gesehen“ bleibt nach einem Neustart erhalten, auch für Geräte, die online geblieben sind.
- Der Schalter für den Internetzugang zeigt die Änderung sofort an, auch wenn die FRITZ!Box sie erst nach einer Minute meldet, und Freigeben eines nicht gesperrten Geräts ist kein Fehler mehr.
