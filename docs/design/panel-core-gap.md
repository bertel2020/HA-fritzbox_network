# Panel: was FRITZ!Box Tools (Core `fritz`) überflüssig macht

Stand: 2026-11-07 · Status: Vorschlag, noch kein Code · Mockups:
[`mockups/box.html`](../../mockups/box.html),
[`mockups/wlan.html`](../../mockups/wlan.html),
[`mockups/portfreigaben-schalten.html`](../../mockups/portfreigaben-schalten.html),
[`mockups/migration.html`](../../mockups/migration.html)

Ziel: Wer FRITZ!Box Netzwerk nutzt, braucht die Core-Integration „AVM FRITZ!Box Tools“ nicht mehr. Dieses Papier beschreibt nur die **Panel- und Kartenseite**: wo jedes Teil in der Navigation steht, warum, was verworfen wurde, welche Texte und Websocket-Befehle dazukommen. Backend-Details (TR-064-Aktionen, Entitäten) nur so weit, wie das Frontend sie braucht.

Alle Mockups haben oben eine gestrichelte Leiste mit den Zuständen (Lädt, Fehler, Nur lesen, Nicht unterstützt …), dem Farbschema (System / Hell / Dunkel) und, wo es eine gibt, der Dashboard-Karte. Sie nutzen die Tokens aus `panel-styles.js` (Thema „Ozean“) und funktionieren ab 375 px Breite ohne waagerechtes Scrollen.

## 1. Navigation

Heute: **Netzwerk · Internet · VPN · Adressraum (Adressraum | Routen) · Diagnose · Verwalten (Einbinden | Aufräumen)**.

Beschlossen (das Menü soll nicht voller werden; ein erster Vorschlag mit acht Reitern wurde verworfen):

**Netzwerk (Geräte | WLAN | Adressraum | Routen) · Internet (Verbindung | VPN) · Box · Diagnose · Verwalten (Einbinden | Aufräumen | Umsteigen)**

Das sind **5 Reiter**, einer mehr als die 4 ohne VPN heute, aber einer weniger als mit VPN. Nur **Box** ist ein neuer Reiter. WLAN und Adressraum (mit den Routen) gehören zum Heimnetz und stehen unter Netzwerk, VPN als Weg von außen ins Heimnetz unter Internet. Die alten Adressen `#/addresses`, `#/routes` und `#/vpn` müssen nicht erhalten bleiben. Umsteigen erscheint nur, solange ein `fritz`-Eintrag existiert.

| Teil | Ort | Warum |
|---|---|---|
| Neustart, CPU-Temperatur, Laufzeit, Leitung, Byte-Zähler | neuer Reiter **Box** | Es geht um das Gerät selbst, nicht um das Netz dahinter. Die Byte-Zähler beginnen mit jedem Neustart bei null; sie gehören deshalb neben „Läuft seit“. |
| Neu verbinden | **Box** (Karte „Neu starten und neu verbinden“) und als kleiner Knopf im Kopf der Verbindung auf **Internet** | Beide Aktionen unterbrechen das Netz und haben dieselbe Rückfrage; nebeneinander sieht man den Unterschied. Auf der Internet-Seite bleibt der Knopf, weil man dort sieht, *ob* man ihn braucht. |
| `is_linked` | Kachel „Leitung“ auf **Internet** und Zeile „Leitung (physisch)“ auf **Box** | Unterscheidet „Leitung tot“ von „Einwahl scheitert“; der Hinweis oben auf der Internet-Seite nutzt das. |
| SSIDs schalten, Gastzugang, QR, Passwort | **Netzwerk › WLAN** | WLAN ist Teil des Heimnetzes. Zwei Tipps statt einem für „Gast will ins WLAN“ sind der Preis für ein kürzeres Menü. Kanal, Auslastung, Rauschen bleiben unter Netzwerk › Geräte (sie gehören zum Access Point, nicht zum Funknetz). |
| Portfreigaben schalten | bestehende Karte auf **Internet** (`panel-ports.js`), ein Schalter je Zeile | Die Karte gibt es schon; ein eigener Ort würde sie verdoppeln. |
| Rufumleitungen | Karte „Rufumleitungen“ unten auf **Box** | Telefonie bleibt sonst außen vor; ein Reiter „Telefon“ für drei Schalter wäre zu viel. Fehlt ganz, wenn die Box keine Telefonie hat. |
| Umsteigen | Unterseite **Verwalten › Umsteigen** und Hinweisband über jeder Seite | Verwalten ist der Ort für „was die Integration aufnimmt und aufräumt“. Die Unterseite erscheint nur, solange ein `fritz`-Eintrag existiert. |

