# Analyse: Migration Core-`fritz` (FRITZ!Box Tools) → `fritzbox_network`

Stand 2026-11-07. Geprüft gegen Home Assistant **2026.8.3** (`.venv`), Core-Quellen unter
`.venv/lib/python3.14/site-packages/homeassistant/components/fritz` (im Folgenden `fritz/…`),
Registries unter `…/homeassistant/helpers` (`er` = `entity_registry.py`, `dr` = `device_registry.py`),
unsere Integration unter `custom_components/fritzbox_network` (`fn/…`).
Nichts davon ist an einer echten Instanz getestet; was nur live prüfbar ist, steht in Abschnitt 5.

Rahmen: Domain `fritz` wird **nicht** übernommen. Ziel: einmalig Entitäten und Geräte eines
`fritz`-Eintrags auf einen `fritzbox_network`-Eintrag umhängen, `entity_id`, Verlauf und
Automationen bleiben; danach wird `fritz` entfernt.

---

## 1. Identitäten in Core-`fritz`

### 1.1 Config-Entry
- `VERSION = 1`, keine Minor-Version (`fritz/config_flow.py:60`).
- `data`: `host`, `password`, `port`, `username`, `ssl` (`fritz/config_flow.py:134-144`).
- `options`: `consider_home` (Sekunden, float, Standard 180), `old_discovery` (bool),
  `feature_device_tracking` (bool, Standard `True`) (`fritz/config_flow.py:145-150`, `fritz/const.py:45-49`).
- `unique_id`: nur bei SSDP-Entdeckung, = UPnP-UDN ohne `uuid:` (`fritz/config_flow.py:174-178`);
  beim manuellen Einrichten **keine** (`fritz/config_flow.py:268-291`), wird ggf. später per SSDP
  nachgetragen (`fritz/config_flow.py:183-185`). Die `unique_id` taugt daher **nicht** zum Abgleich mit
  unserem Eintrag (dessen `unique_id` = Seriennummer, `fn/config_flow.py:123`).
- `title`: SSDP-Friendly-Name oder Modellname (`fritz/config_flow.py:170-173`, `:284`).
- Pro Mesh-Repeater kann es einen **eigenen** `fritz`-Eintrag geben (Rolle `SLAVE`,
  `fritz/coordinator.py:620-622`); wir lehnen Repeater ab (`fn/config_flow.py:113-121`).

### 1.2 Box-Kennung
`AvmWrapper.unique_id` = `DeviceInfo1.GetInfo` → `NewSerialNumber` (`fritz/coordinator.py:253-254`,
fritzconnection `lib/fritzstatus.py:364-375`). `mac` = `format_mac(serial)` (`fritz/coordinator.py:387-393`).
Wir lesen dieselbe Quelle (`fn/api.py:169-172`) → **gleicher String `S`** auf beiden Seiten.

### 1.3 Geräte (Device-Registry)
| Gerät | identifiers | connections | weitere Felder | Quelle |
|---|---|---|---|---|
| Box | `{("fritz", S)}` | `{("mac", format_mac(S))}` | manufacturer `FRITZ!`, model, name = Entry-Titel, sw_version, configuration_url | `fritz/coordinator.py:192-202`, `fritz/entity.py:110-121` |
| Client | – | `{("mac", <MAC aus Host-Liste>)}` (Registry normalisiert auf klein) | manufacturer `FRITZ!`, model `FRITZ!Box Tracked device`, name = Hostname, `via_device_id` = Box | `fritz/coordinator.py:545-557` |

Tracker hängen nicht über `device_info` am Gerät (`ScannerEntity.device_info` ist `@final None`,
`components/device_tracker/entity.py:638-643`), sondern über die eigene Registrierung des
ScannerEntity (`device_tracker/entity.py:696-726`).

### 1.4 Alle Entitäten (unique_id, Ebene, Name/entity_id)
`S` = Seriennummer, `MAC` = MAC wie von der Box geliefert (vermutlich Großbuchstaben mit `:`;
**live prüfen**, `format_mac` beim Vergleich verwenden). Alle mit `has_entity_name=True`;
entity_id beim Anlegen = `<domain>.<Gerätename>_<Name>` (slugifiziert), danach fix in der Registry.

