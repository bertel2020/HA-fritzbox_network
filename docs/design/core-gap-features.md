# Lücken zum Core-`fritz`: Machbarkeit und Entwurf

Stand: 2026-11-07 · Status: Studie, kein Code · Ziel: Core-`fritz` (FRITZ!Box Tools) überflüssig machen, Telefonie bleibt draußen (PLAN.md Teil A).

## Kennzeichnung und Quellen

- **[V]** geprüft, mit Quelle:
  - **SCPD**: Dienst-/Aktionsbeschreibung der echten Box (7590 AX, FRITZ!OS 8.25) aus dem fritzconnection-Cache `~/.fritzconnection/192_168_79_10_cache.pcl`, ausgelesen mit fritzconnection 1.15.1 aus `.venv`.
  - **fc**: Quelltext von fritzconnection 1.15.1 in `.venv`.
  - **Core**: Quelltext `homeassistant/components/fritz` in `.venv`.
  - **Live**: Zustände im laufenden HA des Maintainers (Core-`fritz`-Einträge „FRITZ-RM“ und „fritz-repeater1200ax“ sowie unser Eintrag, gelesen per HA-MCP, nur lesend).
  - **Spike**: `spike_out/*.txt`, `tests/fixtures`.
- **[A]** angenommen, nicht geprüft. Vor dem Bauen mit einem Lese-Spike klären (siehe Abschnitt 5).

Kosten zählen **zusätzliche Requests an die Box pro Poll** (30 s). Ausgangslage [V Live, Diagnose]: ein Poll braucht 7,6 s, der langsamste bisher 33,7 s. Alles läuft über den einen `threading.Lock` in `api.py`: jeder neue Request verlängert den Poll und hält Tastendrücke (WS, Services) so lange auf.

Schema der Box-Entities [V `sensor._BoxSensor`, `button.FritzNetworkRefresh`]: `unique_id = f"{serial}_{key}"`, `entity_id = f"<plattform>.fritz_network_{key}"`, `translation_key = key`, Gerät `identifiers={(DOMAIN, serial)}`. Schreibende Entities nur mit `coordinator.can_write` (BoxAdmin = readwrite).

`_lean` [V `coordinator._fetch`]: Der erste Poll liest Hosts, Mesh, Profile, Internet und Gast-WLAN. VPN, Routen, Firmware, DHCP und feste Adressen liest erst der zweite Poll, den `__init__` direkt nach dem Setup startet. **Regel für alles Neue:** Nichts kommt in den schlanken Zweig. Neue Lesezugriffe gehören in den `else`-Zweig, mit eigenem Takt über `self._polls % N`.

## 0. Vorab: ein Fehler beim Gast-WLAN (gefunden bei der Prüfung)

`api._guest_wifi_service()` sucht `NewX_AVM-DE_APType == "guest"` in `WLANConfigurationN/GetInfo`.
- [V SCPD] `GetInfo` hat **kein** `NewX_AVM-DE_APType`. Das Feld steht in `X_AVM-DE_GetWLANExtInfo`, zusammen mit `NewX_AVM-DE_APEnabled` und `NewX_AVM-DE_FrequencyBand`.
- [V Live] Unsere Diagnose zeigt `guest_wifi: null`, obwohl `can_write: true`. Es gibt keinen Gast-WLAN-Schalter. Core zeigt auf derselben Box `switch.fritz_rm_wi_fi_wlan_rm_gast` = on.
- [V] `tests/test_api.py::_guest_client` setzt `APType` als Antwort von `GetInfo` und verdeckt den Fehler damit.

Korrektur: Für `WLANConfiguration1..n` (nur Dienste, die in `fc.services` stehen) einmal `X_AVM-DE_GetWLANExtInfo` lesen. Der Typ steht dort in `APType`. Den Wert von `GetInfo.NewEnable` weiter wie bisher lesen. Fallback, wenn `GetWLANExtInfo` fehlt: der höchste Dienst, wie bei `FritzGuestWLAN` [V fc]. Der Fallback ist [A]. Diese Suche ist auch die Grundlage für 2.7.

## 1. Was Core kann – vollständige Liste

Systematisch durchgesehen: coordinator, sensor, binary_sensor, switch, button, update, image, services, diagnostics, config_flow, device_tracker, `__init__`.