Rufumleitungen: Das Backend deckt sie bewusst nicht ab (Telefonie bleibt außen vor), die Karte im Mockup `box.html` ist deshalb nur ein Gedankenspiel und wird nicht gebaut.

Der Reiter **Box** bekommt einen Punkt (wie Internet), solange ein Neustart läuft oder die CPU auffällig warm ist. Die Reihenfolge stellt die Alltagsseiten nach vorn, die Wartung nach hinten.

### Verworfen

- **Box-Daten in den Kopf** (Laufzeit, Temperatur neben „vor 19 s“): Der Kopf wurde gerade entrümpelt (`mockups/kopf.html`); auf dem Handy ist kein Platz.
- **Neustart in ein Menü im Kopf** (⋮ › Box neu starten): versteckt eine Aktion, die man im Notfall sucht; die Rückmeldung danach (Fortschritt, „wieder da nach 3:18“) braucht eine Seite.
- **Neustart weiter auf der Internet-Seite**: Ein Neustart betrifft WLAN, Telefon und Repeater, nicht nur das Internet. Die Aktionen-Karte am Ende der Internet-Seite entfällt.
- **WLAN, VPN und Adressraum als eigene Reiter** (ursprünglicher Vorschlag, 8 Reiter): zu voll, vor allem auf dem Handy. Stattdessen Unterreiter nach dem bestehenden Muster von Verwalten.
- **Ein Reiter „Telefon“**: Umfang zu klein, Telefonie bleibt bewusst außen vor.
- **Rufumleitungen unter Diagnose**: Diagnose misst und zeichnet auf, sie schaltet nichts.
- **Portfreigaben als eigene Seite unter Adressraum**: die Karte steht schon auf Internet, Nutzer kennen sie dort.
- **Umsteigen als Dialog aus dem Hinweisband**: Vorschau mit 50+ Zeilen, Konflikten und Fortschritt passt in keinen Dialog und muss das Verlassen der Seite überleben.
- **Umsteigen im Config-Flow/Options-Flow**: kann keine Tabelle mit Filtern und Auswahl zeigen; das Panel kann es.

## 2. Box (`mockups/box.html`)

**Aufbau:** Kopf „Box“ mit Satz; Hinweise (CPU warm, Box > 10 min weg); Karte mit Modell, FRITZ!OS, Adresse, Benutzer und den Kacheln *Läuft seit*, *Letzter Neustart*, *CPU-Temperatur* (mit 24-Std.-Verlauf als Sparkline), *FRITZ!OS*; daneben *Neu starten und neu verbinden* und *Anschluss* (Leitung, Internet, ↓/↑ seit dem Neustart); darunter *Rufumleitungen*.

**Neustart:** Rückfrage (Gefahr-Knopf) mit Liste, was wegfällt, auch „dieses Panel, falls HA per WLAN angebunden ist“. Danach Fortschritt in der Karte (`role="status"`): angefordert → nicht erreichbar seit … → antwortet wieder → Geräte und Mesh wieder da. Ergebnis: „Die Box ist wieder da (nach 3:18)“, *Läuft seit* springt auf 3 Min., *Letzter Neustart* „heute, 14:02 (von hier)“. Nach 10 Minuten ohne Antwort: Fehlerband „Prüfe Strom und Leuchtanzeigen“. Der Fortschritt kommt aus dem Abonnement (Feld `box.restart`, siehe 6), nicht aus einem Timer im Browser: Er überlebt Seitenwechsel und Neuladen.

**Neu verbinden:** Rückfrage, dann „Die Box wählt sich neu ein …“, danach IPv4 vorher/jetzt und das IPv6-Präfix (gleich oder neu).