| Plattform | unique_id | Ebene | Name (→ entity_id-Endung) | Default | Quelle |
|---|---|---|---|---|---|
| binary_sensor | `S-is_connected` | Box | Connection | an | `fritz/binary_sensor.py:35-41`, `fritz/entity.py:96` |
| binary_sensor | `S-is_linked` | Box | Link | an | `fritz/binary_sensor.py:42-48` |
| button | `S-firmware_update` | Box | Firmware update (deprecated, Entfernung 2026.11) | aus | `fritz/button.py:37-44`, `:177` |
| button | `S-reboot` | Box | (Device-Class Restart) | an | `fritz/button.py:45-50` |
| button | `S-reconnect` | Box | Reconnect | an | `fritz/button.py:51-57` |
| button | `S-cleanup` | Box | Cleanup (deprecated, 2026.11) | aus | `fritz/button.py:58-64` |
| button | `MAC_wake_on_lan` | Client (nur LAN) | Wake on LAN | aus | `fritz/button.py:223-246` |
| device_tracker | `MAC_tracker` | Client | Hostname | an | `fritz/device_tracker.py:70`, `:81-83` |
| image | `S-guest_wifi_qr_code` | Box | SSID des Gastnetzes | an | `fritz/image.py:86-88` |
| sensor | `S-external_ip`, `S-external_ipv6` | Box | External IP / IPv6 | an | `fritz/sensor.py:173-183` |
| sensor | `S-connection_uptime` | Box | Connection uptime, **Zeitstempel** (`UPTIME`) | an | `fritz/sensor.py:184-190`, `:46-50` |
| sensor | `S-kb_s_sent`, `S-kb_s_received` | Box | Upload/Download throughput, kB/s, MEASUREMENT | an | `fritz/sensor.py:191-206` |
| sensor | `S-max_kb_s_sent`, `S-max_kb_s_received` | Box | Max connection …, kbit/s, ohne state_class (`WANCommonIFC` Layer1) | an | `fritz/sensor.py:207-220`, `:73-80` |
| sensor | `S-gb_sent`, `S-gb_received` | Box | GB sent/received, TOTAL_INCREASING | an | `fritz/sensor.py:221-236` |
| sensor | `S-link_kb_s_sent`, `S-link_kb_s_received` | Box | Link …throughput, kbit/s (`WANCommonInterfaceConfig`) | an | `fritz/sensor.py:237-252` |
| sensor | `S-link_noise_margin_sent/_received` | Box (nur DSL) | dB, ohne state_class | aus | `fritz/sensor.py:253-270` |
| sensor | `S-link_attenuation_sent/_received` | Box (nur DSL) | dB, ohne state_class | aus | `fritz/sensor.py:271-288` |
| sensor | `S-device_uptime` | Box | (Device-Class Uptime), Zeitstempel | an | `fritz/sensor.py:292-297` |
| sensor | `S-cpu_temperature` | Box (wenn vorhanden) | CPU temperature | an | `fritz/sensor.py:298-307` |
| switch | `S-call_deflection_<id>` | Box | Call deflection <id> | an | `fritz/switch.py:495-500` |
| switch | `S-port_forward_<slug(Beschreibung)>` | Box (nur Weiterleitungen auf die HA-IP) | Port forward … | an | `fritz/switch.py:192-209`, `:439`, `:393` |
| switch | `S-wi_fi_main_2_4ghz`, `S-wi_fi_main_5ghz`, `S-wi_fi_main_5ghz_high_6ghz`, `S-wi_fi_guest` | Box (Repeater: nur ohne WLAN-Uplink) | `_attr_name` „Wi-Fi Main 2.4Ghz“ usw. | an (Repeater: aus) | `fritz/switch.py:43-62`, `:588-618`, `:265-268` |
| switch | `MAC_internet_access` | Client (mit IP, `X_AVM-DE_HostFilter1`) | Internet access | an | `fritz/switch.py:536-549`, `:239-252` |
| update | `S-update` | Box | FRITZ!OS, mit INSTALL | an | `fritz/update.py:42-59` |

Dienste: `fritz.set_guest_wifi_password`, `fritz.dial` (`fritz/services.py:117-127`).

Mesh-Repeater-Einträge (`SLAVE`): nur Box-Entitäten (Buttons, Sensoren, update, ggf. WLAN-Switches),
keine Tracker/Profile/WoL (`fritz/switch.py:265-268`, `fritz/button.py:135-139`, `fritz/coordinator.py:620-623`).

