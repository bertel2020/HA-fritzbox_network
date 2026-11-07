# Panel: Unterseite „Telefon“ aus FRITZ!Box Telefon

Stand: 2026-11-07 · Status: Vorschlag, noch kein Code · Mockup: [`mockups/telefon.html`](../../mockups/telefon.html)

Ziel: Unter dem Reiter **Box** gibt es einen Unterreiter **Telefon** neben **Übersicht**, aber nur, wenn die Integration [FRITZ!Box Telefon](https://github.com/bertel2020/HA-fritzbox_phone) (`fritzbox_phone`) geladen ist. Die Seite **liest nur** deren Entitäten (`hass.states`) und **ruft deren Dienste** (`hass.callService`). Sie rechnet, filtert und schreibt nichts selbst, was `fritzbox_phone` schon kann, und spricht nie direkt mit der Box. FRITZ!Box Netzwerk bekommt dafür **keinen Python-Code**.

Das widerspricht nicht dem Beschluss in [`panel-core-gap.md`](panel-core-gap.md) („Telefonie bleibt außen vor“, kein eigener Reiter Telefon): Telefonie bleibt im Backend draußen, und es kommt kein Reiter dazu, nur ein Unterreiter, der ohne die andere Integration gar nicht erscheint.

## 1. Navigation und Erkennung

**Netzwerk · Internet · Box (Übersicht | Telefon) · Diagnose · Verwalten**

- Ohne `fritzbox_phone` hat Box **keine Unterreiter**; die Seite sieht aus wie in `mockups/box.html`. Kein Hinweis, keine Werbung. `#/box/phone` leitet dann auf `#/box` um.
- Erkannt wird `fritzbox_phone`, wenn `hass.config.components` den Eintrag `"fritzbox_phone"` enthält **und** `hass.entities` mindestens eine Entität mit `platform === "fritzbox_phone"` hat. Beides wird bei jedem `hass`-Wechsel neu bewertet (die Integration kann nachträglich geladen oder entladen werden).
- Der Unterreiter trägt die Zahl ungehörter Nachrichten als Plakette (aus `binary_sensor.*_ungelesene_nachrichten`, Attribut `count`). Klingelt es, bekommt der Reiter Box einen Punkt (wie der Neustart-Punkt).

### Entitäten finden: über `translation_key`, nicht über die ID

Die Entitäts-IDs hängen von Sprache und Box-Namen ab (`sensor.fritz_box_7590_ax_anrufliste`). Das Panel sucht in `hass.entities` (Anzeige-Registry) nach `platform: "fritzbox_phone"` und `translation_key`:

| `translation_key` | Domäne | Je Eintrag | Bemerkung |
|---|---|---|---|
| `call_list` | sensor | 1 | Pflicht; ohne sie zeigt die Seite „nicht verfügbar“ |
| `missed_calls` | sensor | 1 | wird nicht gebraucht (Filter rechnet aus `call_list`) |
| `calls_today` | sensor | 1 | |
| `talk_time_today` | sensor | 1 | |
| `spam_calls_today`, `spam_calls_total` | sensor | 0–1 | nur mit PhoneBlock |
| `phoneblock_status`, `reverse_lookup_status` | sensor | 0–1 | Diagnose, standardmäßig aus |
| `phonebook` | sensor | n | eine je Telefonbuch |
| `answering_machine` | sensor | n | eine je Anrufbeantworter |
| `call_monitor` | sensor | 0–1 | nur mit Anrufmonitor |
| `ringing` | binary_sensor | 0–1 | nur mit Anrufmonitor |
| `unread_messages` | binary_sensor | 0–1 | erst, wenn es einen AB gibt |
| `call` | event | 0–1 | nur mit Anrufmonitor; die Seite braucht es nicht |
| `tam_enabled` | switch | n | je AB |
| `deflection_enabled` | switch | n | je Rufumleitung |

`translation_key` und `platform` stehen in `hass.entities` (zu prüfen: in allen unterstützten HA-Versionen; sonst Rückfall auf `hass.callWS({type: "config/entity_registry/list_for_display"})`).

### Mehrere Boxen

Die Zuordnung läuft über das Gerät: Jede `fritzbox_phone`-Entität hat ein Gerät mit Kennung `("fritzbox_phone", entry_id)` und `serial_number` der Box. FRITZ!Box Netzwerk kennt die Seriennummer seiner Box (Gerät `("fritzbox_network", serial)`).

1. Für jede Entität über `hass.entities[id].device_id` → `hass.devices[device_id]` die `serial_number` und `config_entries` holen.
2. Den `fritzbox_phone`-Eintrag nehmen, dessen Gerät dieselbe Seriennummer wie die eigene Box hat.
3. Gibt es keinen Treffer, aber genau einen `fritzbox_phone`-Eintrag, diesen nehmen und in der Kopfzeile „andere Box?“ zeigen. Bei mehreren ohne Treffer: Auswahlfeld (Mockup-Zustand „Zwei Boxen“).
4. Alle Dienstaufrufe gehen mit `target: { device_id }` dieses Geräts. **Wichtig:** Bei mehr als einem geladenen Eintrag verlangt `fritzbox_phone` ein Ziel (`device_required`), sonst schlägt der Aufruf fehl.

Offen: ob `hass.devices` im Panel `serial_number` enthält (Feld der Registry; im Frontend-Typ vorhanden). Sonst über `configuration_url` (Host) abgleichen.

## 2. Was jeder Teil liest und aufruft

Alle Attributnamen exakt wie in `fritzbox_phone/sensor.py`, `binary_sensor.py`, `services.yaml`.

### Kopfzeile

- „Daten von FRITZ!Box Telefon · Eintrag <Titel>“: Gerätename aus `hass.devices`.
- „Anrufmonitor verbunden/getrennt“: `sensor.*_anrufmonitor` verfügbar oder `unavailable` (Socket zu Port 1012; muss an der Box mit `#96*5*` eingeschaltet sein). Fehlt die Entität: Optionen der Integration → Anrufmonitor aus.
- Link „Zur Integration“: `/config/integrations/integration/fritzbox_phone`.

### Live-Band (oben, nur bei Anruf)

Quelle `sensor.*_anrufmonitor` (`translation_key: call_monitor`), Zustand `idle | ringing | dialing | talking`.

| Zustand | Anzeige | Attribute |
|---|---|---|
| `ringing` | „Es klingelt: <Name/Nummer>“, Spamverdacht rot, Knopf „Sperren …“ | `from`, `from_name`, `to`, `vip`, `area_name`, `device`, `initiated`; bei Unbekannten zusätzlich `is_spam`, `spam_confidence`, `spam_rating`, `spam_location`, `reverse_name`, `reverse_category` |
| `dialing` | „Wählt <Nummer>“; nach eigenem `dial` mit „Abbrechen“ → `hangup` | `to`, `to_name`, `device` |
| `talking` | „Gespräch mit <Name>“, seit, Gerät | `with`, `with_name`, `vip`, `device`, `accepted` |
| `idle` | kein Band | — (die Felder des letzten Gesprächs bleiben stehen, die Seite ignoriert sie) |

`role="status"`, bei `ringing` `aria-live="assertive"`, sonst `polite`. Der Anrufmonitor wird in der Karte auch im Privatsphäre-Modus **nicht** verdeckt; das Panel macht es genauso.

**`hangup` bricht nur einen per `dial` gestarteten Wählvorgang ab** (`X_AVM-DE_DialHangup`), kein laufendes Gespräch. Den Knopf gibt es deshalb nur im Zustand `dialing` nach eigenem Wählen.

### Tageszahlen

| Kachel | Quelle |
|---|---|
| Anrufe | `sensor.*_anrufe_heute` (Zustand), Attribute `incoming`, `outgoing`, `missed` |
| Verpasst | Attribut `missed` desselben Sensors |
| Gesprächszeit | `sensor.*_gespraechszeit_heute` (Minuten, je Anruf aufgerundet) |
| Spam | `sensor.*_spam_anrufe_heute`; Untertitel aus `sensor.*_erkannte_spam_anrufe` (laufender Zähler) — beide fehlen ohne PhoneBlock, dann fehlt die Kachel |

Hinweis „laut Anrufliste der letzten N Tage“: Die Zahlen können nur so vollständig sein wie das Fenster der Anrufliste (Optionen `call_list_days`, Standard 7, `call_list_max`, Standard 50). N steht nicht in einem Attribut (siehe Offene Fragen).

### Anrufliste

Quelle `sensor.*_anrufliste`, Attribut **`calls`** (nicht im Recorder, nur im Live-Zustand), jedes Element:

`id, type, name, caller, caller_number, called, called_number, device, port, date, duration, is_fax, is_answering_machine, has_recording, tam_index, tam_message_index, area_name, is_spam, spam_confidence, spam_rating, spam_location, reverse_name, reverse_category`

- `type`: `incoming | missed | outgoing | active_incoming | rejected_incoming | active_outgoing` (aus `CALL_TYPE_NAMES`); unbekannte Werte als „Anruf“ zeigen, nicht verwerfen.
- `date`: Zeichenkette der Box `"07.11.26 14:12"` (TT.MM.JJ HH:MM, Ortszeit der Box). Gruppierung nach Tag (Heute, Gestern, Wochentag + Datum). Nicht lesbares Datum → Gruppe „Ohne Datum“ am Ende.
- `duration`: **`h:mm`** (Stunden:Minuten, aufgerundet), **nicht** m:ss. „0:31“ sind 31 Minuten.
- Gegenüber-Nummer: bei ausgehend `called_number || called`, sonst `caller_number || caller` (wie `callNumber()` der Karte). Anrufen nur, wenn die Nummer Ziffern enthält.
- Anzeigename: `name` → `reverse_name` (Tellows) → Nummer → „Unbekannt“.
- Filter (clientseitig, `aria-pressed`): Alle · Verpasst (`missed`, `rejected_incoming`) · Eingehend · Ausgehend · Spam (`is_spam`). Suche über Name, `reverse_name`, `area_name`, Nummer (Ziffern ohne Leerzeichen).
- Je Zeile aufklappbar (`aria-expanded`), Aktionen:

| Aktion | Dienst | Daten |
|---|---|---|
| Zurückrufen / Erneut anrufen | `fritzbox_phone.dial` | `{ number }`, Ziel `device_id` |
| Sperren … (Rückfrage) | `fritzbox_phone.block_number` | `{ number, name? }` (name ≤ 64) |
| Rückgängig im Toast | `fritzbox_phone.unblock_number` | `{ number }`; Fehler `number_not_blocked` möglich |
| Ins Telefonbuch … | `fritzbox_phone.add_contact` | `{ number, name, phonebook_id }` (Standard 0); Fehler `contact_exists` |
| Nachschlagen | `fritzbox_phone.lookup_number` | `{ number }`, **mit `returnResponse: true`**; Antwort `{ number, contact: {name, vip} \| null, area_name, spam: {is_spam, confidence, rating, location} \| null, reverse_lookup: {name, category, score, is_spam} \| null }` |
| Zur Nachricht (nur AB-Anrufe) | — | springt über `tam_index` + `tam_message_index` zur Nachricht |

Alle Nummern laufen im Dienst durch `^[0-9+*#()\-/ ]{1,32}$`; das Panel prüft dasselbe vorher und zeigt den Fehler am Feld.

`spam_rating` ist ein PhoneBlock-Code: `A_LEGITIMATE, B_MISSED, C_PING, D_POLL, E_ADVERTISING, F_GAMBLE, G_FRAUD` (Texte wie in der Karte). `spam_confidence` 0–100.

### Anrufbeantworter

Quelle je AB `sensor.*_<name>` (`translation_key: answering_machine`), Zustand = Zahl neuer Nachrichten. Attribute:

`tam_index, enabled, running, capacity_minutes_remaining, total_messages, privacy_mode, messages[]` mit `index, name, number, called, date, key, duration, new, in_phonebook, has_recording, recording_path, area_name, is_spam, spam_confidence, spam_rating, spam_location, reverse_name, reverse_category`.

| Aktion | Wie |
|---|---|
| Abspielen im Browser | `hass.callWS({ type: "auth/sign_path", path: message.recording_path, expires: 3600 })` → `<audio src>`; die Aufnahme kommt über `FritzBoxRecordingView` (`/api/fritzbox_phone/recording/<entry_id>/<tam_index>/<message_index>?key=…`, `requires_auth`), nie direkt von der Box. Signierte Adresse ~50 Min. wiederverwenden (wie die Karte). |
| Als gelesen beim Abspielen | `fritzbox_phone.mark_message_read` `{ entity_id, message_index, message_key: message.key, read: true }` |
| Gelesen/ungelesen | dasselbe mit `read: true/false` |
| Auf Lautsprecher … | `fritzbox_phone.play_message` `{ entity_id, message_index, message_key, media_player }`; braucht eine interne URL in HA (`no_internal_url`) |
| Herunterladen | **nicht** `download_message` (veraltet, legt die Datei **ohne Anmeldung** unter `/local` ab), sondern die signierte Adresse als `<a download>` |
| Löschen … (Rückfrage) | `fritzbox_phone.delete_message` `{ entity_id, message_index, message_key }` |
| AB ein/aus | `switch.turn_on/turn_off` auf `switch.*` mit `translation_key: tam_enabled` (Zuordnung über dasselbe Gerät und den Namen; siehe Offene Fragen) |

Immer `message_key` mitgeben: Die Box nummeriert Nachrichten nach dem Löschen neu, der Schlüssel (`"<date>|<number>"`) lässt den Dienst bzw. die Ansicht ablehnen, statt die falsche Nachricht zu treffen.

`has_recording: false` → Knöpfe Abspielen/Herunterladen fehlen, Text „Keine Aufnahme“. Kein AB → Karte „Kein Anrufbeantworter eingerichtet“ mit Weg in der Box.

### Telefonbuch

Quelle je Telefonbuch `sensor.*_<name>` (`translation_key: phonebook`), Zustand = Anzahl. Attribut `contacts[]`: `name, vip, uniqueid, has_image, numbers[{ number, type }]`, dazu `privacy_mode`.

- Umschalter zwischen Telefonbüchern (nur bei mehreren), Suche über Name und Nummer, VIP zuerst, dann alphabetisch (`localeCompare("de")`).
- Bei großen Büchern höchstens 50 Zeilen, „N weitere – die Suche eingrenzen“ (wie die Karte).
- `type` (Werte der Box, u. a. `home, mobile, work, fax_work, intern, other`) als „privat, mobil, geschäftlich, Fax …“; unbekannte Typen roh zeigen. Fax-Nummern ohne Anrufen-Knopf.
- Aktion: Anrufen je Nummer (`dial`). Bearbeiten nicht, nur Link „in der Box“.

### Anrufen-Dialog

Feld „Nummer oder Name aus dem Telefonbuch“, Vorschläge aus allen `contacts` (Listbox), Prüfung wie oben, dann `dial`. **Der Dienst kennt keine Auswahl des Telefons**: `X_AVM-DE_DialNumber` klingelt das Telefon an, das in der Box unter Telefonie › Telefoniegeräte › Wählhilfe eingestellt ist; die Wählhilfe muss dort eingeschaltet sein. Der Dialog sagt das, statt ein Auswahlfeld zu zeigen.

### Statistik (eigene Ansicht)

Umschalter unter der Überschrift: **Anrufe und Nachrichten | Statistik** (`aria-pressed`, Mockup: Knopf „Statistik“). Die Statistik ist der einzige Teil, der im Browser selbst zählt; sie rechnet **nur** aus Daten, die die Seite ohnehin liest: `attributes.calls` der Anrufliste, `sensor.*_spam_anrufe_heute`, `sensor.*_erkannte_spam_anrufe`, die Nachrichtenliste des AB. Kein neuer Befehl, kein Recorder-Abruf in Stufe 1.

**Wie weit sie zurückreicht.** So weit wie die Anrufliste von `fritzbox_phone`: Optionen `call_list_days` (Standard **7 Tage**) und `call_list_max` (Standard **50 Anrufe**); dazu die Grenze der Box selbst (je Modell, nicht geprüft). Das Attribut `calls` steht in `_unrecorded_attributes`, d. h. **es gibt keine Historie davon im Recorder**: Was aus der Liste fällt, ist für die Statistik weg. Die Ansicht sagt das immer oben: „Zeitraum: die letzten 312 Anrufe, seit 14.09. Mehr hält die Anrufliste nicht …“. Mit den Standardwerten ist „30 Tage“ also meist nur eine Woche; der Text sagt dann ausdrücklich, dass 7 Tage, 30 Tage und „Alles“ dasselbe zeigen (Mockup-Zustand „Kurze Liste“), und nennt die Optionen der Integration als Abhilfe.

| Teil | Rechnung | Daten | Grenzen |
|---|---|---|---|
| Zeitraum-Umschalter | Heute · 7 Tage · 30 Tage · Alles (was die Liste hält) | `date` | — |
| Änderung zum Zeitraum davor | gleiche Länge direkt davor; „Heute“ gegen gestern | `date` | Reicht die Liste nicht vollständig zurück: ab halber Abdeckung „Vergleich unvollständig (25 von 30 Tagen)“, darunter kein Vergleich; bei „Alles“ nie. Pfeil ▲/▼ plus Text, keine Farbe (mehr Anrufe ist weder gut noch schlecht). |
| Anrufe | Anzahl, Ø je Tag | `calls` | — |
| Anrufe je Tag (gestapelte Säulen) | Heute je Stunde, bis 31 Tage je Tag, „Alles“ darüber je Woche | `type`, `is_spam`, `is_answering_machine` | Eine Kategorie je Anruf: Spam vor allem anderen; verpasst = `missed`, `rejected_incoming` und Anrufe, die beim AB landeten (niemand nahm ab); ausgehend = `*outgoing`; sonst eingehend. |
| Wann es klingelt (Heatmap) | Wochentag × 3-Stunden-Block, Anzahl je Feld | `date` (Ortszeit der Box) | Bei kurzer Liste wenig aussagekräftig; der Text bleibt sachlich. |
| Gesprächszeit gesamt, Ø je Gespräch | Summe der Minuten der angenommenen Anrufe (`incoming`/`outgoing`, ohne AB), geteilt durch deren Zahl | `duration` (`h:mm`) | Die Box rundet **jeden** Anruf auf die Minute auf; der Schnitt ist daher zu hoch, der Text sagt das. Keine Sekunden. |
| Verpasst-Quote | verpasst / alle nicht-ausgehenden | wie oben | Änderung in Prozentpunkten |
| Spam erkannt | im Zeitraum aus `is_spam`; „heute“ = `sensor.*_spam_anrufe_heute`; „gesamt“ = `sensor.*_erkannte_spam_anrufe` | | **Erkannt, nicht blockiert**: `is_spam` ist das Urteil von PhoneBlock, die Box hat den Anruf trotzdem durchgelassen, außer er steht als `rejected_incoming` in der Liste. Ein „blockiert“-Zähler ist aus den Daten nicht zu bekommen. Ohne PhoneBlock fehlt die Kachel. |
| Auf den AB | Anrufe mit `is_answering_machine` im Zeitraum, dazu „N ungehört“ aus den Nachrichten | `calls`, `messages[].new` | Die Nachrichtenliste kennt nur, was noch auf der Box liegt; gelöschte Nachrichten zählen über die Anrufliste mit. |
| Wer am meisten anruft / wen du am meisten anrufst | Top 5 nach Anzahl, Gesprächsminuten daneben | `caller_number` bzw. `called_number`, Name aus `name` (das ist schon der Telefonbuchname von `fritzbox_phone`), VIP aus `vip` des Kontakts | Ohne Namen: Nummer und `area_name`, bei Spam „Spamverdacht“. Nummern werden über die Ziffern gruppiert; dieselbe Person mit zwei Nummern steht zweimal (keine Zusammenführung über das Telefonbuch in Stufe 1). |
| Je eigener Rufnummer | eingehend `called_number`, ausgehend `caller_number` | | Namen der eigenen Nummern („Rufnummer 1“) liefert `fritzbox_phone` nicht; nur die Nummer (Offene Frage 11). Nach Gerät (`device`) ginge genauso, ist aber nicht im Mockup. |

**Nicht machbar** aus den Daten von `fritzbox_phone` (bewusst weggelassen): Statistik über das Listenfenster hinaus; „blockierte“ Anrufe als eigene Zahl; exakte Gesprächsdauer (nur der Anrufmonitor kennt Sekunden, und nur für das letzte Gespräch); Klingeldauer verpasster Anrufe.

**Später möglich ohne Code in `fritzbox_phone`:** Langzeitwerte aus der HA-Statistik per `recorder/statistics_during_period` für `sensor.*_anrufe_heute` (`state_class: measurement`, Tages-Maximum ≈ Anrufe je Tag), `sensor.*_gespraechszeit_heute` und `sensor.*_erkannte_spam_anrufe` (`total_increasing`). Das gäbe Monate statt Tage, aber nur Summen, keine Aufteilung nach Art, Uhrzeit oder Person. Vorschlag für eine spätere Stufe: eigener Zeitraum „Langzeit“ mit genau diesen drei Linien.

**Darstellung und Zugänglichkeit.**

- Diagramme als Inline-SVG, Breite beim Zeichnen aus dem Container gemessen (neu bei Größenänderung), damit 11-px-Beschriftungen auch bei 375 px lesbar bleiben; Achsenbeschriftungen werden ausgedünnt, statt sich zu überlappen.
- Farben der vier Reihen aus der Referenzpalette des dataviz-Leitfadens, für hell und dunkel **getrennt** gewählt und mit dem Prüfskript validiert (Reihenfolge eingehend `#1baf7a`/`#199e70`, ausgehend `#2a78d6`/`#3987e5`, verpasst `#eb6834`/`#d95926`, Spam `#6250d6`/`#9085e9`; CVD- und Normalsicht-Abstand bestanden; Eingehend hell nur 2,7:1 gegen die Fläche, deshalb immer Legende mit Zahlen und Tabellenansicht). Statusfarben (`--ok`, `--bad`) werden nicht für Reihen benutzt. Heatmap einfarbig blau in 6 Stufen, im Dunkeln eigene Stufen; die Zahl steht in jedem Feld.
- Legende immer sichtbar, mit Summe je Reihe; nie nur Farbe.
- Jede Säule und jedes Feld ist fokussierbar (`role="img"`, `aria-label` mit allen Zahlen), Tooltip bei Maus und Fokus, Esc schließt.
- Knopf „Als Tabelle“/„Als Diagramm“ (`aria-pressed`) je Diagramm; die Tabellen haben `caption` und `th scope`.
- Zeitraumwechsel wird per `aria-live` angesagt.
- Zustände: Lädt (Skelett, `aria-busy`), keine Daten (leere Liste), kurze Liste, Privatsphäre, Verbindung weg (letzter Stand mit Uhrzeit).

**Privatsphäre in der Statistik:** Kacheln, Diagramme und Heatmap bleiben sichtbar (nur Zahlen). In den Top-Listen sind Namen verdeckt und Nummern gekürzt (`0171 ••• 78`); Antippen zeigt einen Eintrag 15 s. Eigene Rufnummern werden nicht verdeckt.

**Aufwand im Browser:** Bei 400 Anrufen ist alles eine Schleife über die Liste; neu gerechnet nur, wenn sich das Zustandsobjekt der Anrufliste oder der Zeitraum ändert.

## 3. Privatsphäre-Modus

Option `privacy_mode` in den Optionen von `fritzbox_phone` (Standard aus). Was genau passiert:

- Die Integration ändert **keine Daten**. Sie hängt nur `privacy_mode: true` an die Attribute von **Anrufliste, Telefonbuch und Anrufbeantworter** (`_privacy_attributes` in `entity.py`). Nicht an `missed_calls`, Tageszahlen, Anrufmonitor, `ringing`.
- Die **Karte** (`fritzbox-phone-card.js`, Option `privacy: auto | on | off`, Standard `auto` = wie die Integration) ersetzt Namen und Nummern durch `••••••` (Screenreader: „Verdeckt – zum Anzeigen antippen“). Der erste Tipp auf eine Zeile deckt sie für **15 Sekunden** auf (`REVEAL_MS`), danach klappt sie wieder zu. Ort, Gerät und Dauer bleiben in der Karte sichtbar; der Anrufmonitor bleibt unverdeckt.
- Laut Anleitung „reine Anzeige“: Sensoren, Logbuch und Automationen behalten die echten Daten. Jeder mit Zugriff auf die Zustände (Entwicklerwerkzeuge, API) sieht alles.

Für das Panel heißt das (Vorschlag, im Mockup Zustand „Privatsphäre-Modus an“):

- Gilt, wenn **eine** der gelesenen Entitäten `privacy_mode === true` trägt (wie `_privacyEnabled` der Karte). Keine eigene Panel-Option in Stufe 1.
- Verdeckt: Name und Nummer in Anrufliste, Nachrichten, Telefonbuch, Vorschlägen im Anrufen-Dialog (dort nur die Nummer, weil der Nutzer den Namen selbst tippt) und im Löschen-Dialog. Zusätzlich auch der Ort (`area_name`), weil er im Panel neben der Nummer steht und viel verrät.
- Aufdecken: Tipp/Enter auf die Zeile, 15 s, Fokus bleibt auf der Zeile. Aktionen erst nach dem Aufdecken.
- Nicht verdeckt: Live-Band, Tageszahlen, Zähler, Filterzahlen.
- Ein Hinweis oben erklärt, dass der Modus aus FRITZ!Box Telefon kommt.
- Die Suche funktioniert weiter (ein Treffer verrät, dass es einen Eintrag gibt; hingenommen, weil das Panel nur Administratoren offensteht).

## 4. Nur lesen, Fehler, Rechte

- Das Panel ist ohnehin nur für Administratoren. Die Dienste von `fritzbox_phone` prüfen keine HA-Rechte zusätzlich.
- Ein „Darf schreiben“ meldet `fritzbox_phone` nicht. Fehlt dem Box-Benutzer ein Recht oder ist die Wählhilfe aus, scheitert der Aufruf mit `box_request_failed` (Text der Box). Das Panel zeigt dann den Fehler im Toast und, nach einer abgelehnten Aktion, einen Hinweis oben mit den nötigen Rechten; Lesen geht weiter (Mockup „Nur lesen“). Besser wäre ein Attribut aus `fritzbox_phone` (Offene Fragen).
- Entität `unavailable`: letzter Stand bleibt sichtbar mit „Verbindung zur FRITZ!Box unterbrochen – Stand HH:MM“ (wie `_buildStaleNotice` der Karte), alle Aktionen gesperrt, Grund steht als Text daneben. Fehlt `call_list` ganz: Seite mit „nicht verfügbar“ und Link zur Integration.
- Dienst-Fehler übersetzt HA selbst (`translation_key` in `strings.json` von `fritzbox_phone`); das Panel zeigt `err.message` unverändert.

## 5. Was liest, was schreibt

| Liest nur (`hass.states`, `hass.entities`, `hass.devices`) | Ruft Dienste (`hass.callService` / `callWS`) |
|---|---|
| Anrufliste, Filter, Suche, Tagesgruppen | `dial`, `hangup` |
| Tageszahlen, Spamzähler | `block_number`, `unblock_number` |
| Live-Anruf | `add_contact` |
| Nachrichtenliste, Kapazität | `lookup_number` (nur lesend, aber Dienst mit Antwort; Tellows bekommt die Nummer, PhoneBlock nur einen Hash) |
| Telefonbuch | `mark_message_read`, `delete_message`, `play_message` |
| Plakette „neu“, Punkt am Reiter | `auth/sign_path` (Abspielen, Herunterladen) |
| | `switch.turn_on/off` (AB, ggf. Rufumleitungen) |

Rückfragen (Dialog wie `panel-dialogs.js`, Fokus auf „Abbrechen“): Sperren, Löschen. Ohne Rückfrage, aber mit Toast und „Rückgängig“: AB schalten, Sperren (Rückgängig = `unblock_number`). Anrufen startet nach dem Dialog sofort.

## 6. Risiken

- **Kopplung an Attributnamen.** Das Panel hängt an Namen, die nur in `sensor.py` von `fritzbox_phone` stehen (`calls`, `messages`, `contacts`, `recording_path`, `key`, `privacy_mode` …) und an `translation_key`s. Eine Umbenennung dort bricht die Seite still.
- **Formate der Box**: `date` als `TT.MM.JJ HH:MM`, `duration` als `h:mm` — kein ISO, keine Sekunden. Das Panel parst, statt anzuzeigen.
- **Große Attribute**: `calls` und `contacts` stehen komplett im Zustand. Bei 50 Anrufen und großen Telefonbüchern (mehrere hundert Kontakte) wird jeder `hass`-Wechsel teurer. Rendern nur bei Änderung des Zustandsobjekts (Identitätsvergleich), Telefonbuch nur sichtbar begrenzt.
- **Versionen**: Nutzer können eine alte `fritzbox_phone`-Version haben (z. B. ohne `recording_path` oder `key`).
- **Mehrere Boxen**: falsches Ziel = Anruf über die falsche Box. Deshalb immer `device_id` als Ziel, nie ohne.
- **Rufumleitungen doppelt**: `box.html` plant eigene Befehle `fritzbox_network/phone/deflections`; `fritzbox_phone` hat schon `switch.*` mit `translation_key: deflection_enabled`. Ist `fritzbox_phone` da, sollte die Box-Übersicht dessen Schalter nutzen statt eigener (oder die eigene Karte ganz entfallen).

**Empfehlung**

1. **Defensiv parsen**: jedes Attribut optional (`Array.isArray`, `typeof`), unbekannte `type`/`spam_rating` roh zeigen, nicht lesbares Datum ans Ende. Fehlt ein Pflichtfeld (`calls`), Hinweis „Diese Version von FRITZ!Box Telefon liefert nicht, was die Seite braucht“ statt leerer Seite (die Version der Integration ist im Frontend nicht bekannt, daher ohne Nummer).
2. **Tests auf beiden Seiten**:
   - In `HA-fritzbox_phone`: ein Vertragstest (Snapshot) der Attributschlüssel von `call_list`, `answering_machine`, `phonebook`, `call_monitor` und der `translation_key`s, mit Kommentar „wird von fritzbox_network gelesen“. Eine Änderung fällt dann dort auf.
   - In `HA-fritzbox_network` (`tests/js/`): eine Fixture mit echten Zuständen aus `fritzbox_phone` (aus dessen Tests oder Diagnose exportiert) und Tests für Parser (`date`, `duration`, Gegenüber-Nummer, Filter), Erkennung (mit/ohne, zwei Boxen) und Privatsphäre (verdeckt/aufgedeckt, Timer).
3. **Alles Telefon-Spezifische in einem Modul** (`panel-phone.js` + `phone-model.js` für das reine Lesen), damit eine Änderung an einer Stelle landet.

## 7. Texte (`texts.js`, de und en)

Neue Schlüssel (Struktur wie `t.box.*`):

- `tabs.boxOverview` „Übersicht“, `tabs.phone` „Telefon“
- `phone.{title, lead, source, entry, otherBox, chooseEntry, monitorOn, monitorOff, openIntegration, unavailable, stale, tooOld}`
- `phone.live.{ringing, dialing, talking, since, answeredAfter, spamSuspect, block, cancelDial}`
- `phone.today.{title, window, calls, inOut, missed, missedHint, allAnswered, talk, talkHint, spam, spamTotal}`
- `phone.calls.{title, dial, filters.{all, missed, incoming, outgoing, spam}, search, shown, none, noneBody, noMatch, reset, legend.{in, out, miss, tam, spam}, window, today, yesterday, noDate, type.{incoming, missed, outgoing, active_incoming, rejected_incoming, active_outgoing, other}, number, ownNumber, device, phoneblock, reverse, callback, redial, addContact, lookup, block, blocked, toMessage, unknown}`
- `phone.rating.{A_LEGITIMATE, B_MISSED, C_PING, D_POLL, E_ADVERTISING, F_GAMBLE, G_FRAUD}`
- `phone.tam.{title, nNew, allHeard, enabled, on, off, capacity, playHint, none, noneBody, noMessages, play, pause, seek, speaker, speakerTitle, speakerHint, download, markRead, markUnread, delete, deleteTitle, deleteBody, deleted, noRecording, toastOn, toastOff}`
- `phone.book.{title, count, choose, search, found, noMatch, more, hint, numType.{home, mobile, work, fax_work, intern, other}, call}`
- `phone.dial.{title, field, help, invalid, ok, started, cancelled}`
- `phone.block.{title, body, name, list[], ok, done, undone}`
- `phone.contact.{title, name, book, suggestion, ok, done, noName}`
- `phone.lookup.{title, intro, canonical, contact, none, area, offline, phoneblock, notFound, tellows, off, privacy}`
- `phone.view.{list, stats}`
- `phone.stats.{title, period.{today, d7, d30, all}, basis, basisShort, options, sameAsAll, noData, noDataBody, calls, perDay, talk, avgTalk, missedRate, missedOf, spam, spamToday, spamTotal, tam, unheard, deltaUp, deltaDown, deltaSame, deltaVs, deltaVsYesterday, compareIncomplete, compareNone, compareNoneAll, perHour, perDayChart, perWeek, weekFrom, heat, heatHint, perLine, perLineHint, topIn, topOut, notInBook, spamSuspect, asTable, asChart, rounded, source, privacy, changed, weekdays[], slots[]}`
- `phone.privacy.{notice, hidden}`
- `phone.rights.{refused, needed}`

Die Texte der Karte (`TEXTS.de` in `fritzbox-phone-card.js`) sind die Vorlage, damit Panel und Karte gleich sprechen.

## 8. Barrierefreiheit

Wie in `panel-core-gap.md` §8, dazu:

- Zeilen: der klickbare Teil ist ein `button` mit `aria-expanded`/`aria-controls`; Anrufen-Knopf mit `aria-label` „Zurückrufen: <Name>“ (verdeckt: „verdeckter Eintrag“).
- Tagesgruppen als `role="heading" aria-level="3"`; Trefferzahl nach Filter/Suche in einem `role="status"`.
- Player: Abspielen/Pause als `aria-pressed`, Position als `input type="range"` mit `aria-valuetext` „0:12 von 0:38“.
- AB-Schalter `role="switch"` mit `aria-label` „<AB-Name> eingeschaltet“.
- Live-Band `role="status"`, beim Klingeln `aria-live="assertive"`; Animation des Hörers aus bei `prefers-reduced-motion`.
- Anrufen-Dialog: Fokus ins Feld, Vorschläge als `listbox`, Tab bleibt im Dialog, Esc bricht ab, Fokus zurück.
- Farbe nie allein: Typ steht als Text in der Metazeile, Spam als Chip mit Prozent.

## 9. Offene Fragen an den Maintainer

1. **Telefonbuch-ID**: `add_contact` braucht `phonebook_id`, die Telefonbuch-Sensoren nennen sie aber nicht (nur in der `unique_id`, die das Frontend nicht sieht). Attribut `phonebook_id` ergänzen?
2. **AB-Schalter zuordnen**: `switch.*_tam_enabled` hat kein `tam_index`-Attribut. Ergänzen, damit Sensor und Schalter sicher zusammenfinden?
3. **Sperrliste**: Gesperrte Nummern (`get_blocked_numbers`) sind nicht sichtbar. Eine Entität/ein Attribut oder ein Befehl dafür, damit das Panel „gesperrt“ zeigen und freigeben kann?
4. **Telefon für die Wählhilfe**: Soll `dial` ein optionales Feld bekommen (z. B. `phone`/Port über `X_AVM-DE_DialSetConfig`)? Bis dahin zeigt der Dialog nur den Hinweis.
5. **Rechte**: Kann `fritzbox_phone` melden, ob der Box-Benutzer schreiben darf und ob die Wählhilfe an ist (Attribut `can_dial`, `can_write`)? Dann sind Knöpfe vorher grau statt hinterher Fehler.
6. **Fenster der Anrufliste**: `call_list_days`/`call_list_max` als Attribute an `call_list`, damit der Text „laut Anrufliste der letzten N Tage“ stimmt?
7. **Privatsphäre im Panel**: Soll das Admin-Panel den Modus überhaupt befolgen (Wandtablet zeigt eher die Karte als das Panel)? Vorschlag: ja, wie `auto` der Karte.
8. **`download_message`**: Wird der veraltete Dienst entfernt? Das Panel nutzt ihn nicht.
9. **Rufumleitungen**: eigene Befehle in `fritzbox_network` (Plan in `panel-core-gap.md` §6) oder die Schalter von `fritzbox_phone` nutzen, wenn vorhanden?
10. **Format von `duration` bei Nachrichten**: Ist es wie in der Anrufliste `h:mm` oder `m:ss`? Die Karte zeigt es roh; der Player braucht Sekunden.
11. **Statistik-Fenster**: Für eine brauchbare Statistik müssten `call_list_days`/`call_list_max` deutlich über 7/50 liegen. Ist das für die Größe des Zustands (Attribut `calls`) vertretbar, oder lieber `fritzbox_phone/calls` (Stufe 2)? Und: Namen der eigenen Rufnummern (`X_AVM-DE_GetNumbers`) als Attribut, damit „je eigener Rufnummer“ „Festnetz/Büro“ zeigen kann?
12. **„Blockiert“ zählen**: Soll `fritzbox_phone` einen Zähler für abgewiesene Anrufe (Rufsperre) führen? Heute gibt es nur „erkannt“ (`is_spam`) und `rejected_incoming` in der Liste.

## 10. Stufenplan

**Stufe 1 — nur Entitäten und Dienste (kein Code in `fritzbox_phone` nötig)**

1. Erkennung und Unterreiter; `#/box/phone`; ohne Integration unsichtbar.
2. Modul `phone-model.js`: Entitäten über `platform`/`translation_key` finden, Box über Seriennummer zuordnen, Attribute defensiv in ein eigenes Modell übersetzen (Datum, Dauer, Nummer, Typ). Tests mit Fixture.
3. Seite mit Tageszahlen, Anrufliste (Filter, Suche, Tage), AB (Browser-Player über `auth/sign_path`, gelesen/löschen/Lautsprecher), Telefonbuch, Live-Band.
4. Aktionen über die Dienste, immer mit `device_id`; Rückfragen, Toasts, Fehlertexte.
5. Privatsphäre wie in §3.
6. Statistik-Ansicht (§2, „Statistik“) als reine Funktion über das Modell aus Schritt 2, mit Tests für Kategorien, Zeiträume, Vergleich und Abdeckung.
7. Texte de/en, Barrierefreiheit, 375 px.

Optional danach (ohne Code in `fritzbox_phone`): Zeitraum „Langzeit“ aus `recorder/statistics_during_period` der drei Sensoren mit Statistik.

Grenzen von Stufe 1: Telefonbuch-Auswahl beim Anlegen nur nach Reihenfolge (Frage 1), keine Sperrliste, kein Telefon für die Wählhilfe, Rechte erst nach dem Fehler bekannt, ganze Listen in jedem Zustand.

**Stufe 2 — optional, Websocket-Befehle in `fritzbox_phone`**

Nur wenn Stufe 1 an Größe oder fehlenden Daten scheitert. Name nach dem Muster dort, z. B.:

| Befehl | Zweck |
|---|---|
| `fritzbox_phone/info` | `{ entries: [{ entry_id, serial, title, can_write, can_dial, call_list_days, call_list_max, privacy_mode, phonebooks: [{id, name, entity_id}], tams: [{index, name, entity_id, switch_entity_id}] }] }` — beantwortet Fragen 1, 2, 5, 6 |
| `fritzbox_phone/calls` | Seiten der Anrufliste mit ISO-Datum und Dauer in Minuten, Filter serverseitig |
| `fritzbox_phone/phonebook/search` | Suche im Telefonbuch, statt alle Kontakte im Zustand zu halten |
| `fritzbox_phone/blocked/list` | Sperrliste (Frage 3) |
| `fritzbox_phone/subscribe` | Änderungen als Ereignisse statt ganzer Attribute |

Diese Befehle gehören in `fritzbox_phone` und werden dort getestet; FRITZ!Box Netzwerk bleibt ohne Telefonie-Code. Das Panel nutzt sie, wenn vorhanden (Erkennung über einen Testaufruf von `fritzbox_phone/info`, `unknown_command` → Stufe 1).
