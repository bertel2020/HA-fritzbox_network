# Änderungsverlauf

Alle nennenswerten Änderungen an dieser Integration werden hier festgehalten.

## 0.1.0 – 2026-10-25

Erste Version.

### Neu

- Die Netzwerkgeräte der FRITZ!Box als Home-Assistant-Geräte, geführt über die MAC-Adresse. Die Entity-IDs ändern sich nie, der Gerätename folgt dem Namen in der Box, eigene Namen bleiben erhalten.
  - Anwesenheit, IP-Adresse, Verbindungsart (LAN/WLAN), Access Point, „Online seit“ und „Zuletzt online“.
  - Internetzugang pro Gerät sperren und freigeben, Wake on LAN.
  - Optional, standardmäßig aus: Signalstärke, Link-Rate, WLAN-Band, Netzwerkname und ein Gastnetz-Hinweis.
  - Die FRITZ!Box und ihre Repeater als eigene Geräte mit Modell, Firmware und der Anzahl verbundener Geräte.
- Geräte aufräumen: Offline-Geräte von Hand löschen (sie bleiben ausgeblendet), Filter für Gastnetz, private MAC-Adressen und einzelne Geräte, und eine Option, für Offline-Geräte keine Geräte anzulegen. Repeater werden nie gefiltert.
- Topologie-Karte für das Dashboard: die Geräte nach Access Point, mit Suche, Filtern und Signal. Sie hat einen visuellen Editor (Titel, Start-Filter, zugeklappte Access Points, maximale Höhe, Schwelle für schwache Verbindungen und mehr), lädt sich selbst und braucht ein Administratorkonto.
- Weitere Schalter und Auswahl, standardmäßig aus: Zugangsprofil, Priorisierung und automatisches Wake on LAN pro Gerät. Optional der Hersteller aus der MAC-Adresse, ohne Netzwerkzugriff.
- Aktionen `set_name` und `wake_on_lan`, Ereignis beim Wechsel des Access Points, Logbuch-Einträge für alle Ereignisse und optional eine Reparatur, die lange offline Geräte zum Ausblenden anbietet.
- Einrichtung: neue Adresse und neues Kennwort ohne Neueinrichtung, ein Mesh-Repeater wird abgewiesen, Diagnosedaten mit Abfragedauer.