### 1.5 Eigene Migrationen und Aufräumen im Core
- WLAN-Switches: `S-<slug("Wi-Fi <SSID>[ (<Band>)]")>` → `S-wi_fi_<slug(Name)>`, nur beim Setup von `fritz`
  (`fritz/switch.py:87-131`, aufgerufen `:292`).
- Gast-QR-Bild: `slug("S-<SSID>-qr-code")` → `S-guest_wifi_qr_code` (`fritz/image.py:23-46`, `:61`).
- Beide laufen nur, solange `fritz` geladen wird. Ein Eintrag, der lange deaktiviert war, kann noch
  Alt-IDs tragen → unsere Migration verlangt, dass `fritz` in der laufenden HA-Version einmal geladen war,
  oder meldet solche IDs als „unbekannt“.
- Bei **jedem** Poll: `async_trigger_cleanup` löscht Tracker-/`_internet_access`-Entitäten und Geräte des
  eigenen Eintrags, deren MAC die Box nicht mehr meldet (`fritz/coordinator.py:729-755`, aufgerufen `:346`).
  Betrifft nur Objekte mit `config_entry_id == fritz`; nach dem Umhängen also nichts mehr von uns —
  aber `fritz` darf während der Migration **nicht** laufen.

---

## 2. Identitäten bei uns und Zuordnung

### 2.1 Unser Schema
- Config-Entry: `VERSION = 1`, `unique_id` = Seriennummer (Fallback Host) (`fn/config_flow.py:102`, `:123`);
  `data`: `host`, `port`, `username`, `password`, `use_tls` (`fn/__init__.py:87-93`, `fn/const.py:7`).
  Optionen u. a. `consider_home` (Sekunden, Standard 180, `fn/const.py:10,28`).
- Box-Gerät: identifiers `{("fritzbox_network", S)}`, **keine** connections (`fn/__init__.py:111-120`).
- Client-Gerät: connections `{("mac", host.mac)}` (`format_mac`, klein), `via_device_id` = Box; bei
  Mesh-Knoten zusätzlich identifiers `{("fritzbox_network", node.mac)}` (`fn/entity.py:40-54`).
- Repeater-Gerät: `{("fritzbox_network", node.mac)}` (`fn/entity.py:154-160`); WireGuard-Gerät
  `{("fritzbox_network", f"{S}_vpn")}` (`fn/entity.py:99-107`, `fn/const.py:150-152`).
- unique_id Client: `f"{mac}_{key}"` (`fn/entity.py:37`). **Ausnahme Tracker:** `ScannerEntity.unique_id`
  gibt `mac_address` zurück und überdeckt `_attr_unique_id` (`device_tracker/entity.py:632-636`) →
  Tracker-unique_id = **nur die MAC** (bestätigt durch `tests/test_devices.py:39`).
- unique_id Box: `f"{S}_{key}"` (`fn/sensor.py:657`, `fn/binary_sensor.py:151`, `fn/update.py:46`,
  `fn/switch.py:270`, `fn/button.py:55`), Knoten `f"{node.mac}_{key}"` (`fn/entity.py:148`).
- entity_id beim Anlegen fest: Client `<domain>.fritz_<12hex>[_<key>]` (`fn/entity.py:38-39`),
  Box `<domain>.fritz_network_<key>` (`fn/sensor.py:658` u. a.). Existiert der Registry-Eintrag schon,
  gewinnt dessen entity_id (`helpers/entity_platform.py:1014-1043`) → migrierte IDs bleiben.
- Lookups im Code laufen über unique_id, nicht über entity_id (`fn/websocket_api.py:295`, `:314`,
  `fn/repairs.py:41`, `fn/services.py:86`) → Core-entity_ids stören den Panel-Code nicht.

### 2.2 Zuordnung Core → unser Gegenstück
✔ = migrierbar, ≈ = ähnlich (Werte live vergleichen), ✘ = kein Gegenstück.