**Zustände:** Lädt (Skelett), Fehler (Box antwortet nicht, „Erneut versuchen“), Nur lesen (Knöpfe und Schalter grau, Satz mit dem fehlenden Recht), nicht unterstützt (Temperatur „nicht gemeldet“, Telefonie-Karte fehlt; im Mockup als Platzhalter sichtbar), Warm.

**Dashboard-Karte** `custom:fritzbox-network-box-card`: vier Kacheln, Knöpfe nur mit `show_actions: true` und nur für Administratoren (die Befehle sind `require_admin`); fehlen sonst ganz. Während eines Neustarts dasselbe Band wie im Panel.

## 3. WLAN (`mockups/wlan.html`)

**Funknetze der Box:** je WLANConfiguration eine Zeile: SSID, Band, Kanal, Sicherheit, Geräte, Schalter. Gleicher Name auf beiden Bändern → Satz zum Band-Steering. Repeater folgen per Mesh (Satz).
- Einschalten ohne Rückfrage, mit Toast und Rückgängig.
- Ausschalten eines Hauptnetzes: Rückfrage mit Gerätezahl; ist es das letzte, zusätzlich „du verlierst die Verbindung zu diesem Panel“ und „die Repeater senden dann auch nicht mehr“.
- Während die Box schaltet (einige Sekunden): Schalter pulsiert und ist gesperrt, „wird geschaltet …“.

**Gastzugang:** Schalter, Bänder, Sicherheit, Gäste, getrennt/Zugriff/Automatisch aus (nur Anzeige, Ändern in der Box), *Passwort ändern …*. Rechts der QR-Bereich.

**Passwort, sorgfältig:**
1. Das Passwort steht **nie** im Abonnement und nie in `wlan/list`. Es kommt nur über `wlan/guest/secret`, auf Klick „QR-Code zeigen“.
2. Angezeigt wird es maskiert (`••••`), Auge-Knopf (`aria-pressed`) zeigt es, Kopieren-Knopf kopiert es (Toast sagt, dass es in der Zwischenablage bleibt).
3. Der Browser hält es nur im Zustand der offenen Seite; beim Verlassen der Seite, nach „Verbergen“, nach dem Ausschalten des Gastzugangs und nach 5 Minuten wird es verworfen. Nie in `localStorage`, nie in der URL, nie im `value`-Attribut gerendert.
4. **Ändern:** Dialog mit zwei Feldern `type="password"`, `autocomplete="new-password"`, `spellcheck="false"`, `autocapitalize="off"`; Auge-Knopf für beide; „Zufällig erzeugen“ (16 Zeichen ohne Verwechsler, in Vierergruppen, `crypto.getRandomValues`). Live-Regeln: 8–63 Zeichen, nur druckbares ASCII, kein Leerzeichen am Rand, beide gleich (WPA-PSK-Regeln, die Box lehnt sonst ab). Warnung „N Gäste werden getrennt, der alte QR-Code gilt nicht mehr“. „Passwort setzen“ erst aktiv, wenn alles grün ist. Danach Felder leeren, QR verwerfen, Toast.
5. **Backend:** nicht loggen, auch nicht im Fehlerfall (Fehlermeldungen der Box ohne Argumente weiterreichen), in `diagnostics.py` schwärzen, nur mit `require_admin` und `can_write`. Achtung: Home Assistant selbst schreibt eingehende Websocket-Nachrichten ins Debug-Log, wenn `homeassistant.components.websocket_api` auf `debug` steht. Das können wir nicht verhindern; die Anleitung sagt es, und der Dialog verspricht nur „wird nur an die Box geschickt und nirgends gespeichert“ (gilt für unseren Code).
6. QR-Inhalt `WIFI:T:WPA;S:<ssid>;P:<pw>;;` mit Escaping von `\ ; , : "`, im Browser erzeugt (kleiner QR-Encoder unter `frontend/vendor/`, keine Anfrage nach außen). `alt`/`aria-label` nennt nur die SSID.
7. „Gastkarte drucken“ öffnet eine Druckansicht (SSID, Passwort, QR) in einem `about:blank`-Fenster, das nach dem Drucken schließt.