| Core-Funktion | Core-Quelle | Bei uns | Abschnitt |
|---|---|---|---|
| Tracker, consider_home, Mesh-Zuordnung | device_tracker, coordinator | vorhanden | – |
| Internetzugang je Gerät (Switch) | switch `internet_access` | vorhanden | – |
| WoL-Button je LAN-Gerät | button | vorhanden | – |
| `is_connected` | binary_sensor | vorhanden (`internet_connected`) | – |
| `is_linked` (PhysicalLinkStatus) | binary_sensor | **fehlt** | 2.5 |
| externe IPv4/IPv6 | sensor | vorhanden | – |
| `connection_uptime` (Zeitstempel) | sensor | vorhanden als Dauer in Sekunden (`internet_uptime`) | 2.11 |
| `kb_s_sent/received` (ByteSendRate) | sensor | vorhanden, besser: aus Zählerdifferenz | – |
| `gb_sent/received` | sensor | **Daten vorhanden, keine Entity** | 2.4 |
| `max_kb_s_*` (WANCommonIFC1 Layer1) | sensor | nur auf DSL (`dsl_rate_*`); **fehlt auf Kabel/Glasfaser** | 2.4 |
| `link_kb_s_*` (WANCommonInterfaceConfig1 Layer1) | sensor | **fehlt** (auf DSL = erreichbare Rate) | 2.4 |
| Störabstand/Dämpfung | sensor | vorhanden (+ FEC/CRC) | – |
| `device_uptime` | sensor | **fehlt** | 2.3 |
| `cpu_temperature` | sensor | **fehlt** | 2.6 |
| Neustart, Neu verbinden | button | nur im Panel (WS) | 2.1, 2.2 |
| Firmware-Update installieren | update `INSTALL` | **fehlt** (unsere Update-Entity zeigt nur an) | 2.10 |
| Buttons `firmware_update`, `cleanup` | button | im Core deprecated (Entfernung 2026.11) | weglassen |
| WLAN-Schalter je Netz | switch | **fehlt**, Gast-WLAN defekt (0) | 2.7 |
| Gast-WLAN-QR (image) | image | **fehlt** | 2.9 |
| `set_guest_wifi_password` | services | **fehlt** | 2.8 |
| `dial` | services | Telefonie | weglassen |
| Anrufumleitung | switch | Telefonie | weglassen |
| Portfreigabe-Schalter (nur HA-Host) | switch | nur lesend (Panel) | 2.12 |
| SSDP-Discovery | config_flow, manifest | **fehlt** | 2.13 |
| reauth, reconfigure | config_flow | vorhanden | – |
| Optionen `consider_home` / `old_discovery` / `feature_device_tracking` | config_flow | consider_home: vorhanden; old_discovery: weglassen (PLAN); Tracking aus: über Filter | 2.14 |
| Setup verweigert bei UPnP-Status aus | `__init__` | **fehlt** (wir lesen über IGD-Dienste) | 2.15 |
| Diagnose: Dienste, Rechte, CPU, WAN-Link, Firmware-Extras | diagnostics | teilweise | 2.15 |
| Repeater als eigener Eintrag (Neustart, CPU, WLAN, QR, Update) | ganzes Modul | Repeater werden abgelehnt (`mesh_repeater`) | 4 |

## 2. Feature für Feature

### 2.1 Button Neustart
- Aufruf: `DeviceConfig1/Reboot`, ohne Argumente [V SCPD]. Bereits vorhanden: `api.reboot()` und WS `box/reboot` mit `can_write`-Prüfung [V].
- Rechte: BoxAdmin readwrite [A, wie die übrigen Schreibaktionen].
- Kosten: 0 pro Poll. Danach scheitern die Polls ein paar Minuten lang; Backoff ab 3 Fehlern [V `_register_failure`]. Das passt so.
- Erkennung: Dienst `DeviceConfig1` in `fc.services`.
- Entity: `button`, key `reboot`, `device_class=RESTART`, `entity_category=CONFIG`, **standardmäßig aus**. Ein Button hat keine Rückfrage, das Panel schon. `unique_id f"{serial}_reboot"`, `entity_id button.fritz_network_reboot`. Nur mit `can_write`.
- Lock: ein Request. Er wartet höchstens einen laufenden Poll ab.
- Test: Button ruft `client.reboot`; ohne `can_write` gibt es keine Entity.

### 2.2 Button Neu verbinden
- Aufruf: `WANIPConn1/ForceTermination` (IGD) [V SCPD], vorhanden als `api.reconnect()`. Core nimmt den Standarddienst aus `Layer3Forwarding1/GetDefaultConnectionService` (hier `WANPPPConnection1`, auch dort gibt es `ForceTermination`) [V SCPD, Core].
- Übernehmen: Core übergeht UPnP-Fehler 707 „DisconnectInProgress“ [V Core]. Bei uns fehlt das. Fallback auf den Standarddienst, wenn `WANIPConn1` fehlt (UPnP-Status aus, 2.15).
- Kosten: 0. Danach `async_request_refresh()`. Die Uptime fällt, also liest `_fetch_internet` den langsamen Teil sofort neu [V].
- Entity: key `reconnect`, `RESTART`, `CONFIG`, standardmäßig aus, nur mit `can_write`.
- Test: 707 wird geschluckt, andere Fehler werden zu `HomeAssistantError(action_failed)`.

