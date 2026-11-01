# Seitenpanel v2: Netzkarte, Filter, Gerät als Vollseite

Stand: 2026-11-01. Klickbares Mockup: [panel-v2-mockup.html](panel-v2-mockup.html) (oben umschaltbar: Netzkarte 1/2, 25 oder 79 Geräte, Desktop/Handy, Hell/Dunkel). Anlass sind deine Rückmeldungen aus dem Betrieb (79 Geräte, 3 Access Points).

## Entscheidungen

Geprüft habe ich drei Grundlayouts: **A** zwei Spalten, die jeweils für sich scrollen, **B** eine Schublade rechts (auf dem Handy ein Blatt von unten) und **C** das Gerät als eigene Seite. Du hast dich für C und das „Mehr“-Menü entschieden. A hätte das Scroll-Problem gelöst, braucht aber eine feste Panelhöhe und ist auf dem Handy wieder C. B zeigt mehr Kontext, kostet aber Fokus-Käfig, Overlays im Shadow DOM und zwei Scroll-Bereiche.

## Wie die vier Punkte gelöst sind

1. **Detail nicht erreichbar:** `#/device/<id>` öffnet eine eigene Seite statt der Spalte rechts, auch auf dem Desktop. Die Seite scrollt normal, alles ist erreichbar. Ab 900 px stehen Aktionen und Stammdaten nebeneinander, darunter liegt die Verbindung über die ganze Breite. Der Zurück-Knopf heißt wie die Herkunft („Netzkarte“ oder „Liste“). Zurück stellt Filter, Ansicht und Scrollposition wieder her und setzt den Fokus auf das zuletzt geöffnete Gerät. Mit ‹ › oder j/k blätterst du durch die gefilterte Liste („20 / 79“). Neu ist der Abschnitt **Verbindungsweg** (Internet → FRITZ!Box → Repeater → Gerät, Linien wie in der Karte) mit dem Knopf „In der Netzkarte“, der das Gerät in der Karte hervorhebt.
2. **Zugangsprofil leer:** Eine Aktion mit ausgeschalteter Entität zeigt trotzdem den bekannten Wert, also `filter_profile` und `priority` aus der Subscription, dazu „Ausgeschaltet in Home Assistant“ und den Knopf **Einschalten**. Sind es zwei oder mehr, erscheint oben „N Aktionen sind ausgeschaltet · Alle einschalten“. Das Einschalten läuft über `config/entity_registry/update` mit `disabled_by: null` (Admin, Core-API, kein eigenes Backend). Danach lädt HA den Eintrag nach ca. 30 s neu, so lange zeigt die Zeile „Wird eingeschaltet …“. Ohne IPv4 oder ohne Box-Recht steht der Wert schreibgeschützt da, mit Grund. Ein leeres Auswahlfeld gibt es nicht mehr.
3. **Chips laufen über:** Drei feste Chips mit Zähler (Alle, Online, Offline) und „Mehr ▾“. Das Menü enthält die übrigen Status- und Verbindungsfilter sowie die Gruppen, jeweils mit Zähler (`role=menu`, `menuitemradio`, Pfeiltasten, Esc). Auf dem Handy öffnet es sich als Blatt von unten. Ein aktiver Zusatzfilter steht als eigener Chip mit × daneben. Die Reihe bricht notfalls um, scrollt aber nie waagerecht, und bei 390 px passt sie in eine Zeile. Auch die Funkband-Kästen brechen jetzt um.
4. **Netzkarte:** Umschalter **Liste | Netzkarte** (Ansicht pro Browser in `localStorage`). Suche, Filter und Gruppenleiste gelten für beide Ansichten. Sortieren und Gruppieren zeigt nur die Liste.

## Netzkarte: zwei Varianten