**Zustände:** Lädt, Fehler beim Lesen (mit der Fehlermeldung der Box), Nur lesen (Schalter grau, QR/Passwort gesperrt mit Schloss und Begründung), kein Gastzugang eingerichtet (Hinweis, wo man ihn in der Box einrichtet), Box nennt kein WLAN (Mesh-Repeater / IP-Client).

**Dashboard-Karte** `custom:fritzbox-network-guest-card`: Schalter, SSID, QR. Der QR kommt aus der Entität `image.fritz_network_guest_wifi_qr` (standardmäßig aus, wie bei Core), nicht über den Admin-Befehl, damit die Karte auch auf einem Flur-Tablet mit Nicht-Admin-Benutzer geht. Der Karteneditor sagt beim Einschalten: „Jeder Benutzer von Home Assistant sieht dann das Passwort im QR-Code.“ Kein Passwort als Text auf der Karte.

## 4. Portfreigaben schalten (`mockups/portfreigaben-schalten.html`)

- Spalte **An** rechts in `.pfrule`, ein Schalter je zusammengeführter Zeile (IPv4 + IPv6). Zustand `teils offen` ⇒ `aria-checked="mixed"` (Schalter in Warnfarbe, Knopf mittig); ein Tipp öffnet dann alle Familien.
- „IPv4 und IPv6 einzeln“ klappt je Familie einen eigenen Schalter auf (IPv6 heißt in der Box „Pinhole“).
- **Öffnen fragt nach** („Danach erreicht jeder im Internet NAS an Port 1194 …“, Hinweis wenn das Gerät offline ist). **Schließen fragt nicht** (macht sicherer), Toast mit Rückgängig.
- Per UPnP geöffnete Freigaben: kein Schalter, Text „vom Gerät geöffnet“.
- Ohne Web-Oberfläche (`manual_known: false`): keine Schalter, Hinweis wie heute.
- Schalten scheitert: Schalter springt zurück, Toast mit der Meldung der Box.
- Kein eigener Dashboard-Schalter in einer Karte: Ports von einem Wand-Tablet aus zu öffnen ist ein Risiko. Für Automationen gibt es die Entitäten (`switch.fritz_network_port_<proto>_<port>`, standardmäßig aus).

## 5. Umsteigen (`mockups/migration.html`)

**Erkennung:** ein Eintrag der Domain `fritz`, dessen Seriennummer (oder Host) zu dieser Box passt. Für eine andere Box: kein Hinweis.

**Hinweisband** im Feld `#note` über jeder Seite, drei Varianten:
- warn: „FRITZ!Box Tools fragt dieselbe Box ab“ (Eintrag geladen, Tracking an) → *Umsteigen …* / *Später* (30 Tage, `localStorage`).
- info: Eintrag geladen, Tracking aus → *Ansehen* / *Ausblenden*.
- ok: nach der Übernahme, Eintrag noch da → *FRITZ!Box Tools öffnen* (Link auf `/config/integrations/integration/fritz`) / *Später*.
Zusätzlich ein Repair-Issue des Backends mit Link auf die Seite (verschwindet, wenn der Eintrag weg oder deaktiviert ist).

**Assistent** mit Schrittleiste *Prüfen · Vorschau · Übernehmen · Fertig* (`aria-current="step"`):
1. **Prüfen** (nur lesen): Fortschritt, Skelett-Kacheln.
2. **Vorschau** (Trockenlauf): Kacheln *Übernehmen / Konflikte / Kein Gegenstück / Übersprungen*, Filterknöpfe mit Zahlen, Tabelle nach Gruppen (Box, WLAN, Ports und Telefonie, Netzwerkgeräte; 31 gleichartige Tracker zusammengefasst). Spalten: Kästchen · FRITZ!Box Tools (Name, ID) · → · FRITZ!Box Netzwerk heute (ID, „bekommt die ID links“) · Ergebnis-Chip · Begründung. Auf dem Handy untereinander.
   - *übernehmen*: Gegenstück gefunden (gleiche MAC, gleicher Schlüssel). Hinweise wie „wird eingeschaltet“, „Einheit wechselt, Langzeitstatistik beginnt neu“, „Bild-Entität: jeder Benutzer sieht das Passwort“.
   - *Konflikt*: Auswahlfeld mit Lösungen, „Übernehmen“ bleibt gesperrt, bis alle entschieden sind. Beispiele: beide IDs in Automationen benutzt; Bereich widerspricht sich; Ziel-ID inzwischen belegt.
   - *kein Gegenstück*: Firmware-Button, Bereinigen, Dämpfung, MAC unbekannt (private Adresse).
   - *übersprungen*: in Core deaktiviert, Gerät hier nicht eingebunden (Link Einbinden).
   - Optionen: Entity-IDs übernehmen · Name/Bereich/Symbol/Labels übernehmen · alte Entitäten deaktivieren (nicht löschen; Endung `_fritz_tools`).
   - Karte **Backup**: letztes Backup aus `backup/info`, Link zu den Backups.
