# Telefonie ins Cockpit: „FRITZ!Box Telefon“ aufnehmen

Stand: 2026-11-19 · Status: Entwurf, noch kein Code · Ablösung der Entscheidung „Telefonie bleibt außen vor“ aus [`panel-core-gap.md`](panel-core-gap.md) und [`panel-phone.md`](panel-phone.md)

Ziel: Das Cockpit (`fritzbox_network`) übernimmt alles, was [`HA-fritzbox_phone`](https://github.com/bertel2020/HA-fritzbox_phone) (`fritzbox_phone`, 2.3.3) kann. Danach ist `fritzbox_phone` überflüssig, und bestehende Nutzer ziehen ohne Verlust von Entity-IDs, Verlauf und Automationen um.

Nicht-Ziele: neue Telefonfunktionen (die kommen nach dem Umzug), ein Umbau des Cockpit-Polls, ein Ersatz für den Core-Anrufmonitor `fritzbox_callmonitor`.

## 1. Ausgangslage

| | Cockpit heute | `fritzbox_phone` |
|---|---|---|
| Python | ~12.500 Zeilen, flach in `custom_components/fritzbox_network/` | ~6.350 Zeilen, 24 Module |
| Frontend | Panel mit Seite Telefon (`panel-phone*.js`, `phone-model.js`, ~2.800 Zeilen), liest nur Entitäten und ruft Dienste | Lovelace-Karte `fritzbox-phone-card.js` (~2.400 Zeilen) |
| Poll | 30 s, ein `threading.Lock` je Request (nicht je Poll) | 120 s, `RLock`, Telefonbücher alle 900 s |
| Box-Zugriff | `FritzNetworkClient` (`api.py`, 1.264 Zeilen) | `FritzBoxPhoneClient` (`api.py`, 847 Zeilen), eigene Verbindung, eigener Login |
| Zusätzlich | – | Anrufmonitor (TCP 1012, Thread), PhoneBlock, Tellows, Verlauf (`.storage`), Aufnahmen-Ausliefer-View, Logbook, 7 WS-Befehle, 12 Dienste, Events |

Heute laufen zwei Integrationen mit zwei Logins und zwei Verbindungen gegen dieselbe Box, und das Panel muss die Zuordnung zwischen beiden über Seriennummer und `device_id` raten.

## 2. Entscheidungen

1. **Eigener Koordinator, nicht im Cockpit-Poll.** `PhoneCoordinator` (Muster `RepeaterCoordinator` in `repeater.py`): eigener Takt (Standard 120 s), eigener Fehlerzustand. Ein Ausfall der Telefonie darf die Geräteliste nicht stören und umgekehrt.
2. **Ein Client, eine Verbindung.** Die TR-064-Aufrufe der Telefonie kommen als Methodengruppe in `FritzNetworkClient` (oder eine Mixin-Klasse, die er einbindet) und teilen Login und `_lock`. Der Lock ist heute je Request, nicht je Poll; ein Telefon-Poll schiebt sich also zwischen die Requests des Haupt-Polls, statt ihn zu blockieren. **Ausnahme Aufnahmen:** Ein Download (bis 25 MB) darf den Lock nicht halten. Nur die Sitzungskennung (`sid`) wird unter dem Lock geholt, der Download läuft danach ohne.
3. **Unterpaket `phone/`.** Sonst wächst das flache Verzeichnis um 24 Dateien. Plattformdateien (`sensor.py`, `switch.py`, `binary_sensor.py`, `event.py`) bleiben oben und importieren aus `phone/`.
4. **Abschaltbar, Standard aus.** Option `phone_enabled`. Ohne sie kostet die Telefonie keine Abfrage, wie bei den anderen Bereichen („standardmäßig aus“). Das Angebot erscheint nur, wenn die Box den Dienst `X_AVM-DE_OnTel` hat und das Recht `Phone` mitbringt (`NewX_AVM-DE_CurrentUserRights`, siehe PLAN.md Phase 0).
5. **Das Panel liest per WebSocket, nicht mehr aus Entitäts-Attributen.** Die Anrufliste als Attribut (`calls`) liegt nicht im Recorder, steht nur im Live-Zustand und stößt an die Attributgrenze. Die Seite Telefon bekommt Befehle `fritzbox_network/phone/...` (Abschnitt 6); die Entitäten bleiben für Automationen und Dashboards, mit kleineren Attributen.
6. **Nur ein Weg zum Umzug: das vorhandene Migrationswerkzeug.** `migration.py` und `panel-migrate.js` (Vorschau, dann Anwenden) kennen schon die Quelle `fritz`. Dazu kommt die Quelle `fritzbox_phone`. Kein zweiter Mechanismus.

## 3. Aufbau

```
custom_components/fritzbox_network/
  phone/
    __init__.py
    client.py        # aus fritzbox_phone/api.py: Anruflisten-, Telefonbuch-, AB-, Rufumleitungs-, Wahl-Aufrufe
    models.py        # CallEntry, Tam, TamMessage, Phonebook, Deflection
    coordinator.py   # PhoneCoordinator (aus coordinator.py)
    callmonitor.py   # unverändert übernommen, Thread + FritzMonitor
    lookups.py       # phoneblock.py, tellows.py, cache.py, geocoding.py, phone_numbers.py
    history.py       # Anrufverlauf (.storage), Statistik
    payloads.py
    services.py      # 12 Dienste
    recordings.py    # View für AB-Aufnahmen (aus views.py)
  sensor.py, binary_sensor.py, switch.py, event.py   # ergänzt um Telefon-Entitäten
  websocket_api.py                                    # + phone/* Befehle (oder phone/websocket.py, eingehängt)
  logbook.py                                          # + Telefon-Ereignisse
```

Herkunft der Module (Datei in `fritzbox_phone` → Ziel):

| Quelle | Zeilen | Ziel | Aufwand |
|---|---|---|---|
| `api.py` | 847 | `phone/client.py` + `phone/models.py`, Lock und Login des Cockpit-Clients statt eigener Verbindung | mittel (Umbau, nicht Kopie) |
| `coordinator.py` | 796 | `phone/coordinator.py` | mittel |
| `callmonitor.py` | 625 | `phone/callmonitor.py` | gering |
| `sensor.py`, `binary_sensor.py`, `switch.py`, `event.py`, `entity.py` | ~1.000 | in die Plattformdateien oben, Basisklasse an `entity.py` des Cockpit | mittel |
| `services.py`, `services.yaml` | 380 | `phone/services.py` | gering |
| `websocket.py` | 399 | `phone/websocket.py` | gering |
| `history.py`, `logbook.py`, `payloads.py` | ~770 | `phone/history.py` usw. | gering |
| `phoneblock.py`, `tellows.py`, `cache.py`, `geocoding.py`, `phone_numbers.py` | ~510 | `phone/lookups.py` (oder einzeln) | gering |
| `views.py` | 100 | `phone/recordings.py` | gering |
| `config_flow.py` | 413 | Optionen-Schritt „Telefon“ im vorhandenen Options-Flow (kein eigener Eintrag mehr) | mittel |
| `diagnostics.py`, `health.py`, `repairs`-Teile | ~200 | in `diagnostics.py`/`repairs.py` des Cockpit | gering |
| `www/fritzbox-phone-card.js` | 2.396 | siehe Abschnitt 8 | offen |
| `tests/` (21 Dateien) | | `tests/phone/`, `tests/js/` | mittel |

Neue Abhängigkeiten in `manifest.json`: `phonenumbers>=8.13.0`, `defusedxml>=0.7.1`. `fritzconnection` ist schon gepinnt (`>=1.15.1`).

## 4. Entitäten

Alle Telefon-Entitäten hängen am **Box-Gerät** des Cockpit (`identifiers={(DOMAIN, serial)}`), nicht an einem eigenen Gerät. Damit fällt die ganze Zuordnung aus `panel-phone.md` Abschnitt 1 („Mehrere Boxen“) weg.

`unique_id = f"{serial}_phone_{key}"`, bei mehreren je Box mit Index: `{serial}_phone_tam_{tam_index}`, `{serial}_phone_book_{id}`, `{serial}_phone_deflection_{id}`. `translation_key` bleibt wie in `fritzbox_phone`, damit Übersetzungen und Panel-Suche weiter passen.

| Plattform | `translation_key` | Je Eintrag | Bemerkung |
|---|---|---|---|
| sensor | `call_list`, `calls_today`, `talk_time_today`, `missed_calls` | 1 | `call_list`: Attribut `calls` gekürzt (Abschnitt 5) |
| sensor | `spam_calls_today`, `spam_calls_total` | 0–1 | nur mit PhoneBlock; `spam_calls_total` ist `RestoreSensor` |
| sensor | `phoneblock_status`, `reverse_lookup_status` | 0–1 | Diagnose, standardmäßig aus |
| sensor | `phonebook` | n | eine je Telefonbuch |
| sensor | `answering_machine` | n | eine je AB |
| sensor | `call_monitor` | 0–1 | nur mit Anrufmonitor |
| binary_sensor | `ringing`, `unread_messages` | 0–1 | |
| switch | `tam_enabled`, `deflection_enabled` | n | nur mit `can_write` und Recht `Phone` |
| event | `call` | 0–1 | nur mit Anrufmonitor |

Datenschutzmodus (`privacy_mode`) bleibt: Nummern in Attributen gekürzt, der Anrufmonitor nicht (wie in der Karte).

## 5. Last und Takt

Die Box braucht heute 7,6 s pro Haupt-Poll, in Spitzen 33,7 s (`core-gap-features.md`). Jede zusätzliche Abfrage zählt.

- **Telefon-Poll alle 120 s**, nicht 30 s: Anrufliste, AB-Liste und -Nachrichten, Rufumleitungen. Der Anrufmonitor liefert Anrufe sofort per Socket; der Poll dient nur dem Abgleich.
- **Telefonbücher alle 900 s** (wie bisher), dazu Bilder nur bei Änderung.
- **Anrufmonitor** ist ein eigener TCP-Socket (Port 1012) und nimmt weder Lock noch Poll in Anspruch.
- **Spike vor dem Bau (Stufe 0):** Dauer und Request-Zahl eines Telefon-Polls an der echten Box messen, zusammen mit dem Haupt-Poll. Ergebnis in dieses Dokument. Liegt der Telefon-Poll über etwa 3 s, wird er weiter aufgeteilt (AB-Nachrichten nur bei Änderung des Zählers).
- **Attributgröße:** `call_list.calls` auf die letzten N Anrufe kürzen (Option `call_list_max`, Standard 50, wie bisher); das Panel holt die volle Liste über `phone/calls`.

## 6. Schnittstellen

### Dienste

Unter `fritzbox_network`, Präfix `phone_` (Namensraum der Box-Dienste frei halten): `phone_dial`, `phone_hangup`, `phone_lookup_number` (mit Antwort), `phone_add_contact`, `phone_add_number_to_contact`, `phone_update_contact`, `phone_delete_contact`, `phone_block_number`, `phone_unblock_number`, `phone_mark_message_read`, `phone_delete_message`, `phone_play_message`. Felder, Prüfung der Nummern (`^[0-9+*#()\-/ ]{1,32}$`) und Fehlermeldungen unverändert. `update_contact`/`delete_contact` nur für Administratoren (wie bisher). Bei mehr als einer Box verlangen sie `target` (wie `device_required` heute).

### WebSocket

| Alt (`fritzbox_phone/…`) | Neu (`fritzbox_network/phone/…`) |
|---|---|
| `entries` | entfällt (der Eintrag ist der des Cockpit; `fritzbox_network/entries` meldet `phone: {available, enabled, monitor}`) |
| `phonebooks`, `contacts` | `phonebooks`, `contacts` |
| `calls`, `stats` | `calls`, `stats` |
| `tams`, `blocklist` | `tams`, `blocklist` |
| – | `deflections` (steht schon in `panel-core-gap.md`) |
| – | `subscribe` (neu: Live-Zustand des Anrufmonitors für das Band oben, statt Entität abonnieren) |

### Events

`fritzbox_phone_call`, `_call_list_changed`, `_missed_call`, `_tam_message`, `_number_blocked`, `_number_unblocked` werden zu `fritzbox_network_phone_*`. Die Payloads bleiben bis auf `config_entry_id` gleich, ohne `entity_id` (Begründung steht in `fritzbox_phone/const.py`: sonst erscheint der Eintrag doppelt im Logbuch).

### Aufnahmen

`/api/fritzbox_phone/recording/{entry_id}/{tam_index}/{message_index}` wird zu `/api/fritzbox_network/phone/recording/...`. Grenzen bleiben: 25 MB, höchstens 2 gleichzeitig.

## 7. Migration (die eigentliche Schwierigkeit)

Betroffen sind Entity-Registry, Verlauf, Automationen/Skripte/Blueprints, Dashboards.

1. **Vorschau** (Trockenlauf, nichts wird geändert) in `panel-migrate.js` und `migration.py`, Quelle `fritzbox_phone`: für jede Entität des alten Eintrags die Entsprechung hier suchen (über `translation_key` und Index), Zahlen wie bei `fritz`: Übernehmen / Konflikte / Kein Gegenstück.
2. **Anwenden:** Telefon-Entitäten per `entity_registry.async_update_entity(…, new_config_entry_id, new_unique_id, device_id)` an den Cockpit-Eintrag hängen. Die `entity_id` bleibt, damit Verlauf, Dashboards und Automationen weiterlaufen. (Zu prüfen: ob der Wechsel von Plattform-Domain und Gerät in einem Schritt geht oder `migration.py` einen Zwischenschritt braucht, wie beim Wechsel von `fritz`.)
3. **Einstellungen kopieren:** `call_list_days`, `call_list_max`, `scan_interval`, Anrufmonitor und Port, Präfixe, PhoneBlock-Zugang und -Schwelle, Rückwärtssuche, Datenschutzmodus, Verlaufstage. PhoneBlock-Passwort bleibt in den Optionen und wird in `diagnostics.py` geschwärzt.
4. **Speicher übernehmen:** `.storage/fritzbox_phone.call_history.<entry_id>` und der Lookup-Cache werden in die neuen Schlüssel kopiert (nicht verschoben, bis der alte Eintrag entfernt ist). Der Spam-Gesamtzähler (`RestoreSensor`) bekommt seinen Zustand über das Umhängen der Entity zurück.
5. **Automationen, Skripte, Blueprints:** Suche nach `fritzbox_phone.` (Dienste) und `fritzbox_phone_` (Events) in den Konfigurationen, **nur lesend**, Anzeige als Liste in der Vorschau. Das Umschreiben macht der Nutzer (oder ein späterer, ausdrücklicher Knopf). Die Blueprints im Repo (`blueprints/automation/`) werden mitgezogen.
6. **Übergang:** Solange `fritzbox_phone` noch geladen ist, feuert das Cockpit **keine** Alias-Events unter dem alten Namen (sonst doppelte Auslösung). Ist es entfernt und der Eintrag migriert, feuert das Cockpit die alten Event-Namen noch **ein Release lang** zusätzlich. Dienste unter dem alten Namen gibt es nicht; die Liste aus Schritt 5 ist der Ersatz.
7. **Der alte Eintrag** wird nicht automatisch gelöscht. Nach dem Anwenden zeigt eine Reparatur-Meldung „FRITZ!Box Telefon kann entfernt werden“. `fritzbox_phone` bekommt eine letzte Version mit Hinweis und Link (Repair-Issue, README, HACS-Hinweis).

Ohne Migration (frische Installation): Option `phone_enabled` einschalten, fertig.

## 8. Frontend

- **Panel:** `phone-model.js` löst heute Entitäten über `hass.entities`, `translation_key` und Seriennummer auf. Das fällt weg; das Modell bekommt seine Daten aus den `phone/*`-Befehlen. Die Seite selbst (Live-Band, Kacheln, Anrufliste, AB, Telefonbuch, Sperrliste) bleibt, ebenso die Tests in `tests/js/phone.test.mjs`. Der Telefon-Tab erscheint, wenn `entries` `phone.enabled` meldet, nicht mehr per Erkennung der Fremd-Integration.
- **Lovelace-Karte:** `fritzbox-phone-card.js` (2.400 Zeilen) hat einen eigenen Funktionsumfang. Zwei Wege:
  - (a) als `fritzbox-network-phone-card.js` neben die Topologie-Karte stellen und in `panel.py` registrieren (`CARD_FILE` ist heute nur die Topologie-Karte),
  - (b) streichen und auf das Panel verweisen.
  Empfehlung (a), aber **zuletzt** (Stufe 6) und ohne Umbau: nur Namen und Datenquelle anpassen. Offene Frage 3.
- **Texte:** `texts.js` bekommt die Telefontexte aus `strings.json`/`translations` von `fritzbox_phone` (de, en).

## 9. Stufen

Jede Stufe ist für sich lauffähig und ausgeliefert, solange `fritzbox_phone` noch parallel funktioniert.

| Stufe | Inhalt | Ergebnis | Schätzung |
|---|---|---|---|
| 0 | Spike: Last des Telefon-Polls an der echten Box messen, Rechteprüfung `Phone`, Attributgrößen, Verhalten von `async_update_entity` bei Plattformwechsel; Fixtures anonymisieren | Zahlen in Abschnitt 5, offene Fragen 1 und 2 geklärt | ½ Tag |
| 1 | `phone/client.py`, `models.py`, `PhoneCoordinator`, Option `phone_enabled`, Optionen-Schritt; Sensoren **lesend** (`call_list`, `calls_today`, `talk_time_today`, `missed_calls`, Telefonbuch, AB, Zähler), WS `calls`/`tams`/`phonebooks`/`contacts`/`stats`/`blocklist`/`deflections` | Panel-Seite Telefon liest aus dem Cockpit | 3–4 Tage |
| 2 | Schreiben: Dienste (dial, block, contact, message), Schalter (AB, Umleitung), Aufnahmen-View, Logbuch | alle Aktionen der Seite gehen über das Cockpit | 2–3 Tage |
| 3 | Nachschlagen: PhoneBlock, Tellows, Rückwärtssuche, Cache, Spam-Zähler, Verlauf (`history.py`) | Spam- und Namensanzeige wie bisher | 2 Tage |
| 4 | Anrufmonitor: Socket mit Wiederverbinden, `call_monitor`, `ringing`, `event`, Live-Band, `phone/subscribe` | Echtzeit wie bisher | 2–3 Tage |
| 5 | Migration: Quelle `fritzbox_phone` in `migration.py`/`panel-migrate.js`, Optionen/Speicher kopieren, Hinweisliste, Reparatur-Meldung, Alias-Events | bestehende Nutzer können umziehen | 3 Tage |
| 6 | Karte, Blueprints, README/Anleitung/Changelog (de, en), letzte `fritzbox_phone`-Version mit Hinweis, `PLAN.md` und die Design-Docs nachziehen | `fritzbox_phone` ausgemustert | 2 Tage |

Zusammen etwa 15–18 Arbeitstage. Die Zahlen sind eine Schätzung aus den Zeilenzahlen und dem Umbauanteil, nicht gemessen. Stufe 1 bis 4 lassen sich einzeln als Minor-Release herausgeben; die Migration (Stufe 5) kommt **erst, wenn 1 bis 4 vollständig sind**, damit niemand umzieht und Funktionen verliert.

## 10. Tests

- `tests/phone/` aus den 21 Tests von `fritzbox_phone` ableiten: `test_client`, `test_coordinator`, `test_callmonitor`, `test_entities`, `test_services_and_stats`, `test_websocket`, `test_history`, `test_logbook`, `test_lookups`, `test_numbers`, `test_deflections`, `test_call_barring`, `test_recordings`, `test_recording_limits`, `test_diagnostics`, `test_translations`, `test_blueprints`.
- Neu: `test_phone_migration.py` (Vorschau und Anwenden, Konflikte, Entity-ID bleibt, Speicher kopiert, Alias-Events nur ohne geladenes `fritzbox_phone`), ein Test für den Lock (Aufnahmen-Download hält ihn nicht).
- JS: `phone.test.mjs` an die neue Datenquelle anpassen; die bestehenden Panel-Tests bleiben.
- Fixtures aus der echten Box (anonymisiert) wie in PLAN.md Phase 0.

## 11. Risiken

| Risiko | Gegenmittel |
|---|---|
| Der Telefon-Poll verlängert den Haupt-Poll (gemeinsamer Lock) | Lock je Request (ist so), eigener Takt, Aufnahmen ohne Lock, Messung in Stufe 0 |
| Entity-ID oder Verlauf gehen bei der Migration verloren | Vorschau vor Anwenden, `entity_id` bleibt, Test mit Registry-Fixture; Sicherung empfehlen |
| Automationen brechen (Dienst- und Eventnamen) | Hinweisliste, Alias-Events ein Release lang, Blueprints angepasst |
| Rechteprobleme: Nutzer ohne Recht `Phone` | Telefonie nur anbieten, wenn das Recht da ist; Schreibaktionen nur mit `can_write` |
| Umfang erschöpft die Wartung | Stufen einzeln ausliefern; `phone_enabled` aus, damit Nutzer ohne Telefon nichts merken |
| Zwei Integrationen laufen versehentlich gleichzeitig (doppelte Abfragen, doppelte Anrufe im Logbuch) | Hinweis im Panel und Reparatur-Meldung, solange beide Einträge dieselbe Box haben |

## 12. Offene Fragen

1. **Plattformwechsel in der Entity-Registry:** Lässt sich eine Entity von `fritzbox_phone` auf `fritzbox_network` umhängen, ohne dass HA sie als neu behandelt? `migration.py` macht das für `fritz` schon; ob derselbe Weg für beliebige Domains trägt, klärt Stufe 0.
2. **Eigene Verbindung für den Telefon-Client?** Alternative zu Entscheidung 2: eigener `FritzConnection` mit eigenem Lock. Mehr Last (zweiter Login, zweite SCPD-Abfrage), dafür keine Lock-Verklemmung. Entscheidung nach der Messung in Stufe 0.
3. **Lovelace-Karte:** Mitnehmen (a) oder streichen (b)? Hängt davon ab, wie viele Nutzer sie einsetzen; ohne Zahlen empfiehlt der Entwurf (a).
4. **Standardwert von `phone_enabled`:** aus (Entwurf) oder an, wenn die Box Telefonie hat? Aus ist vorsichtiger, an wäre bequemer für neue Nutzer.
5. **Alias-Events:** Ein Release lang genug? Es gibt keine Zahlen, wie viele Automationen darauf hören.
6. **Mehrere Boxen:** `fritzbox_phone` unterstützt mehrere Einträge; das Cockpit auch. Der Entwurf geht davon aus, dass je Box ein Eintrag mit eigener Telefonie läuft. Prüfen, ob ein Anrufmonitor je Box mit festem Port 1012 reicht (ja, die Boxen sind verschiedene Hosts).