### 2.3 Sensor Betriebszeit der Box („Letzter Neustart“)
- Aufruf: `DeviceInfo1/GetInfo` → `NewUpTime` [V SCPD, fc `device_uptime`]. Die Antwort enthält auch `NewDeviceLog` (das ganze Ereignisprotokoll), der Aufruf ist also teuer.
- **Kostenlos beim Setup:** `client.serial_number` ruft genau diese Aktion schon auf [V `__init__._connect`]. `NewUpTime` dort mitnehmen und `boot = jetzt − uptime` speichern.
- Danach neu lesen nur in diesen Fällen:
  - alle `FIRMWARE_REFRESH_POLLS` Polls (≈ 1 h), nicht im schlanken Poll;
  - im ersten erfolgreichen Poll nach Fehlern (die Box kann neu gestartet sein);
  - nach dem eigenen Reboot-Button.
  - Kosten im Mittel ≈ 0.
- Entity: `sensor`, key `box_uptime`, `device_class=UPTIME` (gibt es in HA [V `sensor/const.py`], Core nutzt sie auch), `entity_category=DIAGNOSTIC`, standardmäßig an. Wert auf die Minute runden und nur bei Abweichung > 60 s ändern, damit der Recorder nicht jede Stunde schreibt.
- Erkennung: fehlt `NewUpTime`, gibt es keine Entity (Listener-Muster wie `_async_setup_dhcp_pool`).
- [V Live] Core zeigt `sensor.fritz_rm_letzter_neustart` = 2026-11-04T12:27:58Z. Die Aktion liefert also auf dieser Box.

### 2.4 Bytes gesamt und Leitungsraten
- **Bytes:** schon gelesen, in jedem Poll, ohne Mehrkosten [V `INTERNET_FAST`, `parse_internet._counter`: `NewX_AVM_DE_TotalBytes*64`, sonst 32 Bit]. Es gibt **keine** Entity dafür [V sensor.py].
  - Neu: keys `internet_bytes_received` / `internet_bytes_sent`, `device_class=DATA_SIZE`, `state_class=TOTAL_INCREASING`, Einheit `BYTES`, `suggested_unit_of_measurement=GIGABYTES`, `entity_category=DIAGNOSTIC`, standardmäßig aus.
  - Neustart der Box oder 32-Bit-Überlauf: `TOTAL_INCREASING` wertet einen Rückgang als neuen Zyklus. Beim Überlauf geht der Rest bis 2³² verloren [A, hinnehmbar].
- **Leitungsraten:**
  - [V Spike/Live, DSL] `WANCommonIFC1` Layer1 = 55 020/11 000 kbit/s = Sync-Rate (Core „max_kb_s“). Unser `dsl_rate_*` (X_AVM-DE_GetDSLInfo CurrRate 56 316/11 260) deckt das ab.
  - [V Live] `WANCommonInterfaceConfig1` Layer1 = 96 923/34 899 kbit/s ≈ `DownstreamMaxRate`/`UpstreamMaxRate` (96 347/34 957), also die **erreichbare** Rate (Core „link_kb_s“).
- **Kabel/Glasfaser/LTE:** `InternetInfo.rate_down/up` wird schon aus `WANCommonIFC1` Layer1 gefüllt [V `parse_internet`], aber nur die DSL-Sensoren zeigen es, mit `dsl=True`. **Auf Nicht-DSL-Boxen gibt es heute keinen Raten-Sensor.**
- Neu, ohne zusätzliche Requests:
  - `internet_line_rate_down/up` aus `i.rate_*`, nur wenn `i.dsl is None` (kein Doppel auf DSL), `DATA_RATE` in Mbit/s, `DIAGNOSTIC`, standardmäßig aus;
  - `dsl_max_rate_down/up` aus `i.dsl.max_rate_*` (schon geparst [V `_dsl`]), `dsl=True`, standardmäßig aus.
- `WANCommonInterfaceConfig1` nicht zusätzlich lesen: für DSL bringt es nichts Neues. Ob es auf Kabel/Glasfaser mehr sagt als `WANCommonIFC1`, ist [A] (Spike `spike_wan.py` auf einer solchen Box).

