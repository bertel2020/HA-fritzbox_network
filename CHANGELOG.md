# Änderungsverlauf

Alle nennenswerten Änderungen an dieser Integration werden hier festgehalten.

## Unreleased

### Neu

- Seitenpanel: Netzkarte als zweite Ansicht neben der Liste (Umschalter **Liste | Netzkarte**, das Panel merkt sich die Wahl). Die FRITZ!Box und jeder Repeater sind eigene Flächen, die Geräte hängen als Knöpfe mit Initialen an Leitungen für LAN und die WLAN-Bänder. Die Linie zum Repeater zeigt, ob er per LAN oder WLAN angebunden ist. Gefilterte Geräte fehlen in der Karte, mit dem Hinweis „N durch den Filter ausgeblendet“.
- Die Topologie liefert pro Repeater additiv `uplink` mit Art, Band und Signal der Anbindung aus der Mesh-Topologie.
- Eine Aktion, deren Entität in Home Assistant ausgeschaltet ist, zeigt den bekannten Wert (Zugangsprofil, Priorisierung) und den Knopf **Einschalten**, bei zwei oder mehr auch **Alle einschalten**. Danach lädt Home Assistant die Integration kurz neu.

### Geändert

- Seitenpanel: Das Gerät öffnet sich als eigene Seite statt in einer Spalte rechts. Zurück führt in die Liste oder Karte mit Filter, Scrollposition und Fokus; mit ‹ › oder `j`/`k` blätterst du durch die angezeigten Geräte. Neu oben auf der Seite ist der Verbindungsweg (Internet, FRITZ!Box, Repeater, Gerät), ab 900 px stehen Aktionen und Stammdaten nebeneinander.
- Seitenpanel: Statt einer langen Reihe von Filtern gibt es drei feste (Alle, Online, Offline) und das Menü „Mehr“ mit den übrigen Filtern und den Gruppen, auf dem Handy als Blatt von unten. Die Reihe und die Funkbänder brechen um statt waagerecht zu scrollen.

## 0.1.0 – 2026-10-25

Erste Version.

### Neu

- Die Netzwerkgeräte der FRITZ!Box als Home-Assistant-Geräte, geführt über die MAC-Adresse. Die Entity-IDs ändern sich nie, der Gerätename folgt dem Namen in der Box, eigene Namen bleiben erhalten.
  - Anwesenheit, IP-Adresse, Verbindungsart (LAN/WLAN), Access Point, „Online seit“ und „Zuletzt online“.
  - Internetzugang pro Gerät sperren und freigeben, Wake on LAN.
  - Optional, standardmäßig aus: Signalstärke, Link-Rate, WLAN-Band, Netzwerkname und ein Gastnetz-Hinweis.
  - Die FRITZ!Box und ihre Repeater als eigene Geräte mit Modell, Firmware und der Anzahl verbundener Geräte.
- Geräte aufräumen: Offline-Geräte von Hand löschen (sie bleiben ausgeblendet), Filter für Gastnetz, private MAC-Adressen und einzelne Geräte, und eine Option, für Offline-Geräte keine Geräte anzulegen. Repeater werden nie gefiltert.
- Seitenpanel für Administratoren: das ganze Netz in der Seitenleiste mit Statusfiltern und Zähler, Suche, Gruppierung, Funkdaten je Access Point und einer Detailseite pro Gerät (Internet sperren, Priorisierung, Zugangsprofil, Wake on LAN, Umbenennen). Dazu Gruppen über Home-Assistant-Labels (Filter, Gruppierung, Sammel-Sperren, Option `label` an der Geräte-Karte, Eingabe „Gruppe“ im Zeitplan-Blueprint), Links ins Logbuch und in den Verlauf auf der Geräteseite, eine Internet-Seite (Verbindung, Adressen, Auslastung mit Verlauf, bei DSL Leitungsqualität, Hinweise bei Auffälligkeiten, letzte Ereignisse), dazu Sensoren für Verbindung, Durchsatz und DSL-Leitung und Ereignisse (auch im Logbuch) für verlorene und neue Verbindung und neue externe IPv4, das Aufräumen langer Offline-Geräte in einem Zug und der Gerätefilter mit Vorschau, die zeigt, was samt Entitäten entfernt würde.
- Dashboard-Karten: eine Funk-Karte (Kanal, Auslastung, Rauschen und Gerätezahl pro Funkmodul jedes Access Points) und eine Geräte-Karte (ausgewählte Geräte mit Internet sperren oder freigeben, Wake on LAN und einem Knopf für alle). Topologie-Karte für das Dashboard: die Geräte nach Access Point auf einen Blick, mit Online-Punkt, Verbindung, Signal und Warnung bei schwacher Verbindung. Ein Tipp auf ein Gerät öffnet dessen Seite im Seitenpanel, ein Tipp auf die Überschrift die Übersicht; Suche, Filter, Details und Aktionen gibt es dort. Sie hat einen visuellen Editor (Titel, zugeklappte Access Points, maximale Höhe, Schwelle für schwache Verbindungen), lädt sich selbst und braucht ein Administratorkonto.
- Weitere Schalter und Auswahl, standardmäßig aus: Zugangsprofil, Priorisierung und automatisches Wake on LAN pro Gerät. Optional der Hersteller aus der MAC-Adresse, ohne Netzwerkzugriff.
- Aktionen `set_name` und `wake_on_lan`, Ereignis beim Wechsel des Access Points, Logbuch-Einträge für alle Ereignisse und optional eine Reparatur, die lange offline Geräte zum Ausblenden anbietet.
- Einrichtung: neue Adresse und neues Kennwort ohne Neueinrichtung, ein Mesh-Repeater wird abgewiesen, Diagnosedaten mit Abfragedauer.