| Core unique_id | Unser unique_id | Status / Unterschied |
|---|---|---|
| `MAC_tracker` | `mac` (klein) | ✔. Attribute verschieden (Core: `last_time_reachable`, `connected_to`, `connection_type`, `ssid`; wir: `interface_type`, `model`, `guest`, `vpn`, `mac_list`) → Templates auf Attribute brechen |
| `MAC_internet_access` | `mac_internet_access` | ✔ nur wenn bei uns erzeugt: Schreibrechte (`fn/switch.py:50-51`), kein Mesh-Knoten (`:60-61`) |
| `MAC_wake_on_lan` | `mac_wake_on_lan` | ✔ nur mit Schreibrechten, nicht WLAN (Option), kein Mesh-Knoten (`fn/button.py:36-45`) |
| `S-is_connected` | `S_internet_connected` | ✔ |
| `S-external_ip` | `S_external_ipv4` | ✔ (bei uns Default aus; Registry-Zustand bleibt) |
| `S-external_ipv6` | `S_external_ipv6` | ✔ |
| `S-kb_s_sent` / `S-kb_s_received` | `S_internet_upload` / `S_internet_download` | ✔ kB/s → Mbit/s, beides DATA_RATE + MEASUREMENT; Recorder rechnet in Metadaten-Einheit um (`components/sensor/recorder.py:311-325`) |
| `S-link_kb_s_sent/_received` | `S_dsl_rate_up/_down` | ≈ nur DSL; Core = Layer1-MaxBitRate, wir = `DownstreamCurrRate` (`fn/models.py:804-806`) |
| `S-link_noise_margin_sent/_received` | `S_dsl_noise_margin_up/_down` | ✔ (beide /10 dB; andere TR-064-Aktion) — Core ohne state_class, wir MEASUREMENT → Statistik beginnt neu, kein Konflikt |
| `S-link_attenuation_sent/_received` | `S_dsl_attenuation_up/_down` | ✔ wie oben |
| `S-wi_fi_guest` | `S_guest_wifi` | ✔ |
| `S-update` | `S_firmware` | ✔ aber ohne INSTALL (`fn/update.py:36-37`) → `update.install`-Aufrufe brechen |
| `S-connection_uptime` | (`S_internet_uptime`) | ✘ **nicht migrieren**: Core-Zustand ist Zeitstempel, unserer Dauer in s → Verlauf/Automationen inkompatibel |
| `S-max_kb_s_sent/_received` | – | ✘ (≈ `dsl_rate`, doppelt zu `link_kb_s`) |
| `S-gb_sent/_received` | – | ✘ noch kein Gegenstück (Tagesvolumen nur in der Historie) |
| `S-device_uptime`, `S-cpu_temperature`, `S-is_linked` | – | ✘ noch kein Gegenstück |
| `S-reboot`, `S-reconnect` | – | ✘ noch kein Gegenstück (PLAN.md „Phase 2“) |
| `S-wi_fi_main_*`, `S-guest_wifi_qr_code` | – | ✘ noch kein Gegenstück (PLAN.md „Phase 3“) |
| `S-cleanup`, `S-firmware_update`, `S-port_forward_*`, `S-call_deflection_*`, Dienste `fritz.dial`, `fritz.set_guest_wifi_password` | – | ✘ bewusst nicht (PLAN.md „weglassen“, Core-deprecated) |
| alle Entitäten eines Repeater-Eintrags | – | ✘ (nur Gerätedaten übertragbar, s. 4.6) |

Geräte: Box `("fritz", S)` ↔ `("fritzbox_network", S)` (gleiche Seriennummer, andere Domain; Core
hat zusätzlich die MAC-connection). Clients: gleiche MAC-connection, Core ohne identifiers.

---

## 3. Registry-APIs in HA 2026.8.3

### 3.1 Entity-Registry
- `async_update_entity_platform(entity_id, new_platform, *, new_config_entry_id, new_config_subentry_id, new_unique_id, new_device_id) -> RegistryEntry` (`er:2070-2106`).
  - Nur für **nicht geladene** Entitäten (`entity_sources`), sonst `ValueError` (`er:2085-2089`) →
    `fritz` muss entladen/deaktiviert sein.
  - `new_config_entry_id` Pflicht, wenn schon an einem Entry (`er:2091-2095`).
  - Behält Registry-`id`, entity_id, Name, Icon, Area, Labels, Aliasse, Optionen (Expose, Einheiten),
    `disabled_by`/`hidden_by`. Setzt `previous_unique_id` (`er:1964`).
  - `disabled_by=CONFIG_ENTRY` wird beim Wechsel auf einen aktiven Entry gelöscht, sonst gesetzt (`er:1925-1936`).
  - **Falle:** Kollisionsprüfung für `new_unique_id` sucht unter der **alten** Plattform
    (`er:1953-1960`: `async_get_entity_id(old.domain, old.platform, …)`). Hat `fritzbox_network`
    die Ziel-unique_id schon, gibt es **keinen** Fehler; der Index `(domain, platform, unique_id)`
    wird still überschrieben (`er:998`) → zwei Einträge, einer unauffindbar. Wir müssen vorher selbst prüfen.
  - Gerätezuordnung wird nur auf Existenz geprüft, nicht auf denselben Entry (`er:1169-1172`).
  - Composite-Geräte-IDs (Aufspaltung vor 2026.8) werden als `device_id` ignoriert (`er:1804-1832`).