### 2.5 Binary Sensor „Leitung“ (`is_linked`)
- Feld: `WANCommonIFC1/GetCommonLinkProperties → NewPhysicalLinkStatus` [V SCPD, Spike: „Up“]. Wird schon in `INTERNET_SLOW` gelesen (jeder 10. Poll), aber nicht geparst.
- Kosten: 0. `InternetInfo.linked: bool | None` ergänzen.
  - Aktualität: höchstens 10 Polls alt.
  - Zusätzlich den langsamen Teil sofort lesen, wenn `connected` auf False springt (eine Erweiterung der vorhandenen Logik zum Uptime-Rückgang). Dann zeigt ein Leitungsausfall sich spätestens im nächsten Poll.
- Entity: `binary_sensor`, key `internet_linked`, `device_class=PLUG` (wie Core; CONNECTIVITY ist schon an `internet_connected` vergeben), `DIAGNOSTIC`, standardmäßig aus.
- Erkennung: kein Wert, keine Entity (Listener). Fehlt das Feld, wird die Entity unavailable.

### 2.6 Sensor CPU-Temperatur
- Aufruf: Webinterface `/query.lua` mit `CPUTEMP=cpu:status/StatTemperature` und `sid`. Antwort `{"CPUTEMP": "72,72,71,…"}`, neuester Wert zuerst [V fc `get_cpu_temperatures`, „experimental, non-public API“]. [V Live] `sensor.fritz_rm_cpu_temperatur` = 72 °C auf 7590 AX 8.25, Repeater 65 °C.
- **Nicht** `fc.get_cpu_temperatures()` benutzen: fritzconnection hat dafür einen eigenen Web-Login (`http_interface.sid`), das wäre eine zweite Session neben unserem `_web_sid`. Stattdessen eine neue Methode `api.get_cpu_temperature()` über den vorhandenen `_web_sid`/`_web_login` (GET wie `_web_get`, Session einmal erneuern wie in `_web_data`).
- Rechte: Login ins Webinterface. Welches Recht genau nötig ist, ist [A]; mit BoxAdmin klappt es (Core, gleiches Konto [A]).
- Kosten: 1 Web-Request, plus Login, falls die Session abgelaufen ist.
  - Takt: jeder `INTERNET_DETAIL_POLLS` (10.) Poll, nie im schlanken Poll.
  - **Nur gelesen, solange die Entity aktiv ist:** `async_added_to_hass` meldet Bedarf beim Coordinator an, `async_will_remove_from_hass` meldet ab. Eine abgeschaltete Entity kostet dann nichts.
- Erkennung (wie Core `_is_suitable_cpu_temperature`): Die Box gilt als ohne Sensor bei leerer Liste, bei 0 °C und bei einer Antwort ohne `CPUTEMP`. Einmal im zweiten Poll prüfen; erst bei Erfolg die Entity anlegen (Listener). Bei Misserfolg nicht wieder fragen bis zum nächsten Setup.
- Entity: key `cpu_temperature`, `TEMPERATURE`, °C, `MEASUREMENT`, `DIAGNOSTIC`, standardmäßig aus.
- Test: Parser (Liste, 0, kaputtes JSON), Session-Erneuerung, kein Aufruf im schlanken Poll, kein Aufruf ohne angemeldeten Bedarf.

### 2.7 WLAN-Schalter für jedes Netz
- Core [V]: Die Anzahl der `WLANConfiguration*`-Dienste bestimmt die Namen:
  - bei n Diensten ist der letzte „Guest“;
  - bei 4 Diensten wird der 3. als „Mesh intern“ übersprungen;
  - sonst Index 0/1/3 → 2,4 / 5 / 5 GHz High–6 GHz.
  - Je Dienst ein Schalter, auch bei gleicher SSID auf beiden Bändern (combined SSID). [V Live] zwei Schalter „WLAN-RM (2,4/5 GHz)“ plus „WLAN-RM_Gast“.
  - Zustand: `GetInfo` je Schalter bei jedem Entity-Poll (`async_update`, also eigene Requests neben dem Coordinator).