- **1 Inseln (Empfehlung):** Oben „Internet“, darunter die FRITZ!Box als breite Fläche, darunter die Repeater als eigene Flächen, verbunden mit durchgezogener (LAN) oder gestrichelter (WLAN-Backhaul) Linie samt Signal. In jeder Fläche hängen die Geräte als 36-px-Knöpfe an Leitungen „LAN / WLAN 5 GHz / WLAN 2,4 GHz“, und die Leitung hat denselben Linienstil. Farben: grün online, gestrichelt grau offline, orange mit „!“ schwach, rot mit ⦸ gesperrt. Ein Kabelgerät ist eckig, ein WLAN-Gerät rund, und ein Mini-Balken zeigt das Signal. Auf dem Handy stehen die Flächen untereinander, die Linien laufen links als Stamm. Ohne Zoom lesbar. „Namen ausblenden“ macht die Karte dichter (79 Geräte ≈ 1 800 px Höhe auf dem Handy). Normales HTML mit echten Buttons, das HA-Theme gilt, und nur die Verbindungslinien sind ein gemessenes SVG.
- **2 Radial mit Zoom:** Ein Netzplan mit der Box in der Mitte, Repeatern außen (auf schmalen Bildschirmen oben und unten) und den Geräten im Ring um ihren AP. Verschieben per Ziehen, Zoom per Rad, Pinch oder Knöpfen (+ − ⤢), Namen erst ab einer Zoomstufe oder bei Fokus. Gefilterte Geräte werden blass, damit das Bild stabil bleibt. Sieht nach „Karte“ aus, ist auf dem Handy bei 79 Geräten aber ohne Pinch nicht lesbar, und 79 Tab-Stopps in einem SVG sind für Tastatur und Screenreader zäh.

Empfehlung: Variante 1. Sie erfüllt „auf dem Handy ohne Pinch bedienbar“, sie skaliert durch Umbruch statt durch Verkleinern, und Pan/Zoom-Code, der bei jedem 30-s-Update den Zustand halten müsste, entfällt.

## Bedienung

Touch: Ziele ≥ 36 px, Menü und Filter als Blatt von unten. Tastatur: „/“ für die Suche, Esc schließt Menü und Gerät, j/k zum Blättern, + − im Radial. Screenreader: Jeder Knoten hat ein ganzes Label („iPad Ben, online, WLAN 5 GHz, −71 dBm, schwache Verbindung“). Die Flächen und Leitungen sind benannte Gruppen, die Trefferzahl wird per `aria-live` angesagt, der Verbindungsweg hat ein Textlabel, und „Als Liste lesen“ ist die lineare Alternative.

## Offene Fragen

1. **Backhaul der Repeater:** Die Subscription liefert pro Knoten weder Uplink-Art noch -Signal. Für die Linienstile zwischen Box und Repeater braucht `nodes[]` additiv `uplink: {type, band, signal_dbm}` aus der Mesh-Topologie (`node_links`). Ohne diese Daten zeichnen wir eine neutrale Linie.
2. Startansicht: Liste (wie heute) oder die zuletzt gewählte? Mein Vorschlag: die zuletzt gewählte, beim ersten Mal die Liste.
3. Kennzeichen im Knoten: Initialen wie im Mockup oder ein Gerätetyp-Icon? Dafür fehlt bisher die Datengrundlage (nur Hersteller).
4. Sollen gefilterte Geräte in den Inseln ausgeblendet werden (Mockup, mit Hinweis „N ausgeblendet“) oder blass bleiben?
5. Darf „Alle einschalten“ ohne Rückfrage laufen? Es ist umkehrbar, löst aber einen Reload der Integration aus.

## Umsetzung (grob)

- `panel-styles.js`: Spalten-Layout (`.split`, `.detail-col`) entfernen. Neu: Chips mit Umbruch, Menü/Blatt, Detailseite, Netzkarte und Legende, dazu das Token `--link`.
- `fritzbox-network-panel.js`: Template ohne Split, Zustand `view` und `menu`, Scroll und Fokus beim Zurückgehen, Tastenkürzel, Einschalten über die Entity-Registry.
- `panel-network.js`: `renderChips` → feste Chips plus Menü, neue `renderMap` (am besten als eigene Datei `panel-map.js`).
- `panel-device.js`: Vollseite mit Pager und Verbindungsweg, `actionStatus` um „aus, aber Wert bekannt“ erweitern, statt Leerfeld Einschalten anbieten.
- `shared.js` (mit node:test): Leitungen pro AP, Knoten-Label, Reihenfolge fürs Blättern. `texts.js`: neue Texte de/en.
- Backend nur für Frage 1: `websocket_api.py`/`models.py` liefern den Uplink der Knoten additiv mit.