3. **Bestätigen**: Dialog mit Zahlen, „deaktiviert, nicht gelöscht“, „FRITZ!Box Tools bleibt eingerichtet“, letztes Backup.
4. **Übernehmen**: Fortschrittsbalken (`role="progressbar"`), laufendes Protokoll; „Du kannst die Seite verlassen“.
5. **Fertig**: Ergebnis-Kacheln inkl. Fehlern mit Grund; *Protokoll herunterladen (JSON)*; *Rückgängig machen …* (solange der Core-Eintrag existiert); To-do: FRITZ!Box Tools selbst entfernen (Link, „dort ⋮ › Löschen“), Automationen mit Entitäten ohne Gegenstück, Automationen, die ein Konflikt berührt hat.

**Nie still löschen:** Das Panel ruft kein `config_entries/delete` auf und entfernt keine Entität. Es deaktiviert höchstens (Option) und benennt um; beides macht *Rückgängig* zurück.

**Weitere Zustände:** kein FRITZ!Box Tools (Unterseite fehlt im Menü), andere Box, Core deaktiviert (Übernahme trotzdem möglich), Fehler beim Prüfen.

## 6. Websocket-Befehle

Konventionen wie in `websocket_api.py`: Name `fritzbox_network/<bereich>/<verb>`, immer `entry_id`, `@require_admin`, schreibende Befehle prüfen `coordinator.can_write` und antworten sonst `ERR_UNAUTHORIZED` „No right to change settings“; Fehler der Box als `ERR_UNKNOWN_ERROR` mit dem Text; schreibende Befehle antworten mit der Liste, wie die Box sie danach nennt (wie `routes/switch`).

### Ohne neuen Befehl (Abonnement `subscribe_topology`)

| Feld | Inhalt |
|---|---|
| `internet.is_linked` | `true/false/null` |
| `box` | `{ model, firmware, uptime, last_restart, cpu_temperature, bytes_received, bytes_sent, restart: null \| { requested_at, unreachable_since, back_at } }` — Temperatur und Zähler `null`, wo die Box sie nicht nennt |
| `core_fritz` | `null \| { entry_id, title, state: "loaded"\|"disabled"\|…, same_box, tracking }` für das Hinweisband |

Bestehend und unverändert genutzt: `fritzbox_network/box/reboot`, `fritzbox_network/internet/reconnect` (`{entry_id}` → `{}`). Neu wäre bei `box/reboot` nur, dass das Backend `box.restart` setzt.

### Neu