- Unsere Box [V SCPD]: `WLANConfiguration1..3`, kein 4. Dienst. `GetInfo` liefert `NewEnable`, `NewStatus`, `NewSSID`, `NewX_AVM-DE_FrequencyBand`, `NewBSSID`, `NewStandard`. `X_AVM-DE_GetWLANExtInfo` liefert `APType`, `APEnabled`, `FrequencyBand`. Schalten: `SetEnable(NewEnable)`. Dazu gibt es `X_AVM-DE_SetWLANGlobalEnable` (das ganze WLAN aus).
- Entwurf:
  - **Ermittlung einmal (zweiter Poll), nicht über den Index.** Für jeden vorhandenen Dienst einmal `X_AVM-DE_GetWLANExtInfo`. `APType` = guest ergibt das Gastnetz (vorhandener `guest_wifi`-Schalter, siehe 0), sonst ein Hauptnetz mit Band aus `FrequencyBand`.
  - Kosten: einmalig n Requests (3 auf der 7590 AX), dazu kommt die Korrektur aus 0. Ein Dienst, der weder Gast ist noch ein bekanntes Band hat (Mesh-Backhaul? [A]), bekommt keinen Schalter.
  - **Lesen:** `GetInfo` je Hauptnetz alle `INTERNET_DETAIL_POLLS` (10.) Polls, im Coordinator, nicht per `async_update`. Das Gastnetz bleibt bei jedem Poll, weil die Box es per Zeitlimit selbst abschaltet. Kosten im Mittel 0,2 Requests pro Poll auf der 7590 AX.
  - Nach dem Schalten den Wert sofort zeigen (`_guest_override`-Muster verallgemeinern: `dict[str, (bool, deadline)]`) und den Dienst im nächsten Poll lesen.
  - Entity: `switch`, key `wifi_<band>` (`wifi_2_4ghz`, `wifi_5ghz`, `wifi_6ghz`), `unique_id f"{serial}_wifi_5ghz"`. Der Dienst-Index kommt nicht in die ID, weil er je Modell anders liegt. Weitere Angaben:
    - `translation_key` = key, Name mit Platzhalter `{ssid}` (`translation_placeholders`, sonst sieht man bei combined SSID nicht, was gemeint ist);
    - `entity_category=CONFIG`, standardmäßig an (Core: an), nur mit `can_write`;
    - Attribute: `ssid`, `bssid`, `standard`.
  - Warnung in der Doku: HA selbst im WLAN kann sich aussperren.
- Mesh [A]: Die Master-Box gibt ihre WLAN-Einstellungen an die Repeater weiter, ein Schalter hier wirkt also im ganzen Mesh. Vor der Doku prüfen.
- Optional: ein Schalter `wifi` über `SetWLANGlobalEnable`. Den Zustand liest man aus `GetInfo.NewX_AVM-DE_WLANGlobalEnable` [V SCPD], ohne Extra-Request. Standardmäßig aus.
- Test: Ermittlung mit drei Diensten (Fixture aus dem Spike), mit 4 Diensten und mit fehlendem `GetWLANExtInfo`; Takt; Override nach dem Schalten.

### 2.8 Aktion `set_guest_wifi_password`
- Aufruf: `WLANConfiguration<Gast>/SetSecurityKeys` mit `NewKeyPassphrase`, `NewPreSharedKey`, `NewWEPKey0..3` = "" [V SCPD, fc `set_password`]. fritzconnection bildet den PSK zufällig aus `GetInfo.NewAllowedCharsPSK` × `NewMaxCharsPSK` [V fc].
- Nicht `FritzGuestWLAN` benutzen: Es nimmt einfach den höchsten Dienst [V fc]. Neue Methode `api.set_guest_wifi_password(password)` auf dem ermittelten Gastdienst (0).
- Schema wie Core: `password` 8–63 Zeichen oder `length` 8–63 (Standard 12). Gerätewahl wie `set_route`: eine Box je Eintrag, keine Zielauswahl [V services.py]. `async_register_admin_service`.
  - Besser als Core: `SupportsResponse.OPTIONAL`, das erzeugte Passwort kommt als Antwort zurück.
  - Danach den QR (2.9) neu erzeugen.
- Rechte: BoxAdmin readwrite [A]. Kosten: 0 pro Poll (2 Requests beim Aufruf: GetInfo, SetSecurityKeys).
- Test: Schema, PSK aus erlaubten Zeichen, richtiger Dienst, ohne Rechte `no_write_rights`.

### 2.9 Gast-WLAN-QR (image)
- Daten:
  - `GetInfo` (SSID, `NewBeaconType`) und `GetSecurityKeys → NewKeyPassphrase` des Gastdienstes [V SCPD].
  - fritzconnection fragt zusätzlich `GetSSID`, `GetBeaconType`, `GetBeaconAdvertisement` einzeln ab, ≈ 4 Requests [V fc]. Wir brauchen 2.
  - Die Zuordnung BeaconType → WPA/WEP/nopass übernehmen (`_BEACONTYPE_TO_QR_SECURITY` [V fc]).
- Bild: `segno` ist **nicht** in unserer `.venv` [V]. Core holt es über `fritzconnection[qr]`. Also `segno` in `manifest.json` `requirements` aufnehmen (reines Python, klein). Alternativ den QR nur im Panel zeichnen; dafür bräuchte es eine JS-Bibliothek [A]. Empfehlung: segno.
- Kosten:
  - Core pollt das Image (`_attr_should_poll=True`, 30 s), das sind 4 Requests alle 30 s [V Core].
  - Bei uns: erzeugen beim Hinzufügen (zweiter Poll oder später), danach alle `FIRMWARE_REFRESH_POLLS` und sofort nach 2.8 bzw. wenn sich die SSID im Gast-`GetInfo` ändert. `image_last_updated` nur setzen, wenn sich die Bytes ändern.