- `async_update_entity(entity_id, *, device_id, labels, aliases, …)` (`er:2013-2066`) für das Umhängen
  unserer Entitäten und Übernehmen von Labels.
- `async_remove(entity_id)` legt einen `deleted_entities`-Eintrag an.
- Reaktion auf Geräteänderungen (`er:1670-1802`):
  - Gerät gelöscht: Entitäten **desselben** Entries werden gelöscht, fremde nur abgehängt (`er:1681-1700`).
  - Gerät wechselt den Entry: Entitäten des **alten** Entries an diesem Gerät werden **gelöscht** (`er:1714-1726`).
- `async_clear_config_entry` beim Löschen eines Entries entfernt dessen Entitäten (`er:2415-2431`).

### 3.2 Device-Registry (seit 2026.8: ein Gerät = genau ein Config-Entry)
- `config_entries` ist nur noch ein Shim `{config_entry_id}` (`dr:454-464`); Indizes und Kollisionen
  sind **pro Entry** (`dr:1036-1210`, `_validate_connections/_identifiers` `dr:2712-2770`).
  Core- und unser Gerät für dieselbe MAC sind also zwei Geräte (deckt sich mit PLAN.md:18).
  Ein „Zusammenführen“ zweier Geräte gibt es **nicht**.
- `async_update_device(device_id, *, new_config_entry_id, new_identifiers, new_connections, merge_identifiers, merge_connections, area_id, name_by_user, labels, disabled_by, via_device_id, …)` (`dr:2486-2618`).
  - Umzug: `new_config_entry_id` verschiebt sofort (`dr:2166-2195`); `add_`+`remove_config_entry_id` ist deprecated (Pending-Move, `dr:2196-2262`).
  - Beim Umzug werden die behaltenen identifiers/connections gegen den **Ziel**-Entry geprüft
    → `DeviceConnectionCollisionError`/`DeviceIdentifierCollisionError`, wenn wir dort schon ein Gerät
    mit derselben MAC haben (`dr:2343-2356`). Deshalb muss unser Doppel vorher weg.
  - `disabled_by=CONFIG_ENTRY` wird beim Umzug an den Zustand des Ziel-Entries angepasst (`dr:2358-2404`).
  - Gelöschte Geräte des Ziel-Entries mit gleicher Identität werden verworfen (`dr:2440-2462`).
  - Gerät muss identifiers oder connections behalten (`dr:2141-2144`).
- `async_remove_device(device_id)` (`dr:2813-2849`): löscht `via_device_id`-Verweise anderer Geräte.
- `async_get_or_create` sucht nur im eigenen Entry (`dr:1852-1856`); nach dem Umzug findet unser Setup
  das übernommene Gerät über identifiers/MAC und ergänzt seine identifiers (`dr:1997-2033`).
- Composite-IDs (vor 2026.8 geteilte Geräte): alte ID löst auf die verbliebenen Teilgeräte auf
  (`dr:1635-1643`, `dr:1535-1546`). Automationen mit alter Composite-ID bleiben auflösbar, solange
  ein Teil existiert (Code gelesen, nicht getestet).

### 3.3 Recorder / Verlauf
- Zustände (`states_meta`) und Langzeitstatistik (`statistic_id`, Quelle `recorder`) hängen an der
  **entity_id**. Bleibt sie, läuft beides weiter (mit Lücke während der Migration). Keine Recorder-API
  nötig. Plattform/unique_id spielen für den Recorder keine Rolle.
- Einheitenwechsel innerhalb einer Einheitenklasse (kB/s → Mbit/s) wird umgerechnet
  (`components/sensor/recorder.py:311-325`); nicht umrechenbare Wechsel unterdrücken die Statistik mit Hinweis (`:325-347`).