| Befehl | Nutzlast | Ergebnis |
|---|---|---|
| `fritzbox_network/box/temperature` | `{entry_id}` | `{ points: [[ts, °C], …] }` — 24 Std. für die Sparkline, auf Abruf beim Öffnen der Seite |
| `fritzbox_network/wlan/list` | `{entry_id}` | `{ networks: [{ id: "wlan1", band: "2.4"\|"5"\|"6", ssid, enabled, guest, security, channel, clients, hidden }], guest: { id, isolation, auto_off, changed_at } \| null }` — **ohne Passwort** |
| `fritzbox_network/wlan/switch` | `{entry_id, id, enabled}` | wie `wlan/list` |
| `fritzbox_network/wlan/guest/secret` | `{entry_id}` | `{ ssid, security, password }` — nur `can_write`, nie geloggt |
| `fritzbox_network/wlan/guest/password` | `{entry_id, password}` — Schema `vol.All(str, vol.Length(min=8, max=63), vol.Match(r"^[\x20-\x7e]+$"))` | wie `wlan/list`; Fehler `invalid_format`, wenn die Box ablehnt |
| `fritzbox_network/ports/switch` | `{entry_id, protocol, external_port, client, family: "ipv4"\|"ipv6"\|"both", enabled}` | `{ entries, manual_known }` wie `ports/list`; nur für `source: "manual"`, sonst `ERR_NOT_SUPPORTED` |
| `fritzbox_network/phone/deflections` | `{entry_id}` | `{ entries: [{ id, kind, from, to, enabled }] }` — Nummern gekürzt (`0171 •••• 23`), `null` ohne Telefonie |
| `fritzbox_network/phone/deflection/switch` | `{entry_id, id, enabled}` | wie `phone/deflections` |
| `fritzbox_network/migrate/scan` | `{entry_id}` | `{ core: {entry_id, title, host, state, same_box} \| null, rows: [{ core_entity_id, core_name, group, target_entity_id \| null, status: "migrate"\|"conflict"\|"none"\|"skip", reason, notes: [..], choices?: [..], used_by: [automation_ids] }], token }` — ändert nichts |
| `fritzbox_network/migrate/run` | `{entry_id, core_entry_id, token, rows: [{core_entity_id, choice?}], options: {take_ids, take_custom, disable_old}}` | Abonnement-artig (`event_message`): `{type:"progress", done, total, core_entity_id, outcome}` …, dann `{type:"done", results, log}`. `token` aus `scan`: hat sich die Registry seitdem geändert, Abbruch mit `ERR_INVALID_FORMAT` „Preview outdated“ (wie `expected_remove` bei `filter/apply`). |
| `fritzbox_network/migrate/status` | `{entry_id}` | letzter Lauf `{ state: "running"\|"done", done, total, results }` — damit die Seite nach dem Neuladen weiß, wo sie steht |
| `fritzbox_network/migrate/undo` | `{entry_id, run_id}` | wie `done`; nur solange der Core-Eintrag existiert |

Das Backup-Datum liest das Panel mit dem Core-Befehl `backup/info`; kein eigener Befehl.

## 7. Texte (`texts.js`, de und en)

Neue Schlüssel (Auszug, Struktur wie `t.inet.actions`):

- `tabs.wlan` „WLAN“ / “Wi-Fi”, `tabs.box` „Box“ / “Box”, `tabs.migrate` „Umsteigen“ / “Switch over”.
- `box.{title, lead, running, restarting, uptime, lastRestart, lastRestartHere, cpuTemp, cpuTempRange, notReported, firmware, line, linked, notLinked, connected, received, sent, sinceRestart, lineNote}`
- `box.hints.{hot, gone}` — „Die CPU der Box ist {temp} °C warm, {diff} °C mehr als ihr Mittel der letzten 7 Tage …“
- `box.actions.{title, reconnect, reconnectSub, reboot, rebootSub, hint, noRights, rebootTitle, rebootBody, rebootList[], rebootOk, reconnectTitle, reconnectBody, reconnectOk}` — die heutigen `inet.actions.*` ziehen hierher um; `inet.actions` bleibt nur mit `reconnect`.
- `box.restart.{requested, unreachable, answers, meshBack, inProgress, back, late, presenceHeld, presenceKept, hide}`
- `box.reconnectDone.{title, before, after, prefixSame}`
- `inet.linkTile`, `inet.hints.{linkedNoInternet, notLinked}`
- `phone.{title, forNumber, hint, noRights, none, toastOn, toastOff}`
- `wlan.{title, lead, radios, band, channel, clients, switching, sameName, meshFollows, noRights, allOff, offTitle, offBody, offLast[], offOk, toastOn, toastOff, error, noWlan, noGuest}`
- `wlan.guest.{title, guests, isolation, access, autoOff, changed, edit, showQr, qrHint, qrOff, qrLocked, hideQr, reveal, conceal, copy, copied, print, entityHint}`
- `wlan.pw.{title, lead, new, repeat, generate, show, ruleLength, ruleAscii, ruleSpace, ruleSame, kick, ok, busy, done, rejected}`
- `inet.ports.{colOn, byDevice, single, v4, v6, openTitle, openBody, openOffline, openOk, toastOpened, toastClosed, failed, upnpLocked}`
- `migrate.{title, lead, steps[], banner.{dup, dupBody, quiet, quietBody, done, doneBody, start, later, look, openCore}, scan, tiles.{migrate, conflict, none, skip}, filters.{…}, cols.{core, ours, result}, status.{migrate, conflict, none, skip}, getsId, keeps, more, options.{ids, idsSub, custom, customSub, disable, disableSub}, backup.{title, body, last, open}, openConflicts, count, confirm.{title, body, list[], ok}, running, leaveOk, done.{title, body, error, download, undo, undoTitle, undoBody}, todo.{removeCore, removeBody, automations, conflictTouched}, empty.{none, other, disabled, error}}`