- Entity: `image`, key `guest_wifi_qr`, `DIAGNOSTIC`, **standardmäßig aus**: Das Bild enthält das Passwort, und jeder HA-Benutzer kann es sehen. Nur mit `can_write`, weil `GetSecurityKeys` die Einstellungsrechte braucht [A].
- Test: Bytes bei gleichem Eingang stabil, Wechsel nach neuem Passwort, `nopass` ohne `GetSecurityKeys`.

### 2.10 Firmware installieren (update `INSTALL`)
- Aufruf: `UserInterface1/X_AVM-DE_DoUpdate` → `NewX_AVM-DE_UpdateState` [V SCPD, Core]. Unsere Update-Entity sagt „the box installs it itself“ und hat kein `INSTALL` [V update.py].
- Kosten: 0. `supported_features = INSTALL` nur mit `can_write`. Nach dem Aufruf startet die Box neu; Backoff wie bei 2.1.
- Test: `async_install` ruft die Aktion; ohne Rechte gibt es kein Feature.

### 2.11 Kleinigkeit: `internet_uptime`
Unser `internet_uptime` (DURATION, Sekunden) ändert sich bei jedem Poll, der Recorder schreibt also alle 30 s. Core nimmt einen Zeitstempel. Vorschlag: nicht ändern (es würde die Statistik brechen), aber neu `internet_connected_since` mit `device_class=UPTIME`, aus derselben Uptime ohne Kosten, gerundet wie 2.3. Den alten Sensor standardmäßig aus lassen (ist er schon [V `_measurement`]). Niedrige Priorität.

### 2.12 Portfreigabe-Schalter
- Core [V]: `GetPortMappingNumberOfEntries`/`GetGenericPortMappingEntry` auf dem Standarddienst (`WANPPPConnection1` bzw. `WANIPConnection1`). Nur Einträge mit `NewInternalClient` = Quell-IP von HA. Geschaltet wird mit `AddPortMapping(..., NewEnabled)`. Der Zustand kommt per `async_update` je Schalter (1 Request je Schalter und Poll).
- Unsere Lage:
  - [V Spike `ports.txt`] Auf `WANIPConn1` (IGD) gibt es kein `GetPortMappingNumberOfEntries`, und die Liste ist leer (713 bei Index 0). `portoverview` (Web) zeigt 6 Regeln, davon 4 aktiv. Die IGD-Liste enthält also nur UPnP-Freigaben.
  - `WANPPPConnection1` hat die Port-Aktionen [V SCPD]. **Ob dort die von Hand angelegten Regeln von FRITZ!OS 8.25 stehen, ist ungeprüft [A].** [V Live] Core hat auf dieser Box keinen Portschalter angelegt. Das sagt nichts: Möglicherweise zeigt einfach keine Regel auf HA.
  - Unsere Karte und der WS-Befehl `ports/list` lesen beide Quellen auf Anfrage, nicht im Poll [V websocket_api].
- Entwurf:
  - Schalter nur für **von Hand angelegte** Regeln (`source=manual`). UPnP-Öffnungen setzen die Geräte selbst und mit Lease, ein Schalter dafür wäre sinnlos.
  - **Schreibweg zuerst klären:** entweder (a) TR-064 `WANPPPConnection1/AddPortMapping` mit `NewEnabled`, falls die Liste dort die Handregeln enthält, oder (b) die Anfrage, die das Webinterface beim Umschalten schickt. Für (b) die Anfrage mitschneiden wie bei VPN (`/api/v0/...`) [A].
  - Ohne Schreibweg: **weglassen**.
  - Entity: `switch`, key `port_forward`, `unique_id f"{serial}_port_forward_{family}_{protocol}_{external_port}"`. Die UID `forwNNNN` nicht nehmen, solange ihre Stabilität unklar ist [A]; beim VPN war die Kennung platzabhängig [V models.VpnConnection]. Weitere Angaben:
    - `entity_category=CONFIG`, nur mit `can_write`;
    - **standardmäßig an nur für Regeln, deren Ziel eine eigene IP von HA ist** (`network.async_get_source_ip`, wie Core), sonst aus;
    - Attribute: Gerät, Ports, Bereich, Familie.
  - Entfernen wie bei den Routen: verschwunden in 2 Lesungen hintereinander → Entity weg (`ROUTES_GONE_READS`-Muster).