- Zeitstempel → Zahl (connection_uptime) wäre ein Typbruch → nicht migrieren.
- Unsere bei Kollision gelöschte Entität: ihr Verlauf bleibt verwaist unter ihrer entity_id;
  Statistiken lassen sich nicht in eine bestehende `statistic_id` zusammenführen.

### 3.4 Was nicht geht
- Geräte zweier Entries zusammenführen (gibt es nicht mehr).
- `async_update_entity_platform` auf geladene Entitäten.
- Ein Rückgängig im Registry-Sinn (keine Transaktion); gelöschte Geräte/Entitäten lassen sich nur
  näherungsweise über `deleted_*` wiederherstellen.
- Automationen, die `fritz.*`-Dienste oder `update.install` auf der Box nutzen, lassen sich nicht umbiegen.

Hilfen für die Vorschau: `automation.automations_with_entity/_device`
(`components/automation/__init__.py:158`, `:170`), `script.scripts_with_entity/_device`
(`components/script/__init__.py:122`, `:134`).

---

## 4. Migrationsentwurf

### 4.1 Wo
- **Repair-Flow** (fixable Issue, Muster wie `StaleDevicesFlow`, `fn/repairs.py:182-231`), angelegt beim
  Setup unseres Entries, wenn ein `fritz`-Entry existiert, dessen Box-Gerät `("fritz", S)` unsere
  Seriennummer trägt (Fallback: gleicher Host). Gilt für Neu- und Bestandsinstallationen gleich, denn
  unser Entry hat nach dem ersten Setup ohnehin schon eigene Geräte (Fall „beide vorhanden“ ist der Normalfall).
- Zusätzlich Dienst `fritzbox_network.migrate_from_core` mit `dry_run: true` (Antwort `SupportsResponse.ONLY`)
  für Vorschau/Tests; ausführen nur über den Flow (Bestätigung).
- Optional im Config-Flow ein Menüpunkt „Von FRITZ!Box Tools übernehmen“, der nur Host/Port/Benutzer/
  Passwort/`ssl→use_tls` und `consider_home` vorbelegt (Passwort nicht anzeigen). Die eigentliche
  Migration bleibt im Repair-Flow.

### 4.2 Ablauf
1. **Vorschau** (lesend, `fritz` darf geladen sein): Plan je Core-Entität: *migrieren* (Ziel-unique_id,
   Kollision mit unserer Entität ja/nein, deren entity_id), *kein Gegenstück*, *bewusst nicht*,
   *bei uns nicht erzeugt* (Filter/Rechte/Mesh-Knoten/versteckte MAC, `wants_device`). Je Gerät:
   übernehmen/Metadaten übertragen. Dazu Referenzen (Automationen/Skripte) auf betroffene entity_ids
   und device_ids beider Seiten, `fritz.*`-Dienstnutzung, Alt-unique_ids.
2. **Bestätigung** mit Hinweis auf Backup; Angebot `backup.create_automatic` (in `components/backup/services.yaml:2` vorhanden; Bedingungen nicht geprüft).
3. Journal schreiben (`Store`, `fritzbox_network.core_migration.<entry_id>`): alter Zustand jeder
   berührten Registry-Zeile (entity: id, entity_id, platform, unique_id, config_entry_id, device_id,
   disabled_by, labels; device: id, config_entry_id, identifiers, connections, area_id, name_by_user,
   labels, disabled_by) und vollständige Kopien unserer zu löschenden Entitäten/Geräte.
4. `fritz` **deaktivieren** (`async_set_disabled_by(…, USER)`, `config_entries.py:2496`) → entlädt,
   verhindert Neustart mit Duplikaten; unseren Entry entladen.
5. Pro Plan-Zeile *migrieren*: kollidierende eigene Entität erst `async_remove`, Labels/Aliasse vorher
   in die Core-Zeile vereinigen (unser Panel nutzt Labels für Gruppen); dann
   `async_update_entity_platform(eid, "fritzbox_network", new_config_entry_id=ours, new_unique_id=…)`.
6. Nicht migrierte `fritz`-Entitäten an zu übernehmenden Geräten: `device_id=None` (sonst löscht der
   Geräteumzug sie still, `er:1714-1726`). Sie bleiben im deaktivierten `fritz`-Entry.