Die Umlaute und „FRITZ!Box“ stehen wie in den Mockups; Englisch analog zu den bestehenden Texten (kurz, Du-Form im Deutschen).

## 8. Barrierefreiheit

- **Schalter** sind `button role="switch"` mit `aria-checked` (`mixed` bei „teils offen“) und einem `aria-label`, das sagt, *was* geschaltet wird („WLAN FRITZ-RM, 5 GHz“, „HTTPS TCP 443 zu Home Assistant“). Gesperrt mit `disabled`, der Grund steht als Text daneben, nicht nur als Tooltip.
- **Laufende Vorgänge** (Neustart, Neuverbindung, WLAN schaltet, Übernahme) in einem Bereich mit `role="status"`/`aria-live="polite"`; der Übernahme-Balken ist `role="progressbar"` mit `aria-valuenow`. `aria-busy="true"` auf Karten im Ladezustand, Skelette mit `prefers-reduced-motion` ohne Animation.
- **Dialoge** wie `panel-dialogs.js`: `role="dialog"`, `aria-modal`, `aria-labelledby`, Fokus beim Öffnen auf „Abbrechen“ (bei Gefahr) bzw. auf das erste Feld, Tab bleibt im Dialog, Esc bricht ab, danach Fokus zurück auf den auslösenden Knopf. `openDialog` braucht dafür eine Erweiterung um Passwortfelder und Regel-Liste; die Regel-Liste ist `aria-live`, „Passwort setzen“ erst aktiv, wenn alles erfüllt ist, und das erste Feld hat `aria-describedby` auf die Regeln.
- **Passwort zeigen**: Knopf mit `aria-pressed` und `aria-controls`, Beschriftung wechselt („Passwort anzeigen / verbergen“). Der maskierte Text hat `aria-label="Passwort"`, damit Screenreader nicht zwölf Punkte vorlesen.
- **QR-Code**: `role="img"` mit Name „QR-Code zum Verbinden mit <SSID>“, ohne Passwort; daneben steht das Passwort als Text (abrufbar), damit es ohne Kamera geht.
- **Farbe ist nie allein**: Chips tragen Text („offen“, „Konflikt“), Ergebnisse in der Migration ein Zeichen (✓/!).
- **Tabelle Umsteigen** auf dem Handy als Liste; jede Zeile hat Kästchen mit `aria-label` „<Name> übernehmen“, Auswahlfelder „Lösung für <Name>“.
- **Ziele** ≥ 40 px (Knöpfe, Schalter 52×32), Fokusring `--focus` wie im Panel.
- **Nach Seitenwechsel** Fokus auf `#dtitle` wie bisher.

## 9. Offene Fragen

1. Liefert TR-064 `DeviceInfo` die CPU-Temperatur, oder nur `data.lua` (`ecoStat`)? Davon hängt ab, ob sie mit dem Poll kommt oder auf Abruf (`box/temperature`).
2. Lässt sich eine von Hand gesetzte Portfreigabe per TR-064 schalten, oder nur über die Web-Oberfläche (wie das Lesen)? Spike wie bei den Routen, vorher abstimmen.
3. `X_AVM-DE_OnTel:SetDeflectionEnable` braucht womöglich ein zusätzliches Recht; der Text „Nur lesen“ nennt es vorsorglich.
4. Behält die Langzeitstatistik nach dem ID-Tausch die alte Einheit, wenn sie wechselt? Im Mockup als Hinweis „beginnt neu“; vor dem Bau prüfen.
