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
| Sensor | Zuletzt gesehen | an | Zeitstempel; ändert sich nur beim Online- und Offline-Gehen und bleibt nach einem Neustart erhalten |
| Schalter | Internetzugang | an | An = darf ins Internet. Nur mit dem Recht „FRITZ!Box Einstellungen“ und nur für Geräte mit IPv4-Adresse. Die Box meldet die Änderung manchmal erst nach etwa einer Minute; der Schalter zeigt sie bis dahin sofort an. |
| Button | Wake on LAN | aus | Nur mit dem Recht; nicht für Geräte, die als WLAN bekannt sind |
| Binärsensor | Gastnetz | nur für Gastgeräte an | Diagnose |
| Sensor | Signalstärke | aus | in dBm, nur für WLAN-Geräte; die Sicht des Access Points auf das Gerät |
| Sensor | Link-Rate Download / Upload | aus | in Mbit/s, aus der Sicht des Geräts |
| Sensor | WLAN-Band | aus | 2,4 / 5 / 6 GHz |
| Sensor | Netzwerkname (SSID) | aus | |

Signalstärke, Link-Rate, Band und SSID kommen aus den Mesh-Daten der Box, ohne zusätzliche Abfrage. Sie entstehen nur für Geräte, für die die Box eine Verbindung kennt, und sind Diagnose-Entitäten.

### Box und Repeater

Die FRITZ!Box und jeder Repeater sind eigene Geräte mit Modell und Firmware. Pro Gerät gibt es den Sensor **Verbundene Geräte** (Anzahl der Geräte, die an diesem Access Point hängen). Ein Repeater ist zugleich sein Eintrag in der Geräteliste, also ein einziges Gerät.

### Ereignis

Wird ein Gerät in der Box umbenannt, löst Home Assistant das Ereignis `fritzbox_network_device_renamed` aus, mit `mac`, `old_name` und `new_name`.

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
| Internetzugang lässt sich nicht schalten | Das Gerät braucht eine IPv4-Adresse; reine IPv6-Geräte lassen sich nicht sperren |
| Ein Gerät steht doppelt | Es hat zwei MAC-Adressen (LAN und WLAN), oder eine private MAC hat gewechselt; das überzählige Gerät löschen oder per Filter ausblenden |
| Zu viele Entitäten | Option „Für Offline-Geräte keine Geräte anlegen“ einschalten, Filter nutzen |

Für detaillierte Meldungen unter **Einstellungen → System → Protokolle** nach `fritzbox_network` suchen. Mit Log-Stufe `debug` für `custom_components.fritzbox_network` erscheint pro Abfrage ihre Dauer.

## Entwicklung und Tests

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/ruff check custom_components tests tools
.venv/bin/pytest
```

Die Tests laufen gegen einen Fake-Client mit anonymisierten Aufnahmen einer FRITZ!Box (`tests/fixtures/`). `tools/spike.py` liest eine echte Box lesend aus (Geräteliste, Mesh, einige Dienste); Zugangsdaten kommen aus den Umgebungsvariablen `FRITZ_HOST`, `FRITZ_USER`, `FRITZ_PASSWORD` und optional `FRITZ_TLS=1`. Das Skript ändert nichts und schreibt nach `spike_out/` (nicht im Repository).

Wie du mitmachen kannst, steht in [CONTRIBUTING.md](../CONTRIBUTING.md).