7. Geräte, je MAC bzw. Box (Variante „Core-Gerät übernehmen“, Standard):
   a. alle unsere Entitäten am eigenen Doppel `D_o` auf das Core-Gerät `D_c` umhängen (`device_id=D_c`),
   b. Metadaten zusammenführen: `area_id`, `name_by_user`, `labels` von `D_c`, Lücken aus `D_o`,
   c. `D_o` löschen (jetzt ohne unsere Entitäten, sonst würden sie mitgelöscht, `er:1681-1692`),
   d. `D_c` umziehen: `async_update_device(D_c, new_config_entry_id=ours)`; bei der Box zusätzlich
      `new_identifiers={("fritzbox_network", S)}`. Kollision abfangen → Gerät in Fehlerliste, nicht abbrechen.
   Variante „unser Gerät behalten“ (wenn `D_o` von Automationen genutzt wird und `D_c` nicht):
   nur Metadaten auf `D_o` übertragen, Entitäten auf `D_o` hängen; `D_c` bleibt bei `fritz`.
8. Unseren Entry laden; die Plattformen hängen Entitäten über `device_info` an die übernommenen Geräte
   (`entity_platform.py:955-1021`), `via_device_id` wird neu gesetzt.
9. Ergebnisbericht (persistente Benachrichtigung) + Repair „FRITZ!Box Tools ist deaktiviert; nach Prüfung
   selbst löschen“. **Nie automatisch löschen.** Hinweis: Wieder-Aktivieren erzeugt Duplikate (`_2`).
   Deaktiviert lassen unterdrückt auch die SSDP-Neuentdeckung (`config_entries.py:2190-2196`, `fritz/config_flow.py:177-186`).

### 4.3 Idempotenz
- Marker im Journal und `previous_unique_id`; jede Zeile wird nur bearbeitet, wenn ihr Ist-Zustand dem
  Plan-Ausgangszustand entspricht (Plattform `fritz`, Entry = Quelle). Bereits migrierte Zeilen werden
  übersprungen; ein abgebrochener Lauf kann fortgesetzt werden.
- Plan wird unmittelbar vor der Ausführung neu berechnet und mit der bestätigten Vorschau verglichen
  (Abweichung → erneut bestätigen).

### 4.4 Rückweg
- Primär: HA-Backup von Schritt 2.
- Sekundär: Dienst `undo_core_migration` aus dem Journal, solange `fritz` deaktiviert existiert:
  Entitäten per `async_update_entity_platform` zurück, Geräte zurückziehen, gelöschte eigene Entitäten
  neu anlegen lassen (Reload). Ehrlich: Registry-IDs unserer gelöschten Geräte/Entitäten sind danach
  neu; best effort.

### 4.5 Sonderfälle
- Core-Entität ohne Gegenstück: bleibt unverändert beim deaktivierten `fritz`-Entry, wird in der
  Vorschau mit ihren Automationsreferenzen aufgeführt; verschwindet erst, wenn der Nutzer `fritz` löscht.
- Gegenstück existiert, wird bei uns aber nicht erzeugt (Filter, fehlende Schreibrechte, Mesh-Knoten,
  versteckt): **nicht** migrieren — sonst verwaiste Registry-Zeile, und `_remove_filtered_devices`
  (`fn/coordinator.py:657-680`) bzw. `async_remove_node_client_entities` (`fn/entity.py:116-131`) würden sie löschen.
- entity_id-Kollision: entsteht nur über die Ziel-unique_id (Core-entity_id gewinnt, unsere Zeile wird
  gelöscht). Vorschau zeigt beide entity_ids und ihre Referenzen; Option pro Zeile „unsere behalten“
  (dann Core-Zeile nicht migrieren).
- `feature_device_tracking=False` im Core: keine Core-Tracker; wir legen trotzdem Tracker an.
- Repeater-`fritz`-Einträge: nur Gerätedaten (Area, Name, Labels) auf unser Repeater-Gerät
  (`("fritzbox_network", node.mac)`, Zuordnung über MAC ∈ `node.macs`); Entitäten ✘.
- Mehrere Boxen: Zuordnung strikt über `S`.

### 4.6 Sicherheitsregeln
Vorschau vor jeder Änderung; ausdrückliche Bestätigung; kein stilles Löschen (Core-Restentitäten
werden abgehängt statt gelöscht); `fritz` nur deaktivieren; jede Löschung unserer Objekte steht in
Vorschau und Journal; Abbruch eines Schritts → Rest weiter, Fehlerliste im Bericht.

---

## 5. Risiken, offene Fragen, Tests