- Kosten: `portoverview` ist 1 Web-Request; Takt `ROUTES_POLLS` (10), nur im zweiten Poll oder später. **Nur lesen, solange mindestens ein Portschalter aktiv ist**, wie bei 2.6. Die erste Ermittlung einmal im zweiten Poll.
- Lock: Web-Request unter dem Lock (wie VPN); die Seite ist groß [A], also gemessene Dauer in die Diagnose.
- Test: Parser gibt es schon (`tests/fixtures/portoverview.json`); Auswahl der Default-Aktivierung; Entfernen.

### 2.13 SSDP-Discovery
- Core [V]: `manifest.json` `"ssdp": [{"st": "urn:schemas-upnp-org:device:fritzbox:1"}]`. In `async_step_ssdp`:
  - Host aus `ssdp_location`, IPv6-link-local verwerfen;
  - unique_id = UDN ohne `uuid:`;
  - Bestätigungsformular (Benutzer, Passwort, SSL).
  - [V Live] Core-Einträge „FRITZ-RM“ und der Repeater stammen aus `source: ssdp`.
- Bei uns ist `unique_id` = Seriennummer (= MAC ohne Doppelpunkte) [V config_flow]. Ob die UDN der Box auf die MAC endet, ist [A]. Deshalb:
  1. Abbrechen, wenn schon ein Eintrag mit diesem Host besteht (`_async_abort_entries_match({CONF_HOST: host})`).
  2. Mehrfachfluss pro Host verhindern (`async_set_unique_id(f"ssdp_{host}")` vorläufig oder `is_matching`).
  3. Erst nach dem Login die richtige unique_id setzen und `_abort_if_unique_id_configured(updates={CONF_HOST: host})`, damit eine neue IP der Box übernommen wird.
  4. Repeater wie bisher mit `mesh_repeater` ablehnen. Vorab überspringen, wenn `modelName` „Repeater“ enthält [A].
- Kosten: keine an der Box.
- Test: `tests/test_config_flow.py` um ssdp → confirm → create, already_configured, Host-Update und link-local ergänzen.

### 2.14 Optionen
- `consider_home`: vorhanden (180 s, 0–900) [V].
- `old_discovery`: weglassen (PLAN.md, Zeile 97: kein old_discovery). [V Live] Beim Maintainer ist es im Core an. Unser Weg ohne Mesh liest nur die Hostliste, das ist der alte Weg.
- `feature_device_tracking`: Bei uns sind Tracker der Kern. Wer nur Router-Entities will, nimmt den Filter „nur Auswahl“ mit leerer Liste. Ob `select_hosts` das so behandelt, ist [A] → prüfen und dokumentieren statt einer neuen Option.

### 2.15 Diagnose und UPnP-Status
- Core verweigert das Setup, wenn `X_AVM-DE_UPnP1/GetInfo → NewEnable` falsch ist [V Core, SCPD].
  - Wir lesen das Internet über die IGD-Dienste `WANIPConn1`/`WANCommonIFC1` [V api]. Ist „Statusinformationen über UPnP übertragen“ aus, fehlen sie vermutlich [A]. Dann gibt es keine Internet-Karte und keinen Reconnect.
  - Vorschlag: einmal im zweiten Poll `X_AVM-DE_UPnP1/GetInfo` lesen (1 Request einmalig). Bei `NewEnable=False` ein Repair-Hinweis, keine Verweigerung.
- Diagnose ergänzen, ohne Kosten im Poll (nur beim Herunterladen): `list(fc.services)`, Benutzerrechte (`parse_rights`, schon gelesen beim Setup), `UserInterface1/X_AVM-DE_GetInfo` (Firmware-Extras [V SCPD]), CPU-Liste, falls bekannt.

## 3. Nicht übernehmen

| Was | Grund |
|---|---|
| Anrufumleitung (`X_AVM-DE_OnTel1/GetDeflections`, `SetDeflectionEnable` [V SCPD]) | Telefonie bleibt bei `fritzbox_phone` (PLAN.md). [V Live] Core legt hier keine Umleitungsschalter an (Liste leer). |
| Aktion `dial` | Telefonie |
| Buttons `cleanup`, `firmware_update` | im Core deprecated, ersetzt durch Auto-Cleanup bzw. update-Entity |
| `old_discovery` | PLAN.md |
| Core-Durchsatz aus `GetAddonInfos.NewByteSendRate` | unsere Zählerdifferenz ist genauer |
| Reload des Eintrags bei jedem Fehler | Core-Schwäche (PLAN.md) |
| Schalter für UPnP-Portöffnungen | flüchtig, setzt das Gerät selbst |
| Repeater als eigener Eintrag | siehe 4 |

## 4. Offene Grundsatzfrage: Repeater

