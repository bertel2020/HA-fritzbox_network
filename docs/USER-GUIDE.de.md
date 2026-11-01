# FRITZ!Box Netzwerk für Home Assistant – Anleitung

[← Zurück zur Übersicht](../README.md)

Benutzerdefinierte Home-Assistant-Integration für die **Netzwerkgeräte** einer FRITZ!Box. Jedes Gerät wird über seine **MAC-Adresse** geführt, der Name folgt der FRITZ!Box, und pro Gerät gibt es Anwesenheit, Verbindungsdaten und Aktionen. Grundlage ist TR-064 (`Hosts1`, `X_AVM-DE_HostFilter1`) und die Mesh-Topologie der Box, gelesen mit [`fritzconnection`](https://github.com/kbr/fritzconnection).

Die Integration arbeitet lokal mit der FRITZ!Box und baut keine Internetverbindungen auf.

## Inhalt

- [Voraussetzungen auf der FRITZ!Box](#voraussetzungen-auf-der-fritzbox)
- [Installation](#installation)
- [Update](#update)
- [Optionen](#optionen)
- [Entitäten](#entitäten)
- [Namen und Entity-IDs](#namen-und-entity-ids)
- [Geräte löschen und ausblenden](#geräte-löschen-und-ausblenden)
- [Topologie-Karte](#topologie-karte) mit [Funk-Karte](#funk-karte) und [Geräte-Karte](#geräte-karte)
- [Seitenpanel](#seitenpanel)
- [Blueprints](#blueprints)
- [Zusammen mit der Core-Integration](#zusammen-mit-der-core-integration)
- [Datenschutz und Sicherheit](#datenschutz-und-sicherheit)
- [Markenhinweis](#markenhinweis)
- [Fehlerbehebung](#fehlerbehebung)
- [Entwicklung und Tests](#entwicklung-und-tests)
- [Änderungsverlauf](../CHANGELOG.md)

## Voraussetzungen auf der FRITZ!Box

| # | Was | Wo |
|---|-----|----|
| 1 | TR-064 aktivieren | Heimnetz → Netzwerk → Netzwerkeinstellungen → „Zugriff für Anwendungen zulassen“ |
| 2 | Eigener FRITZ!Box-Benutzer für Home Assistant | System → FRITZ!Box-Benutzer → Recht „FRITZ!Box Einstellungen“ (für Internetsperre und Wake on LAN), ohne Zugriff aus dem Internet |
| 3 | Die Box ist der **Mesh-Master** | Ein Mesh-Repeater kennt nicht alle Geräte; die Einrichtung weist ihn ab |

Ohne das Recht „FRITZ!Box Einstellungen“ werden die Geräte trotzdem angezeigt, aber die Schalter für den Internetzugang und die Wake-on-LAN-Buttons fehlen. Ein Hinweis unter **Einstellungen → Reparaturen** erklärt das.

Voraussetzung auf der Home-Assistant-Seite ist **Home Assistant 2026.8 oder neuer**.

## Installation

### Über HACS (empfohlen)

[![HACS-Repository in My Home Assistant öffnen](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=bertel2020&repository=HA-fritzbox_network&category=integration)
[![FRITZ!Box Netzwerk zu My Home Assistant hinzufügen](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=fritzbox_network)

1. Über den ersten Button das FRITZ!Box-Netzwerk-Repository in HACS öffnen.
2. **FRITZ!Box Netzwerk** herunterladen und Home Assistant neu starten.
3. Über den zweiten Button die Integration hinzufügen. Alternativ in Home Assistant **Einstellungen → Geräte & Dienste → Integration hinzufügen → FRITZ!Box Netzwerk** öffnen.

Falls der erste Button nicht funktioniert, in HACS unter **Integrationen → Benutzerdefinierte Repositories** `https://github.com/bertel2020/HA-fritzbox_network` als Kategorie **Integration** eintragen.

### Manuell

Das Verzeichnis `custom_components/fritzbox_network` nach `/config/custom_components/fritzbox_network` kopieren und Home Assistant neu starten.

### Einrichtung

Host (Standard `192.168.178.1`), Benutzer und Kennwort eingeben, optional Port und TLS. Die Seriennummer der Box wird zur Kennung des Eintrags; dieselbe Box lässt sich nicht zweimal einrichten.

- **Neue Adresse der Box**: ⋮ am Eintrag → **Neu konfigurieren**. Adresse, Port und TLS lassen sich ändern, die Anmeldung bleibt. Eine andere Box wird abgewiesen.
- **Neues Kennwort**: Home Assistant meldet „Neu anmelden“; dem Hinweis folgen.

## Update

Über HACS aktualisieren und Home Assistant neu starten. Die Entity-IDs ändern sich dabei nicht.

## Optionen

**Einstellungen → Geräte & Dienste → FRITZ!Box Netzwerk → Konfigurieren**

| Option | Standard | Bedeutung |
|--------|----------|-----------|
| Abfrageintervall | 30 s (15–300) | Wie oft die Box gefragt wird. Pro Abfrage zwei Anfragen (Geräteliste, Mesh). Bei wiederholten Fehlern verdoppelt sich das Intervall bis höchstens 5 Minuten. |
| Als anwesend werten für | 180 s (0–900) | Wie lange ein Gerät nach dem Offline-Gehen noch als anwesend gilt. |
| Auf lange offline Geräte hinweisen | aus | Eine Reparatur listet die Geräte auf, die länger als die Tage unten offline sind, und bietet an, sie auszublenden. Ohne deine Auswahl wird nichts ausgeblendet. Geräte ohne Zeitangabe bleiben außen vor. Geprüft wird stündlich, das erste Mal eine Minute nach dem Start. Wischst du die Reparatur weg, bleibt sie still. |
| Tage offline, bis ein Gerät als weg gilt | 30 (7–365) | Nur mit der Option darüber. |
| Hersteller eines Geräts anzeigen | aus | Der Hersteller stammt aus der MAC-Adresse, aus einer Liste, die mit Home Assistant mitkommt; es wird nichts verschickt. Er erscheint als Hersteller des Geräts, im Ereignis für neue Geräte (`vendor`) und in der Topologie-Karte. Private (zufällige) Adressen haben keinen. Schaltest du das aus, bleibt ein bereits eingetragener Hersteller stehen. |
| Gerätenamen übernehmen | an | Der Name aus der Box wird zum Gerätenamen. Namen, die du in Home Assistant selbst vergibst, werden nie überschrieben. |
| Für Offline-Geräte keine Geräte anlegen | aus | Die Box merkt sich jedes Gerät, das sie je gesehen hat. Mit dieser Option entsteht ein Gerät erst, wenn das Gerät online kommt. Vorhandene Geräte bleiben. |
| Geräte im Gastnetz ignorieren | aus | Gastnetz-Geräte werden nicht angelegt (vorhandene werden entfernt). |
| Geräte mit privater MAC-Adresse ignorieren | aus | Geräte mit zufälliger („privater“) MAC werden nicht angelegt (vorhandene werden entfernt). |
| Gerätefilter | alle Geräte | Alle, nur die ausgewählten oder alle außer den ausgewählten Geräten. |
| Ausgeblendete Geräte | leer | Von Hand gelöschte Geräte. Abwählen blendet ein Gerät wieder ein. |

Die Box selbst und ihre **Repeater** sind nie gefiltert.

## Entitäten

### Pro Netzwerkgerät

| Plattform | Entität | Standard | Hinweis |
|-----------|---------|----------|---------|
| Device Tracker | (Gerätename) | an | Anwesenheit; Attribute `ip`, `mac`, `host_name`, `interface_type`, `model`, `guest`, `vpn`, `mac_list` |
| Sensor | IP-Adresse | an | |
| Sensor | Verbindung | an | `lan` oder `wlan` |
| Sensor | Access Point | an | Name der Box oder des Repeaters, an dem das Gerät hängt |
| Sensor | Online seit | an | Zeitstempel des Online-Gehens; unbekannt, solange das Gerät offline ist. Ändert sich nur beim Online-Gehen und bleibt nach einem Neustart erhalten |
| Sensor | Zuletzt online | an | Zeitstempel der letzten Abfrage, die das Gerät sah; unbekannt, solange es online ist. Ändert sich nur beim Offline-Gehen und bleibt nach einem Neustart erhalten |
| Schalter | Internetzugang | an | An = darf ins Internet. Nur mit dem Recht „FRITZ!Box Einstellungen“ und nur für Geräte mit IPv4-Adresse. Die Box meldet die Änderung manchmal erst nach etwa einer Minute; der Schalter zeigt sie bis dahin sofort an. |
| Schalter | Automatisches Wake on LAN | aus | An = die Box weckt das Gerät selbst, wenn aus dem Netz etwas darauf zugreifen will. Nicht für Geräte, die als WLAN bekannt sind. Die Einstellung steht nicht in der Geräteliste: Jeder aktivierte Schalter fragt die Box alle 10 Minuten selbst ab, einer nach dem anderen. Die Aktion ist noch nicht gegen jede Firmware geprüft |
| Schalter | Priorisierung | aus | An = der Router bevorzugt das Gerät, wenn die Leitung ausgelastet ist. Nur mit dem Recht. Gesetzt wird sie über die IPv4-Adresse wie der Internetzugang. Die Namen der Argumente liest die Integration aus der Beschreibung der Box; die Aktion selbst ist noch nicht gegen jede Firmware geprüft |
| Auswahl | Zugangsprofil | aus | Das Zugangsprofil der Box, in dem das Gerät ist, zum Beispiel „Kinder“. Nur mit dem Recht und wenn die Box Profile liefert. Gesetzt wird es über die IPv4-Adresse wie der Internetzugang; die Profilnamen werden bei jeder 20. Abfrage aus der Box gelesen. Das Listenformat der Box ist noch nicht gegen jede Firmware geprüft |
| Button | Aktualisieren | an | Am Gerät der Box: fragt die Box sofort ab statt erst im nächsten Intervall |
| Button | Wake on LAN | aus | Nur mit dem Recht; nicht für Geräte, die als WLAN bekannt sind |
| Binärsensor | Gastnetz | nur für Gastgeräte an | Diagnose |
| Sensor | Signalstärke | aus | in dBm, nur für WLAN-Geräte; die Sicht des Access Points auf das Gerät |
| Sensor | Link-Rate Download / Upload | aus | in Mbit/s, aus der Sicht des Geräts |
| Sensor | WLAN-Band | aus | 2,4 / 5 / 6 GHz |
| Sensor | Netzwerkname (SSID) | aus | |

Signalstärke, Link-Rate, Band und SSID kommen aus den Mesh-Daten der Box, ohne zusätzliche Abfrage. Sie entstehen nur für Geräte, für die die Box eine Verbindung kennt, und sind Diagnose-Entitäten.

### Box und Repeater

Die FRITZ!Box und jeder Repeater sind eigene Geräte mit Modell und Firmware. Pro Gerät gibt es den Sensor **Verbundene Geräte** (Anzahl der Geräte, die an diesem Access Point hängen). Ein Repeater ist zugleich sein Eintrag in der Geräteliste, also ein einziges Gerät.

Das Gerät der FRITZ!Box zählt außerdem die Geräte im Netz (nach den Filtern): **Geräte online**, **Geräte offline** und **Geräte gesamt**. „Online“ folgt der Anwesenheit der Device Tracker, einschließlich der Option „Als anwesend werten“.

Die Box und jeder Repeater haben außerdem Diagnose-Sensoren für jedes ihrer WLAN-Bänder, standardmäßig aus: **Kanal**, **Kanalauslastung** (in Prozent, wie die Box sie meldet) und **Rauschen** (in dBm). Sie beantworten „warum ist das WLAN heute Abend schlecht“: ein voller Kanal oder ein hoher Rauschpegel an dem Access Point, an dem das Gerät hängt. Das Gastnetz teilt sich die Funkeinheit und steht nicht doppelt da. Sie kommen aus den Mesh-Daten, die ohnehin abgerufen werden, kosten also keine zusätzliche Anfrage.

Die Box hat außerdem Sensoren für ihre **Internetverbindung**, sobald sie diese meldet: den Verbindungsstatus (Binärsensor „Internetverbindung“) und den **Durchsatz** für Download und Upload in Mbit/s, beide standardmäßig an, damit der Verlauf in Home Assistant von Anfang an da ist. Der Durchsatz wird aus den Byte-Zählern der Box zwischen zwei Abfragen berechnet. Standardmäßig aus sind die Verbindungszeit, die externe IPv4-Adresse und bei DSL Leitungsrate, Störabstand, Dämpfung sowie FEC- und CRC-Fehler, je für Download und Upload. Damit lassen sich Automationen bauen („IP hat sich geändert“, „Störabstand unter 8 dB“) und Verläufe über Tage ansehen. Sie kosten keine zusätzliche Anfrage, die Werte kommen aus der Abfrage der Internet-Seite.

Das Gerät der FRITZ!Box hat außerdem drei Diagnose-Sensoren, standardmäßig aus: **Letzte Aktualisierung** (die letzte erfolgreiche Abfrage), **Fehlgeschlagene Abfragen** (wie viele Abfragen in Folge scheiterten) und **Mesh-Status** (ob die Mesh-Topologie bei der letzten Abfrage mitkam). Sie bleiben verfügbar, auch wenn die Box nicht erreichbar ist.

### Aktionen

Beide brauchen das Recht „FRITZ!Box Einstellungen“ und nehmen ein Gerät, eine Entität oder einen Bereich als Ziel.

| Aktion | Was sie tut |
|--------|-------------|
| `fritzbox_network.set_name` | Benennt das Gerät in der FRITZ!Box selbst um (`name`). Der Name in Home Assistant folgt, wenn Namen übernommen werden; Entity-IDs ändern sich nie. Abgelehnt bei Geräten, deren Namen die Box nicht ändern lässt. |
| `fritzbox_network.wake_on_lan` | Sendet das Wake-on-LAN-Signal der Box an das Gerät, ohne den (standardmäßig deaktivierten) Button. |

### Ereignisse

Wird ein Gerät in der Box umbenannt, löst Home Assistant das Ereignis `fritzbox_network_device_renamed` aus, mit `mac`, `old_name` und `new_name`.

Listet die Box ein Gerät, das sie vorher nicht gelistet hat, löst Home Assistant das Ereignis `fritzbox_network_new_device` aus, mit `mac`, `name`, `ip` und `vendor` (leer, solange die Hersteller-Option aus ist). Damit lässt sich eine Benachrichtigung über neue Geräte im Netz bauen. Was die Box beim Start listet, gilt nicht als neu: Geräte, die dazukamen, während Home Assistant aus war, werden nicht gemeldet, ebenso wenig Geräte, die ein Filter ausschließt.

Wechselt ein Gerät zu einem anderen Access Point (der Box oder einem Repeater), löst Home Assistant `fritzbox_network_device_roamed` aus, mit `mac`, `name`, `old_ap`, `old_ap_mac`, `new_ap`, `new_ap_mac`, `link_type`, `band` und `signal_dbm`. Der neue Access Point muss in zwei Abfragen hintereinander erscheinen, damit ein Gerät, das zwischen zweien hin- und herspringt, nicht bei jeder Abfrage auslöst; bei der Standardabfrage geht ein sehr kurzer Besuch verloren. Das erste Sehen eines Geräts ist kein Wechsel. Nutze es für Anwesenheit nach Raum: Der Access Point eines Repeaters verrät, wo im Haus ein Handy ist.

Die Internetverbindung löst `fritzbox_network_internet_disconnected` aus, wenn die Box sie verliert, `fritzbox_network_internet_reconnected`, wenn sie neu aufgebaut wird (auch wenn die Box zwischen zwei Abfragen neu verbunden hat, was die Online-Zeit verrät), und `fritzbox_network_internet_ip_changed` mit `old_ip` und `new_ip`, wenn sich die externe IPv4-Adresse ändert. Sie stehen auch im Logbuch, ohne die Adressen. Die erste Abfrage nach dem Start von Home Assistant löst nichts aus.

Alle drei Ereignisse erscheinen auch im **Logbuch** (zum Beispiel „phone moved from FRITZ!Repeater to FRITZ!Box“) und im Verlauf des Trackers des Geräts. Die Rohdaten siehst du, wenn du unter **Werkzeuge → Ereignisse** den Ereignisnamen abhörst.

## Namen und Entity-IDs

Die Entity-ID entsteht einmal, beim Anlegen, aus der MAC-Adresse ohne Doppelpunkte:

- Tracker: `device_tracker.fritz_3c2af4a1b2c3`
- übrige Entitäten: `<Plattform>.fritz_3c2af4a1b2c3_<Schlüssel>`, z. B. `sensor.fritz_3c2af4a1b2c3_ip_address`, `switch.fritz_3c2af4a1b2c3_internet_access`

Danach ändert Home Assistant sie nie von selbst. Der **Name** dagegen folgt der Box: Der Name in der FRITZ!Box (Anzeigename, sonst Hostname, sonst `fritz_<MAC>`) wird zum Gerätenamen, und die Entitäten zeigen ihn mit. Ein Name, den du in Home Assistant am Gerät selbst vergibst, hat Vorrang und wird nie überschrieben.

Ein Laptop mit LAN und WLAN hat zwei MAC-Adressen und steht in der Box zweimal. Hier sind es deshalb zwei Geräte.

## Geräte löschen und ausblenden

**Gerät löschen** am Gerät in Home Assistant geht für alle Geräte, die **gerade nicht online** sind. Das gelöschte Gerät landet in der Liste der ausgeblendeten Geräte, denn die Box führt Offline-Geräte dauerhaft und würde es sonst beim nächsten Abruf zurückbringen. Abgelehnt werden die Box, Repeater und Geräte, die gerade online sind.

Die Löschung betrifft nur Home Assistant. In der Box bleibt das Gerät stehen; dort entfernst du es über das Papierkorb-Symbol unter **Heimnetz → Netzwerk → Netzwerkverbindungen**. Per TR-064 lässt sich das nicht auslösen.

Schließt ein Filter in den Optionen ein Gerät aus, werden dessen Gerät und Entitäten beim nächsten Abruf entfernt. Sie kommen zurück, wenn der Filter sie wieder einschließt.

## Topologie-Karte

Mit der Integration kommt eine Dashboard-Karte, die auf einen Blick zeigt, wer an welchem Access Point hängt: die Box und jeder Repeater als Gruppe, darunter die Geräte mit Online-Punkt, WLAN oder LAN und Signal. Geräte, die online sind, stehen oben. Suche, Filter, Details und Aktionen gibt es im [Seitenpanel](#seitenpanel): Ein Tipp auf ein Gerät öffnet dessen Seite dort, ein Tipp auf die Überschrift die Übersicht.

Füge sie im Dashboard-Editor unter **Karte hinzufügen → FRITZ!Box Network topology** hinzu, oder per YAML:

```yaml
type: custom:fritzbox-network-topology-card
title: Netzwerk
```

| Option | Bedeutung |
|--------|-----------|
| `title` | Überschrift der Karte |
| `entry_id` | Nur bei mehr als einer Box nötig: die ID des Config-Eintrags |
| `collapsed` | `true`: die Access Points starten zugeklappt (Standard `false`) |
| `max_height` | Maximale Höhe der Liste in Pixel, danach scrollt sie; 0 oder leer: keine Grenze |
| `weak_threshold` | Schwache Verbindung unter diesem Prozentwert der höchsten Rate (1–99, Standard 33) |

Alle Optionen stehen auch im visuellen Editor der Karte. Die Optionen `default_filter`, `compact`, `hide_vendor`, `hide_rate`, `hide_signal`, `hide_radio` und `tap_action` einer früheren Version gibt es nicht mehr; bestehende Karten laden weiter, die Werte werden ignoriert.

Ein Gerät hängt an einer schwachen Verbindung, wenn es online ist und seine aktuelle Rate unter einem Drittel (einstellbar mit `weak_threshold`) der höchsten Rate liegt, die seine Verbindung kann, in einer der beiden Richtungen; die Karte markiert es mit einem Warnsymbol, das den Prozentwert zeigt. Ein Gerät im Leerlauf kann eine Weile mit niedrigerer Rate laufen, lies die Markierung also als Hinweis und nicht als Fehler. Die Zahlen neben einem Access Point sind angezeigt / gesamt. Geräte, die die Box keinem Access Point zuordnet, stehen am Ende. Ohne Mesh-Topologie gibt es keine Access Points, und alle Geräte stehen in dieser Gruppe. Kanal und Auslastung der Funkmodule zeigt die [Funk-Karte](#funk-karte), Aktionen wie Internet sperren die [Geräte-Karte](#geräte-karte).

Die Karte braucht ein Administratorkonto, weil sie MAC- und IP-Adressen zeigt. Sie lädt sich selbst; nach dem Update bringt ein harter Reload des Browsers die neue Version.

### Funk-Karte

Die Funk-Karte zeigt pro Access Point und Band den Kanal, die Auslastung als Balken (ab 70 % in Warnfarbe), das Rauschen und die Zahl der Geräte, die gerade online auf diesem Band sind. Damit siehst du, welches Funkmodul überlastet ist oder auf einem lauten Kanal sitzt. Die Daten kommen aus der Mesh-Topologie der Box; die Funk-Sensoren musst du dafür nicht aktivieren.

```yaml
type: custom:fritzbox-network-radio-card
```

| Option | Bedeutung |
|--------|-----------|
| `title` | Überschrift der Karte |
| `entry_id` | Nur bei mehr als einer Box nötig: die ID des Config-Eintrags |
| `hide_noise` | Rauschen ausblenden (Standard `false`) |
| `hide_clients` | Anzahl der Geräte ausblenden (Standard `false`) |

Die Box meldet nicht für jedes Band Auslastung und Rauschen; fehlende Werte bleiben leer. Ohne Mesh-Topologie zeigt die Karte „Die Box meldet keine Funkdaten.“

### Geräte-Karte

Die Geräte-Karte zeigt ausgewählte Geräte mit Status, Access Point, Link-Rate und Signal und den Aktionen **Internet sperren oder freigeben**, Priorisierung und Wake on LAN. Bei zwei oder mehr Geräten mit Internetschalter kommt ein Knopf dazu, der alle auf einmal sperrt (wenn alle online dürfen) oder freigibt (sonst die gesperrten). Die Aktionen sind dieselben Schalter und Buttons wie am Gerät und brauchen dasselbe Recht „FRITZ!Box Einstellungen“; eine Aktion erscheint nur, wenn ihre Entität existiert und aktiviert ist.

```yaml
type: custom:fritzbox-network-device-card
title: Kinder
entities:
  - device_tracker.fritz_3c2af4a1b2c3
  - device_tracker.fritz_3c2af4a1b2c4
```

| Option | Bedeutung |
|--------|-----------|
| `entities` | Die Device Tracker der Geräte, in der Reihenfolge der Karte. Im Editor als Auswahl. Ein Gerät, das es nicht mehr gibt, steht als „Unbekanntes Gerät“ da |
| `title` | Überschrift der Karte |
| `label` | Eine Gruppe (Label): zeigt zusätzlich jedes Gerät dieser Gruppe, auch später hinzugefügte |
| `entry_id` | Nur bei mehr als einer Box nötig |
| `hide_rate`, `hide_signal` | Rate oder Signal ausblenden (Standard `false`) |

Ein Tipp auf den Namen öffnet das Gerät. Beide Karten brauchen wie die Topologie-Karte ein Administratorkonto und laden sich selbst.

## Seitenpanel

Mit der Integration kommt ein Eintrag **FRITZ!Box Netzwerk** in der Seitenleiste. Er zeigt das ganze Netz auf einer Seite und ist nur für Administratoren sichtbar. Das Panel holt seine Daten über dieselbe Verbindung wie die Dashboard-Karten und fragt die Box nicht zusätzlich ab.

**Netzwerk.** Oben stehen die Suche (Name, IP, MAC oder Hersteller; die Taste `/` springt hinein), je ein Auswahlfeld zum Sortieren (Name, Signal, Rate, Zuletzt online) und Gruppieren (Access Point, Band / LAN, Gruppe, Flach) und der Umschalter **Liste | Netzkarte**. Das Panel merkt sich die zuletzt gewählte Ansicht in diesem Browser, beim ersten Mal zeigt es die Liste. Suche, Filter und Gruppen gelten für beide Ansichten, Sortieren und Gruppieren nur für die Liste.

Darunter stehen die Filter: **Alle**, **Online** und **Offline** als feste Knöpfe mit der Zahl der Geräte, dazu **Mehr ▾**. Das Menü enthält die übrigen Filter (WLAN, LAN, Gast, Gesperrt, Schwach, Neu (7 Tage), Lange offline, Ohne Access Point) und die Gruppen, jeweils mit Zähler; Filter ohne Treffer bleiben weg. Es geht mit den Pfeiltasten und Esc, auf dem Handy öffnet es sich als Blatt von unten. Ein gewählter Filter aus dem Menü steht als eigener Knopf mit × daneben, ein Tipp darauf zeigt wieder alle. Die Reihe bricht notfalls um und scrollt nie waagerecht.

Über der Suche stehen **Hinweise zum Netz**, wenn etwas auffällt: ein Funkmodul mit 70 % Auslastung oder mehr und ein Repeater, der per WLAN mit höchstens −75 dBm an der Box hängt (alle Geräte dahinter teilen sich diese Verbindung). Ohne Auffälligkeit fehlt die Karte.

In der **Liste** ist jeder Access Point eine Karte mit einer Zusammenfassung („1 WLAN · 3 LAN · min. 52 Mbit/s“), Kanal, Auslastung und Rauschen seiner Funkbänder und den Geräten. Online-Geräte stehen oben.

Die **Netzkarte** zeigt oben das Internet, darunter die FRITZ!Box als breite Fläche und darunter jeden Repeater als eigene Fläche. Die Linie von der Box zum Repeater ist durchgezogen, wenn er per LAN angebunden ist, gestrichelt bei WLAN (mit Band und Signal) und gepunktet, wenn die Box die Anbindung nicht nennt. In jeder Fläche hängen die Geräte als Knöpfe mit ihren Initialen an Leitungen für LAN und die WLAN-Bänder, mit demselben Linienstil. Grün heißt online, gestrichelt grau offline, orange mit „!“ schwache Verbindung, rot mit ⦸ Internet gesperrt; ein Kabelgerät ist eckig, ein WLAN-Gerät rund, ein kleiner Balken zeigt das Signal. Geräte, die der Filter ausblendet, fehlen in der Karte, die Fläche sagt dann „N durch den Filter ausgeblendet“. „Namen ausblenden“ macht die Karte dichter, „Als Liste lesen“ wechselt zur Liste. Auf dem Handy stehen die Flächen untereinander und die Linien laufen links als Stamm; die Karte ist ohne Zoomen lesbar.

- **Neu (7 Tage)** und **Lange offline** (30 Tage) kennt nur Home Assistant: „Neu“ zählt ab dem Anlegen des Geräts in Home Assistant, „Lange offline“ nur Geräte, deren letzte Online-Zeit bekannt ist. Nach einer Neuinstallation ist deshalb zunächst alles neu.
- **Gesperrt** heißt: Die Box meldet für das Gerät keinen Internetzugang. Meldet sie nichts, zählt das Gerät nicht als gesperrt.

**Internet.** In der Netzkarte ist das Internet ein Knopf mit Status (grüner Punkt: verbunden) und dem aktuellen Durchsatz. Ein Tipp öffnet die Seite `#/internet` (Zurück oder Esc führt zur Karte):

- **Verbindung:** verbunden oder getrennt, Zugangsart (DSL, Kabel …), Online-Zeit, externe IPv4, IPv6-Präfix, DNS-Server und der letzte Fehler.
- **Auslastung jetzt** als Balken gegen die Leitungsrate und ein Verlauf der letzten Stunden. Die Box meldet den Durchsatz nicht selbst: Das Panel rechnet ihn aus den Byte-Zählern der Box zwischen zwei Abfragen, die erste Rate erscheint also nach der zweiten Abfrage. Der Verlauf wird im Speicher von Home Assistant gehalten und beginnt nach einem Neustart neu.
- **Leitungsqualität** (nur bei DSL): Leitungsrate und was die Leitung möglich machen würde, Störabstand, Dämpfung und die Fehler seit der Synchronisation (FEC, CRC) und ein Diagramm des Signals über die Frequenz für Download und Upload. Die Höhe ist relativ; Lücken sind Bänder, die die Leitung nicht nutzt, Einbrüche weisen auf Störungen auf einer Frequenz hin. Fällt der Störabstand oder steigen die Fehler, liegt es an der Leitung, nicht an einem Gerät.
- **Hinweise** oben auf der Seite, wenn etwas auffällt: keine Verbindung, ein Störabstand unter 10 dB (unter 6 dB als ernst), drei oder mehr neue Verbindungen in 24 Stunden und eine Leitung, die in den letzten Messungen voll ausgelastet war.
- **Aktionen:** **Neu verbinden** (die Box legt auf und wählt sich neu ein, meist mit neuer externer IPv4) und **Box neu starten**. Beide unterbrechen das Netz und fragen vorher in einem Dialog nach; sie brauchen das Recht „FRITZ!Box Einstellungen“ und gibt es bewusst nur im Panel, nicht als Schalter oder Knopf in Home Assistant, damit keine Automation versehentlich dein Netz trennt. Nach einem Neustart zeigt das Panel die Daten der Box nach einigen Minuten wieder.
- **Reparaturen:** Hält ein Problem an, meldet die Integration es auch unter Einstellungen → Reparaturen (nicht behebbar, sie verschwinden von selbst): ein Störabstand unter 10 dB seit über einer Stunde und drei oder mehr neue Verbindungen in 24 Stunden.
- **Letzte Ereignisse:** Verbindung getrennt oder neu aufgebaut und neue externe IPv4. Die Integration erkennt sie selbst und merkt sich die letzten 20 seit ihrem Start; ins Logbuch gehen sie nicht.

Welche Werte die Box liefert, hängt von Modell und Anschluss ab; was sie nicht meldet, fehlt auf der Seite. Die Zugangsart steht benannt da (DSL, Ethernet, Glasfaser, Kabel, Mobilfunk), eine unbekannte so, wie die Box sie schreibt. Entwickelt und geprüft ist das an einer DSL-Box; bei Kabel, Glasfaser und Mobilfunk zeigt die Seite Verbindung, Adressen, Durchsatz und die Rate des Anschlusses, den Abschnitt Leitungsqualität gibt es nur bei DSL. `tools/spike_wan.py` liest lesend, was eine Box dazu meldet; wenn dir bei deinem Anschluss etwas fehlt, hilft die Ausgabe (`spike_out/wan.txt`, Adressen maskiert) bei einem Issue. Die Integration liest dafür zusätzlich drei kleine Werte pro Abfrage (Status und zwei Byte-Zähler), Adressen und Leitung nur alle zehn Abfragen oder gleich nach einer neuen Verbindung. Fehlt die Verbindung ganz, bleibt der Knoten ein einfaches Wort.

**Gerät.** Ein Tipp auf ein Gerät öffnet seine Seite (Adresse `#/device/<MAC ohne Doppelpunkte>`, der Zurück-Knopf des Browsers funktioniert). Sie ersetzt Liste oder Karte, auf jeder Bildschirmbreite. Der Knopf oben links heißt wie die Ansicht, aus der du kommst („Liste“ oder „Netzkarte“) und führt dorthin zurück, mit demselben Filter, derselben Scrollposition und dem Fokus auf dem Gerät; Esc tut dasselbe. Mit ‹ › oder den Tasten `j` und `k` blätterst du durch die Geräte, die dort gerade angezeigt werden („20 / 79“). Oben steht der **Verbindungsweg** (Internet → FRITZ!Box → Repeater → Gerät, mit Linien wie in der Karte), darunter Rate, höchste Rate, Signal und Band (bei LAN den Anschluss). Ab 900 px Breite stehen die Aktionen und die Stammdaten nebeneinander. „In der Netzkarte“ zeigt das Gerät markiert in der Karte. Die Aktionen:

| Aktion | Hinweis |
|--------|---------|
| Internetzugang | Schalter, ohne Rückfrage: Sperren und Freigeben lässt sich jederzeit umkehren |
| Priorisierung | Schalter |
| Zugangsprofil | Auswahl der Profile der Box, wenn die Box Profile liefert |
| Wake on LAN | nur für Geräte, die offline sind |
| Umbenennen | Dialog; ruft die Aktion `set_name` auf |
| In Home Assistant | öffnet das Gerät in den Einstellungen |

Eine Aktion ist aus und nennt den Grund, wenn dem Box-Benutzer das Recht „FRITZ!Box Einstellungen“ fehlt oder das Gerät keine IPv4-Adresse hat. Ist die Entität in Home Assistant ausgeschaltet (Zugangsprofil und Priorisierung sind standardmäßig aus), zeigt die Zeile trotzdem den Wert, den die Box meldet, dazu „Ausgeschaltet in Home Assistant“ und den Knopf **Einschalten**. Sind es zwei oder mehr, gibt es oben **Alle einschalten**. Das schaltet die Entitäten ohne Rückfrage ein (das lässt sich in den Entitätseinstellungen jederzeit umkehren); Home Assistant lädt die Integration danach in etwa 30 Sekunden neu, so lange steht „Wird eingeschaltet“ in der Zeile. Gibt es mehrere Boxen, wählst du oben rechts die Box.

**Gruppen.** Eine Gruppe ist ein **Label** von Home Assistant, gesetzt auf dem Schalter „Internetzugang“ des Geräts (nicht auf dem Gerät: Ein Label am Gerät träfe auch den Prioritäts-Schalter). Auf der Geräteseite setzt du Gruppen mit einem Tipp oder legst eine neue an; das Label ist danach auch in Home Assistant selbst sichtbar und nutzbar. Im Netzwerk erscheint jede Gruppe mit Geräten im Menü „Mehr“ als Filter mit Zähler und als Gruppierung „Gruppe“. Ist eine Gruppe der Filter, steht oben ein Knopf **Alle sperren** (wenn alle online dürfen) oder **Alle freigeben** (sonst die gesperrten): Er nennt vorher die Geräte, und der Server schaltet genau diese Schalter, nicht „alles mit dem Label“. Dieselbe Gruppe geht in der Geräte-Karte (Option `label`) und im Zeitplan-Blueprint (Eingabe „Gruppe“). Ein Gerät ohne die Entität „Internetzugang“ kann in keiner Gruppe sein.

**Verlauf.** Die Geräteseite führt mit zwei Knöpfen ins Logbuch und in den Verlauf von Home Assistant für das Gerät. Dort stehen Roaming und Online-Zeiten. Das Panel führt keinen eigenen Verlauf: Signal und Rate haben nur dann einen, wenn du ihre Sensoren in den Geräteeinstellungen aktivierst (sie sind standardmäßig aus).

**Aufräumen.** Die Box merkt sich jedes Gerät, das sie je gesehen hat. Hier stehen die Offline-Geräte, deren letzte Online-Zeit bekannt ist, mit einem Regler für die Tage (vorbelegt mit der Option „Tage offline, bis ein Gerät als weg gilt“, 7 bis 365). Wähle Geräte aus oder alle und tippe auf „N Geräte ausblenden“: Ein Dialog nennt die Namen und die Folgen, erst dann werden sie ausgeblendet und mit ihren Entitäten aus Home Assistant entfernt. Online-Geräte, die Box und Repeater lehnt der Server ab, auch wenn das Panel sie anbieten würde. Darunter steht die Liste **Ausgeblendet** mit „Einblenden“; das lädt die Integration neu. Das ist dieselbe Liste wie die ausgeblendeten Geräte in den Optionen und die Reparatur für lange offline Geräte.

**Filter.** Der Gerätefilter der Optionen (Alle Geräte, Nur ausgewählte, Alle außer ausgewählten, Gastnetz und private MAC-Adressen ignorieren) mit einer **Vorschau**: Sie zeigt, welche Geräte bleiben, dazukommen oder **samt Entitäten entfernt werden**, bevor etwas geschrieben wird. „Filter anwenden“ fragt mit den Namen der Geräte nach, die verschwinden. Das Panel schickt dabei die Liste mit, die du gesehen hast: Hat sich die Liste inzwischen geändert (ein Gerät ging online, die Box listet ein anderes), schreibt der Server nichts und du siehst die neue Vorschau. Entfernte Geräte verlieren ihre eigenen Namen, ihre Entitäts-IDs und ihren Verlauf; Bezüge in Automationen zeigen danach ins Leere. „Für Offline-Geräte keine Geräte anlegen“ gibt es weiter nur in den Optionen.

Das Panel ist dem Look der anderen Panels des Autors nachempfunden, folgt dem hellen und dunklen Theme von Home Assistant und kommt ohne waagerechtes Scrollen bis 360 px Breite aus.

## Blueprints

Mit der Integration kommen zwei Automations-Blueprints. Importiere sie mit den Buttons; sie erscheinen unter **Einstellungen → Automatisierungen & Szenen → Blueprints**.

| Blueprint | Was es tut | Import |
|-----------|------------|--------|
| Benachrichtigung bei neuem Gerät | Sendet bei jedem Ereignis `fritzbox_network_new_device` eine Benachrichtigung | [![Blueprint für neue Geräte importieren](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https://github.com/bertel2020/HA-fritzbox_network/blob/main/blueprints/automation/fritzbox_network/new_device_notification.yaml) |
| Zeitplan für den Internetzugang | Sperrt den Internetzugang von Geräten zu einer Uhrzeit und gibt ihn zu einer anderen wieder frei, an gewählten Tagen | [![Blueprint für den Zeitplan importieren](https://my.home-assistant.io/badges/blueprint_import.svg)](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https://github.com/bertel2020/HA-fritzbox_network/blob/main/blueprints/automation/fritzbox_network/internet_schedule.yaml) |

Der Zeitplan braucht das Recht „FRITZ!Box Einstellungen“. Hat sich die Adresse eines Geräts seit der letzten Aktualisierung geändert, wird dieses Gerät nicht geschaltet und der Lauf meldet einen Fehler. Beim Start passiert nichts: Ein Neustart während der Sperrzeit lässt den Zugang, wie er ist. Statt einzelner Geräte kannst du eine **Gruppe** (ein Label auf den Schaltern „Internetzugang“) wählen; dann gilt der Zeitplan für jeden Schalter mit diesem Label, auch für später hinzugefügte.

## Zusammen mit der Core-Integration

Die Core-Integration „AVM FRITZ!Box Tools“ kann parallel laufen. Seit Home Assistant 2026.8 gehört jedes Gerät genau einer Integration; es entstehen also **zwei getrennte Geräte** pro Netzwerkgerät, mit doppelten Trackern und doppelter Last auf der Box. Schalte im Core das Gerätetracking aus oder entferne die Core-Integration, sobald du auf diese umgestiegen bist.

Automationen, die auf Core-Entity-IDs verweisen, musst du auf die neuen IDs umstellen; eine automatische Übernahme gibt es nicht.

## Datenschutz und Sicherheit

- Die Kommunikation mit der FRITZ!Box bleibt im lokalen Netz (HTTP oder, wenn gewählt, HTTPS). Es gibt keine Verbindung ins Internet.
- Die Zugangsdaten liegen im Eintrag von Home Assistant. Lege der Integration einen eigenen Benutzer mit nur dem nötigen Recht an, ohne Zugriff aus dem Internet.
- MAC- und IP-Adressen und Gerätenamen stehen als Entitätsattribute in Home Assistant. Wer dort Zugriff hat, sieht sie.
- Die **Diagnosedaten** (⋮ am Eintrag → Diagnose herunterladen) entfernen Zugangsdaten, die Adresse der Box sowie MAC- und IP-Adressen und Namen der Geräte. Sie zeigen außerdem, wie lange die letzte und die langsamste Abfrage dauerte. Sieh die Datei vor dem Teilen trotzdem durch.
- Die Integration kann den Internetzugang von Geräten sperren. Wer in Home Assistant Schalter bedienen darf, kann das also auch.

## Markenhinweis

Die Integration enthält ein eigenes Symbol im von Home Assistant unterstützten lokalen Verzeichnis `custom_components/fritzbox_network/brand/`, aber keine Marken oder Logos von AVM.

> **Markenhinweis:** Dieses Projekt ist eine unabhängige, inoffizielle Integration und steht in keiner Verbindung zu AVM bzw. der FRITZ! GmbH. FRITZ!, FRITZ!Box und FRITZ!OS sind geschützte Marken ihrer jeweiligen Inhaber. „Home Assistant“ ist eine Marke der Open Home Foundation.

## Fehlerbehebung

| Problem | Prüfen |
|---------|--------|
| Integration wird nicht gefunden | Zielordner heißt exakt `custom_components/fritzbox_network`; `manifest.json` liegt direkt darin; Home Assistant wurde neu gestartet |
| „Verbindung fehlgeschlagen“ bei der Einrichtung | Host erreichbar, TR-064 aktiviert, bei TLS oder abweichendem Port die Eingaben prüfen |
| „Benutzername oder Kennwort falsch“ | Mit denselben Daten an der Weboberfläche der Box anmelden; der Benutzer braucht das Recht „FRITZ!Box Einstellungen“ |
| „Mesh-Repeater“ bei der Einrichtung | Mit der Box verbinden, die der Mesh-Master ist |
| Es fehlen Schalter und Wake-on-LAN-Buttons | Dem Benutzer das Recht „FRITZ!Box Einstellungen“ geben (Hinweis unter Reparaturen) |
| Ein Gerät fehlt | Gerätefilter, Gastnetz, private MACs und die Option für Offline-Geräte prüfen; unter „Ausgeblendete Geräte“ nachsehen |
| Ein gelöschtes Gerät kommt zurück | Es war online, oder es wurde in den Optionen wieder eingeblendet |
| Der Schalter für den Internetzugang zeigt den alten Zustand | Die Box meldet Änderungen manchmal erst nach etwa einer Minute; der Schalter zeigt die neue Stellung bis dahin sofort |
| Internetzugang lässt sich nicht schalten | Das Gerät braucht eine IPv4-Adresse; reine IPv6-Geräte lassen sich nicht sperren. Die Box sperrt über die Adresse: Hat sie sich seit der letzten Aktualisierung geändert, lehnt der Schalter ab und funktioniert nach der nächsten Aktualisierung wieder |
| Ein Gerät steht doppelt | Es hat zwei MAC-Adressen (LAN und WLAN), oder eine private MAC hat gewechselt; das überzählige Gerät löschen oder per Filter ausblenden |
| Zu viele Entitäten | Option „Für Offline-Geräte keine Geräte anlegen“ einschalten, Filter nutzen |

Für detaillierte Meldungen unter **Einstellungen → System → Protokolle** nach `fritzbox_network` suchen. Mit Log-Stufe `debug` für `custom_components.fritzbox_network` erscheint pro Abfrage ihre Dauer.

## Entwicklung und Tests

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/ruff check custom_components tests tools
.venv/bin/pytest
node --test tests/js/*.test.mjs
```

Die letzte Zeile testet die Logik der Topologie-Karte und braucht Node.js.

Die Tests laufen gegen einen Fake-Client mit anonymisierten Aufnahmen einer FRITZ!Box (`tests/fixtures/`). `tools/spike.py` liest eine echte Box lesend aus (Geräteliste, Mesh, einige Dienste); Zugangsdaten kommen aus den Umgebungsvariablen `FRITZ_HOST`, `FRITZ_USER`, `FRITZ_PASSWORD` und optional `FRITZ_TLS=1`. Das Skript ändert nichts und schreibt nach `spike_out/` (nicht im Repository).

Wie du mitmachen kannst, steht in [CONTRIBUTING.md](../CONTRIBUTING.md).