### 5.1 Risiken (absteigend)
1. **Stilles Überschreiben des unique_id-Index** (`er:1953-1960`, `er:998`), wenn unsere Entität nicht
   vorher entfernt wird → Registry-Korruption. Muss getestet sein.
2. **Kaskaden-Löschungen** der Registry: Geräteumzug löscht Entitäten des alten Entries (`er:1714-1726`),
   Gerätelöschung die des eigenen (`er:1681-1692`). Reihenfolge 4.2 Schritte 5–7 zwingend.
3. Device-basierte Automationen (Trigger/Aktionen mit `device_id`) zeigen auf genau eine der beiden
   Geräte-IDs; die andere bricht. Vorschau muss beide Seiten zeigen.
4. Semantik-/Attributunterschiede (Tracker-Attribute, `update.install`, `fritz.*`-Dienste,
   connection_uptime) brechen Templates/Automationen, obwohl die entity_id bleibt.
5. Unsere Bereinigungsroutinen löschen migrierte Zeilen, wenn wir die Entität nicht erzeugen (4.5).
6. Groß-/Kleinschreibung der MAC in Core-unique_ids (nur live sicher).
7. Composite-Geräte aus der Zeit vor 2026.8: Verhalten beim Entfernen eines Teils nur gelesen.
8. HA-Änderungen an der Registry (2027.8 entfernt Shims und Pending-Moves, `dr:2166-2195`) — nur
   `new_config_entry_id` verwenden.

### 5.2 Offene Fragen
- Ist `format_mac(S)` die LAN-MAC der Box, und legt unsere Integration für die Box kein Client-Gerät
  mit dieser MAC an? (Test sagt: kein Box-Tracker, `tests/test_devices.py:47-48`; live prüfen.)
- Liefert `link_kb_s_*`/`max_kb_s_*` live dieselben Werte wie unser `dsl_rate_*`? (≈-Zeilen)
- Werden die deprecated Buttons in 2026.11 schon nicht mehr angelegt (dann nur Registry-Leichen)?
- Soll `S-connection_uptime` optional (mit Warnung) migriert werden?

### 5.3 Testplan
Unit (pytest-homeassistant-custom-component, vorhanden; Fixtures `tests/conftest.py:290-317`):
Core nicht laden, sondern `MockConfigEntry(domain="fritz", data=…)` plus von Hand angelegte
Registry-Zeilen mit Plattform `fritz` (`er.async_get_or_create("sensor", "fritz", "SERIAL1-kb_s_received", config_entry=…)`, Geräte mit `("fritz","SERIAL1")` bzw. MAC-connection).
- Vorschau: Klassifizierung aller Zeilen aus 2.2, inkl. Filter/Rechte (`fake_client.writable=False`).
- Kollision: unsere Entität vorhanden → wird entfernt, Core-entity_id bleibt, Labels vereinigt, Index konsistent
  (`async_get_entity_id("sensor","fritzbox_network",uid)` liefert die Core-entity_id, keine Doppelzeile).
- Geräteübernahme Box und Client: Geräte-ID von `D_c` bleibt, Entry gewechselt, identifiers ersetzt,
  `D_o` weg, unsere Entitäten hängen danach an `D_c`, nicht migrierte `fritz`-Zeilen existieren noch (abgehängt).
- `disabled_by=CONFIG_ENTRY`-Bereinigung nach Deaktivieren von `fritz`; vom Nutzer deaktivierte Zeilen bleiben deaktiviert.
- Idempotenz: zweiter Lauf ändert nichts; Abbruch nach Schritt 5 und Fortsetzung.
- Tracker-unique_id: Großbuchstaben-MAC → `format_mac`.
- Danach unser Setup: keine neuen Entitäten mit `_2`, Zustände unter Core-entity_ids.
- Undo aus dem Journal.
- `async_update_entity_platform` auf geladene Entität → sauberer Fehler im Flow.

Nur live prüfbar:
- echte Core-unique_ids/MAC-Format, Alt-IDs aus `_migrate_to_new_unique_id`;
- Verlauf und Langzeitstatistik über die Migration (Einheitenumrechnung kB/s → Mbit/s in der Energie-/Statistikansicht);
- device-basierte Automationen und Dashboards nach der Migration;
- Repeater-Einträge, Composite-Geräte aus Installationen vor 2026.8;
- SSDP-Neuentdeckung nach Löschen von `fritz`; Backup und Undo.