[V Live] Beim Maintainer läuft Core auch für `fritz-repeater1200ax` mit Neustart, CPU 65 °C, Betriebszeit, 3 WLAN-Schaltern, Gast-QR und Update. Unser Config-Flow lehnt Repeater ab [V `mesh_repeater`], die Repeater erscheinen nur über das Mesh der Box.

Ohne eine eigene Verbindung zum Repeater bleiben Neustart, CPU und Betriebszeit des Repeaters offen. WLAN wird vermutlich vom Master synchronisiert [A].

Optionen:
- (a) Repeater-Einträge zulassen, nur mit Box-Entities (keine Tracker), `M–L`;
- (b) ausdrücklich nicht abdecken, mit README-Hinweis „Core für Repeater behalten“.

Empfehlung: (b) jetzt, (a) erst bei Nachfrage.

## 5. Lese-Spike vor dem Bauen (ein Skript `tools/spike_core_gap.py`, nur Get*)

1. Für jeden `WLANConfigurationN`: `GetInfo` (ohne Schlüssel) und `X_AVM-DE_GetWLANExtInfo` → Fixture `tests/fixtures/wlan_services.json`. Bestätigt 0 und 2.7.
2. `/query.lua?CPUTEMP=cpu:status/StatTemperature` mit unserer Web-Session → Fixture. Bestätigt 2.6 ohne Core.
3. `WANPPPConnection1/GetPortMappingNumberOfEntries` und `GetGenericPortMappingEntry 0..n`: Stehen die Handregeln aus `portoverview` dort? Entscheidet 2.12 (a).
4. `X_AVM-DE_UPnP1/GetInfo`, `WANCommonInterfaceConfig1/GetCommonLinkProperties`.
5. Der SSDP-UDN der Box (HA-Log der ssdp-Integration oder `upnp`-Eintrag): Endet er auf die MAC?

Passwörter und Schlüssel nie ausgeben (`GetSecurityKeys` nicht im Spike).

## 6. Reihenfolge in kleinen Commits

| # | Commit | Aufwand | Kosten pro Poll |
|---|---|---|---|
| 1 | `fix:` Gast-WLAN über `X_AVM-DE_GetWLANExtInfo` finden; Test-Mock an die echte SCPD angleichen | S | 0 (einmalig n) |
| 2 | `chore:` Lese-Spike (5) und Fixtures | S | – |
| 3 | `feat:` Bytes gesendet/empfangen, Leitungsrate auf Nicht-DSL, erreichbare DSL-Rate | S | 0 |
| 4 | `feat:` binary_sensor Leitung (`internet_linked`) | S | 0 |
| 5 | `feat:` Buttons Neustart und Neu verbinden (707, Fallback-Dienst), standardmäßig aus | S | 0 |
| 6 | `feat:` update-Entity installiert Firmware | S | 0 |
| 7 | `feat:` Betriebszeit der Box aus dem Setup-`GetInfo`, stündlich und nach Ausfall neu | S | ≈ 0 |
| 8 | `feat:` CPU-Temperatur über die eigene Web-Session, nur bei aktiver Entity | S–M | 0,1 Web |
| 9 | `feat:` WLAN-Schalter je Band (Ermittlung, Takt 10, Override) | M | ≈ 0,2 |
| 10 | `feat:` Aktion `set_guest_wifi_password` mit Antwort | S | 0 |
| 11 | `feat:` Gast-WLAN-QR als image (segno), standardmäßig aus | M | ≈ 0 |
| 12 | `feat:` SSDP-Discovery | M | 0 |
| 13 | `feat:` Diagnose-Extras, Repair bei UPnP-Status aus | S | 0 (einmalig 1) |
| 14 | `feat:` Portfreigabe-Schalter – nur wenn Spike 3 oder ein Web-Mitschnitt einen Schreibweg zeigt | M–L | 0,1 Web, nur bei aktiven Schaltern |
| 15 | `docs:` README/Guides de+en, Migrationstabelle Core → wir (PLAN.md Teil A) | S | – |

Alle neuen Lesezugriffe stehen im nicht-schlanken Zweig von `_fetch`. Der erste Poll bleibt, wie er ist. Ein Test pro Commit stellt sicher, dass der schlanke Poll die neuen Client-Methoden nicht aufruft.

Teststrategie allgemein:
- `tests/test_api.py`: `MagicMock`-`_fc` nach dem Muster `_guest_client`, aber mit Antworten genau nach SCPD.
- Parser in `test_models.py` mit Spike-Fixtures.
- Entities und Takt über die vorhandene `conftest`-Coordinator-Einrichtung: Zahl der `call_action`-Aufrufe je Poll zählen.
