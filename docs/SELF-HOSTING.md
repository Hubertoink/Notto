# Noto auf Mittwald (0.4.2)

## Tastenkürzel

Im Randwidget zeigt **Neue Notiz** das tatsächlich registrierte globale Kürzel an. Standard ab 0.4.2: **Strg + Alt + Umschalt + N**. Die zusätzliche Modifikatortaste reduziert Überschneidungen mit üblichen lokalen Editor-Kürzeln. Es funktioniert auch aus anderen Programmen und bei ausgeblendetem Widget, solange Noto im Windows-Infobereich läuft. Vollständiges Beenden oder Abmelden bei Windows beendet auch die Tastenkürzelregistrierung.

Unter **Einstellungen → Tastenkürzel & Randwidget** sind zwei Alternativen wählbar. Noto registriert zuerst die neue Kombination und gibt erst danach die bisherige frei. Ein Konflikt wird angezeigt, ohne das bisherige Kürzel zu verlieren. Die erfolgreiche Auswahl wird lokal gespeichert und beim nächsten Start erneut registriert. Andere Programme können Tastendrücke zusätzlich über eigene Hooks behandeln; eine universelle Konfliktfreiheit kann Windows nicht garantieren. Grundlage ist die [globale Tastenkürzelregistrierung von Tauri](https://v2.tauri.app/plugin/global-shortcut/).

Im Windows-Hauptfenster gilt zusätzlich **Strg + N**; im aktiven Website-Tab **Strg + Umschalt + Leertaste** (␣ im Button). Browserkürzel wie Strg + N und Strg + Umschalt + N bleiben frei. Wiederholte Tastendrücke, Texteingabe-Komposition und zusätzliche Modifikatortasten lösen keine lokale neue Notiz aus. Bei geöffneten Dialogen werden die lokalen Navigationskürzel nicht abgefangen.

**Wissen & KI** ist ein eigener Bereich in der Hauptnavigation unter **Angeheftet**. Unter **KI einrichten** werden Änderungen zunächst als Entwurf gehalten. **Einstellungen speichern** wartet auf die Serverbestätigung; erst dann werden Änderungen im Konto und lokal aktiv. Bei einem Fehler bleiben die Eingaben für einen erneuten Versuch erhalten. Beim Wechsel zwischen Notizen und KI-Bereich bleiben ungespeicherte Einstellungen in der geöffneten App erhalten.

Ziel: **https://noto-app.de** (ein t), Projekt `p-wqa66m` / `77a026ee-99bd-4c29-ab09-47a261d1f3dc`.

## Dienste

- Stack `4ffda78f-d86e-42df-b037-fd189425d44f`: App/API, PostgreSQL und Hintergrundverarbeitung.
- Stack `d68be178-038d-40ff-9773-016376a4f54a`: passwortgeschützte Image-Registry unter `p-wqa66m.project.space`. Die Projektadresse ist deshalb keine zweite Notto-Webadresse.
- `database` und `attachments` sind dauerhafte Volumes. Die Datenbank ist nicht öffentlich erreichbar. HTTP wird durch Mittwald unter der Domain mit HTTPS bereitgestellt.
- **App und Worker benötigen dasselbe Volume `attachments:/data/attachments`** und denselben `DATA_DIR`. Der Worker liest Anhänge für die KI und speichert importierte Artikel; beide Dienste benötigen Schreibzugriff. Ab 1.5.8 nimmt er beim Start daran gescheiterte Analysen wieder auf, sobald die Dateien lesbar sind und die aktuelle Notiz weiterhin für automatische KI-Prüfungen freigegeben ist.
- Die Webapp und `/api` werden aus demselben Container ausgeliefert. Windows spricht dieselbe API an. Eine Supabase-Installation ist für diesen Betrieb nicht erforderlich. Alte Supabase-Verbindungen bleiben ausschließlich aus Kompatibilitätsgründen lesbar.

## Erster Zugang

Die Website zeigt ohne Anmeldung den Login. Über **Konto einrichten** lassen sich E-Mail, Passwort (mindestens zwölf Zeichen), Passwortbestätigung und Einladung eingeben. Die Registrierung benötigt einen zufälligen, einmal verwendbaren Einrichtungscode und die dafür freigegebene E-Mail-Adresse. Die lokale Datei `.notto-deploy/ERSTER-ZUGANG.txt` enthält die Ersteinrichtung. Sie ist von Git und Docker ausgeschlossen. Ein verbrauchter Code funktioniert auch nach einem Neustart nicht erneut. In Windows bleibt lokales Arbeiten möglich; die Anmeldung befindet sich unter **Einstellungen → Konto & Synchronisation**. Vorhandene lokale Notizen werden über **Lokale Notizen ins Konto kopieren** übernommen. Neue Konto-Notizen synchronisieren sich automatisch.

Web-Sitzungen liegen in HttpOnly-/Secure-/SameSite-Cookies. Windows legt sein Sitzungstoken im Windows-Anmeldedatenspeicher ab. Sitzungen laufen nach 30 Tagen ab; Abmelden widerruft die jeweilige Sitzung. Das letzte Benutzerprofil wird lokal für Offline-Zugriff auf bereits gespeicherte Notizen vorgehalten. Bereits synchronisierte Notizen bleiben auf dem Gerät; eine App-Sperre ist nicht enthalten.

## OpenAI

Automatische Analysen vergleichen den Inhalt unabhängig von Überschriftenformatierung, Fett/Kursiv, Leerzeilen und weichen Zeilenumbrüchen. Eine bestehende URL als benannten Markdown-Link zu formatieren löst keine neue Analyse aus. Bereits passende Anmerkungen und Rechercheaufträge werden weiterverwendet; dieser Vergleich benötigt keinen KI-Aufruf. Änderungen an Wörtern, Zahlen, Linkzielen, Anhängen, Checkbox-Status, Durchstreichungen und Code bleiben relevant. Die Reihenfolge von Aussagen bleibt relevant; eine allgemeine semantische Prüfung von Umformulierungen ist nicht enthalten. Manuelles erneutes Analysieren bleibt möglich. Originaltexte und Versionshistorie werden unverändert gespeichert.

Automatische Webrecherche erhält zusätzlich bis zu zehn eindeutige URLs aus der Notiz, auch wenn der Analysevorschlag den Link nicht zitiert. Das ist Recherchekontext, keine garantierte vollständige Auslesung jeder URL. Ein KI-Auftrag kann bis zu drei verlinkte Webseiten untersuchen. YouTube-Videolinks werden im Serverbetrieb gesondert als Untertitelquelle gelesen, auch in der automatischen Hintergrundrecherche. Unterstützt sind watch-, youtu.be-, Shorts-, Live- und Embed-Links. Deutsch wird bevorzugt, danach Englisch und die übrigen verfügbaren Sprachen; bei gleicher Sprachpräferenz haben bereitgestellte Untertitel Vorrang vor automatischen. Automatische Untertitel sind gekennzeichnet und können Erkennungsfehler enthalten.

Beispiel: YouTube-Link in die Notiz einfügen und über **+ neben „Aufträge“** **Fasse dieses Video zusammen** starten. Die Antwort zeigt eingelesene Transkripte mit Sprache, wörtliche Belegstellen und Links zur passenden Videosekunde. Die Zeitmarken werden aus den geladenen Untertiteln ermittelt. „In Notiz übernehmen“ erhält die Belege und Zeitlinks. Webzugriff muss freigegeben sein; Änderungen der Freigabe oder des Notizinhalts während des Auftrags verhindern die Übernahme.

Die Tabelle `youtube_transcript_cache` wird beim Serverstart angelegt und speichert Untertitel pro Konto und Video sieben Tage lang. Unterschiedliche URL-Formate desselben Videos verwenden denselben Cache; vorübergehende Fehler werden eine Minute gespeichert. Es werden keine Video- oder Audiodateien heruntergeladen und keine zusätzlichen API-Schlüssel benötigt. Untertitel kommen über den öffentlichen YouTube-Abruf mit `youtube-transcript-plus`; YouTube kann diesen Zugriff insbesondere von Hosting-Servern aus blockieren oder sein Format ändern. Private, gesperrte oder untertitellose Videos ergeben einen sichtbaren Hinweis, keine erfundene Zusammenfassung. Eine Umgehung von Anmelde- oder Zugriffssperren ist nicht enthalten.

Grenzen: höchstens drei Videos pro Auftrag beziehungsweise Hintergrundrecherche, 45 Sekunden Abrufzeit je Video, höchstens 12.000 Untertitelabschnitte und 300.000 Textzeichen im Cache. Ein KI-Auftrag verteilt höchstens 48.000 Zeichen mit Zeitmarken gleichmäßig auf die ausgewählten Videos (ein Video: 48.000; drei Videos: je 16.000), die Hintergrundrecherche verwendet 5.000 pro Video. Ein ausdrücklich auf das Video bezogener Auftrag wertet keine zusätzlich angehängten PDFs aus; ausdrücklich angeforderte Dokumente bleiben berücksichtigt. Bei längeren Transkripten wird ausdrücklich nur der Anfang ausgewertet und das Ergebnis als Ausschnitt bzw. Teilergebnis gekennzeichnet. Eine vollständige abschnittsweise Auswertung langer Videos sowie eine Übernahme des gesamten Transkripts als Bibliotheksdokument sind noch nicht enthalten. Lokale Notizbücher ohne Noto-Server haben keinen Transkriptabruf.

Ab Version 1.5.3 dürfen ausdrücklich gestartete KI-Aufträge standardmäßig bei Bedarf im Web recherchieren. Unter **Wissen & KI → KI einrichten → Webrecherche bei KI-Aufträgen zulassen** lässt sich das für das gesamte Notizbuch ausschalten. Im **KI-Kontext** einer einzelnen Notiz kann Webrecherche zusätzlich gezielt ausgeschaltet werden. Bestehende Notizen übernehmen die globale Voreinstellung; die alte automatische Vorgabe „Web aus“ muss nicht einzeln korrigiert werden. Automatische Hintergrundrecherche hat weiterhin ihre eigene Einstellung. Reine Zusammenfassungen und ausdrücklich auf vorhandene Quellen begrenzte Aufträge suchen nicht zusätzlich im Web.

`OPENAI_API_KEY` gehört in die geschützte Serverkonfiguration für **app und worker**, niemals in Git, einen `VITE_*`-Wert oder die Browseroberfläche. Die beim ersten Deployment angelegte `.notto-deploy/production.env` enthält dieses Feld zunächst leer. Dort lokal hinterlegen und den Stack erneut deployen; alternativ beide Dienste in mStudio konfigurieren und die lokale Datei für spätere Deployments konsistent halten. Bitte den Schlüssel nicht im Chat senden.

In Notto anschließend **Wissen & KI → KI einrichten → KI aktivieren**. Die Oberfläche zeigt an, ob der Server einen Schlüssel hat. Analyse und Recherche laufen nach separater Aktivierung auch bei geschlossener App. Der Worker verarbeitet gespeicherte Revisionen, prüft Belege und hält Entscheidungen getrennt. Maximal drei Versuche je Job, fünf Minuten Abstand, begrenzte Laufzeit-Lease zur Wiederaufnahme nach Absturz. Serverseitig maximal 100 API-Anfragen pro Benutzer/UTC-Tag; weitere lokale Limits können früher greifen. Keine Euro-Kostengarantie.

PDF-Text und OCR werden über die bestehenden Anhangfunktionen erzeugt und als separate Erkenntnisse synchronisiert. Der Hintergrundworker verwendet passende synchronisierte Extraktionen oder liest den Text direkt aus dem gemeinsamen Anhangspeicher; nach einer späteren OCR-Extraktion eine Analyse bei Bedarf manuell wiederholen. Diktat und interaktive Suche verwenden ebenfalls den serverseitigen OpenAI-Schlüssel bei angemeldetem Konto. Das lokale Offline-Notizbuch kann weiterhin optional einen eigenen Windows-Schlüssel verwenden.

Die Dokumentaufbereitung verwendet zusätzlich die automatisch angelegte Tabelle `document_context_cache`. Sie hält pro Konto und Anhang Textabschnitte sowie eine Übersicht aus unveränderten Originalauszügen. Ein SHA-256-Fingerabdruck über Seiteninhalt und Verarbeitungsversion verhindert die Wiederverwendung veralteter Aufbereitung; Notizänderungen allein erfordern keine neue Dokumentaufbereitung. Der Cache ist abgeleitet und kann neu aufgebaut werden. Die Quellenauswahl erfolgt erst nach den bestehenden Freigabeprüfungen. Gewöhnliche Analysen verwenden höchstens 48.000 Zeichen serialisierten Quellenkontext; Anweisungen und Antwort haben zusätzlichen Platz. Vollständige Dokumentaufträge lesen alle lesbaren Abschnitte in mehreren Anfragen und prüfen deren Zitate vor der Zusammenführung. Die vorhandenen Grenzen von 12 MB und 100 PDF-Seiten sowie das Auftragszeitlimit bleiben bestehen. Beim Start werden alte, am 60.000-Zeichen-Limit gescheiterte automatische Analysen erneut vorgemerkt; der Worker prüft weiterhin aktuelle Version und Freigabe.

## Aktualisieren

### Updates mit `latest` in mStudio

Der GitHub-Workflow **Notto container** veröffentlicht nach erfolgreichen Tests dasselbe Image unter der vollständigen Commit-ID und unter `p-wqa66m.project.space/notto:latest`. `latest` bezeichnet den zuletzt erfolgreich veröffentlichten Container-Build von `main`; der Workflow wird weiterhin manuell gestartet.

In mStudio im **App-Stack** einmalig bei **app und worker** das Image auf `p-wqa66m.project.space/notto:latest` setzen. Für jedes weitere Update nach Abschluss des GitHub-Workflows das Image erneut pullen und beide Container neu erstellen (Recreate). Ein Neustart allein garantiert nicht, dass ein neues Image geladen wird. Die Registry selbst und die Datenbank bleiben unverändert; Umgebungsvariablen, Ports und Volumes beibehalten.

`latest` aktualisiert laufende Container nicht automatisch. Für eine Rückkehr zu einer älteren Version bei beiden Diensten den vollständigen Commit-Tag der gewünschten Version einsetzen, pullen und neu erstellen. Nach jedem Update `https://noto-app.de/api/health` und die Weboberfläche prüfen.

Wenn Zugangsdaten in mStudio geändert wurden, für reine Code-Updates **nur die Images aktualisieren**, damit die aktuelle Serverkonfiguration erhalten bleibt:

```sh
mw container update 9fc73c6f-9cda-4547-8f05-eb47ece01dbb -p p-wqa66m --image p-wqa66m.project.space/notto:<commit> --recreate -q
mw container update 815c2e94-2fdf-431c-ae7c-6feb74988d79 -p p-wqa66m --image p-wqa66m.project.space/notto:<commit> --recreate -q
```

Ein vollständiges Compose-Deployment erfordert eine aktuelle lokale Secret-Datei; ein dort leerer OpenAI-Wert würde einen im Container gesetzten Schlüssel überschreiben.

1. Codeänderungen prüfen und nach GitHub pushen. `Notto checks` führt Tests, Web- und Server-Build aus.
2. `Notto container` unter GitHub Actions manuell auf main starten und **deploy** aktiviert lassen. Er baut das Image mit Commit-Tag, aktualisiert App und Worker, prüft `/api/health` auf die neue Paketversion, bereinigt die Registry und veröffentlicht neue Speichermesswerte. Benötigt neben Registry-Secrets das verschlüsselte Repository-Secret `MITTWALD_API_TOKEN` mit Rechten für das Noto-Projekt, Containerverwaltung und SSH-Schlüssel des Benutzers.
3. Die Workflow-Run-Seite auf erfolgreichen Abschluss prüfen. Windows-/Linux-Installer separat über den Desktop-Workflow erstellen.

**Nur bauen:** `deploy` abwählen. Dann werden keine laufenden Container geändert und keine alten Images entfernt. Häufige reine Builds können weiterhin Registry-Speicher belegen.

**Manuelle Alternative:** `scripts/deploy-mittwald.mjs` mit `MITTWALD_API_TOKEN`, `MITTWALD_PROJECT_ID=p-wqa66m` und `NOTTO_IMAGE=p-wqa66m.project.space/notto:<commit>` aufrufen. Der Quellstand und seine Paketversion müssen zum Image passen. Das Skript erhält bestehende Container-Secrets und Volumes; es ersetzt ausschließlich die Images. Es führt denselben Ablauf einschließlich Bereinigung und Hosting-Bericht aus. Ein vollständiges `mw stack deploy` ist nur für Infrastrukturänderungen erforderlich und benötigt eine aktuelle Secret-Datei. Vollständige Stack-/Container-JSONs enthalten Secrets und gehören nicht in Logs.

Das Image enthält keine Zugangsdaten. Deployment-Secrets liegen getrennt von Quellcode und Image. Jeder Deployment-Lauf registriert einen eigenen temporären SSH-Schlüssel mit einer Stunde Ablaufzeit und widerruft ihn im Abschlussblock. Bei einem harten Abbruch greift spätestens das Ablaufdatum. Der Workflow serialisiert Build, Deployment und Registry-Wartung mit derselben Concurrency-Gruppe. Keine parallelen manuellen Builds oder Registry-Schreibzugriffe starten.

## Speicherplatz und Registry-Wartung

**Einstellungen → Speicherplatz** ist im Web und im Desktop verfügbar. Die API `GET /api/storage` zählt ausschließlich das angemeldete Konto: JSON-Nutzdaten, Originalanhänge, Wissen, KI-Aufträge, Ergebnisbilder und die beiden wiederherstellbaren Server-Caches. Die Summe ist kein physischer Hosting-Verbrauch und enthält insbesondere keine Registry, Backups, Datenbankindizes oder WAL-Dateien. Papierkorb und Historie sind enthalten; die Historie ist zusätzlich als Teilmenge ausgewiesen. Lokaler Web-Speicher wird, falls unterstützt, separat geschätzt; native Desktop-Dateien sind nicht darin enthalten.

`PUT /api/storage/cache` mit `{"confirm":true}` löscht transaktional nur Dokument-Kontext und YouTube-Transkripte dieses Kontos. Erneute Nutzung erstellt diese Daten neu. Es werden weder Wissenseinträge noch synchronisierte Originale entfernt; Offline-Geräte können daher keine gelöschten Originale unbeabsichtigt zurückkopieren. PostgreSQL verwendet freigewordene Tabellenplätze erneut, ohne seine Dateien sofort zu verkleinern. Kein `VACUUM FULL` im laufenden Betrieb ausführen. Die tägliche Serverwartung entfernt zusätzlich abgelaufene Transkripte.

### Hosting-Bericht

Mit Mittwald-CLI-Zugang und einem bereits registrierten SSH-Schlüssel:

```sh
export MITTWALD_API_TOKEN="$(cat ~/.config/mw/token)"
export MITTWALD_PROJECT_ID=p-wqa66m
export MITTWALD_SSH_IDENTITY_FILE=/absoluter/pfad/zum/ssh-key
node scripts/mittwald-storage-report.mjs
node scripts/mittwald-storage-report.mjs --publish-report
```

Der erste Aufruf misst ausschließlich. Der zweite veröffentlicht zusätzlich einen Bericht im gemeinsamen Attachment-Volume (`.hosting-storage.json`), ohne Zugangsdaten zu speichern. Die Betreiberansicht ist nur für `SETUP_EMAIL` sichtbar. Der Zeitstempel bleibt sichtbar: „Speicher aktualisieren“ lädt den letzten Bericht, misst aber nicht selbst beim Hoster. Die gemessenen Verzeichnisse sind die Standardpfade dieses Deployments. Backups, Images auf Mittwald-Hosts und sonstige Projektdateien sind keine vollständige Teilmenge dieses Berichts; die Werte nicht mit Kontodaten addieren.

### Alte Images begrenzen

Jeder Container-Build veröffentlicht einen unveränderlichen Commit-Tag. Ohne Wartung wachsen Registry-Blobs unbegrenzt, auch bei wenigen Notizen. **Ab 1.5.19 erledigt ein erfolgreiches Deployment über `Notto container` die folgenden Wartungsschritte automatisch.** Die Aufbewahrungsregel ist: neuestes Image, laufende/vorgemerkte Images und deren OCI-Untermanifeste. Keine zusätzlichen alten Versionen. `latest` und der Commit-Tag können dasselbe Image ohne doppelte Layers bezeichnen.

Die Wartung betrifft ausschließlich die Registry, nicht Notizen, PDFs, Datenbank oder den Papierkorb. Eine frühere Softwareversion muss nach der Bereinigung bei Bedarf neu gebaut werden. Die Anzahl benötigter Images kann während eines Updates vorübergehend größer als eins sein.

Ab 1.5.18 installiert das Image ausschließlich Chromium Headless Shell. Das spart rund 389 MiB gegenüber der zusätzlichen vollständigen Chromium-Installation. Screenshot- und PDF-Smoke-Tests laufen bereits beim Image-Build. Alte Image-Layers werden dadurch nicht automatisch entfernt.

1. Builds und Deployments für die Wartung pausieren. Aktuelle **und bereits vorgemerkte** App-/Worker-Images über `mw container list -p p-wqa66m -o json` maschinell auslesen; vollständige Ausgaben enthalten Secrets und gehören nicht in Logs. Alle benötigten `imageDigest`-Werte schützen. Falls ein ImageDigest fehlt oder ein Deployment läuft: abbrechen.
2. `REGISTRY_URL=https://p-wqa66m.project.space`, `REGISTRY_USER`, `REGISTRY_PASSWORD` und `REGISTRY_DEPLOYED_DIGESTS` (kommaseparierte SHA256-Digests) ausschließlich als Umgebungsvariablen bereitstellen.
3. `node scripts/registry-retention.mjs` erstellt zunächst nur einen Plan. Er schützt die angegebenen laufenden Images samt übergeordneten Tags, `latest` sowie rekursiv deren OCI-Manifeste einschließlich Provenance-Daten. Keine zusätzlichen Rückfallversionen werden aufbewahrt.
4. Plan prüfen, dann `node scripts/registry-retention.mjs --apply`. Dies entfernt ausschließlich nicht geschützte Manifeste aus dem Repository `notto`. Noch kein Plattenplatz wird freigegeben.
5. Registry stoppen: `mw container stop c-etyefv -p p-wqa66m -q`. **App, Worker und Datenbank nicht stoppen.** Keine Garbage-Collection parallel zu Registry-Schreibzugriffen!
6. Im Registry-Stack einen temporären Container mit demselben Registry-Image und demselben Volume starten:

   ```sh
   mw container run -p p-wqa66m \
     --stack-id d68be178-038d-40ff-9773-016376a4f54a \
     --name registry-gc --volume registry-data:/var/lib/registry \
     --entrypoint /bin/registry mittwald/registry:3 \
     garbage-collect --quiet /etc/distribution/config.yml
   ```

   Die zurückgegebene Container-ID notieren und Status/Logs prüfen. Erfolgreicher Abschluss muss Exitcode 0 haben (Mittwald kann einmalige beendete Container trotzdem als „error“ anzeigen). **Kein `--delete-untagged`**: OCI-Untermanifeste können trotz fehlendem eigenem Tag benötigt werden.
7. Nur den temporären Container mit seiner konkreten ID entfernen; Registry wieder starten. Auch bei Wartungsfehlern den Collector zuerst sicher stoppen/entfernen und dann die Registry wieder starten. Ist nicht sicher, ob der Collector noch schreibt, Registry ausgeschaltet lassen und die Wartung im mStudio prüfen; niemals gleichzeitige Schreibzugriffe riskieren. `latest`, laufende Digests und deren Blobs mit den passenden OCI-/Docker-Accept-Headern prüfen, anschließend `/api/health` und die echten Verzeichnisgrößen kontrollieren.
8. Den Hosting-Bericht neu veröffentlichen. Mittwald kann bis zu einer Stunde benötigen, um seine eigene Anzeige nachzuführen.

Es gibt **keinen zeitgesteuerten Löschjob**: Bereinigt wird nach erfolgreichen Deployments im beschriebenen Workflow. Andere Deployment-Wege und reine Builds lösen das nicht aus. Bei einem Wartungsfehler schlägt der Actions-Lauf sichtbar fehl; ein erfolgreiches App-Update wird nicht als erfolgreiche Speicherbereinigung ausgegeben. Zugangsdaten oder Docker-/Mittwald-Verwaltungsrechte werden bewusst nicht an die normale App-Oberfläche weitergegeben.

## Backups und Grenzen

Vor größeren Änderungen einen konsistenten PostgreSQL-Dump (`pg_dump -Fc`) sowie das Attachment-Volume sichern; beides zusammen außerhalb des Projekts aufbewahren. Mittwald-Volume-Snapshots ersetzen keinen überprüften Datenbank-Dump. Für persönliche Sicherungen bleibt der Notto-ZIP-Export verfügbar. Automatisierte Offsite-Backups und ein Wiederherstellungstest müssen für den Dauerbetrieb zusätzlich eingerichtet werden.

Passwortzurücksetzung per E-Mail und eine Verwaltung weiterer Einladungen in der Oberfläche sind noch nicht enthalten. Weitere Konten erfordern einen serverseitig angelegten Einladungsdatensatz. SMTP ist nicht eingerichtet. Die bestehende Versions- und Konfliktlogik bleibt erhalten; eine automatische Übernahme eines früheren Supabase-Kontos ist nicht enthalten. Lokale Notizen können nach Anmeldung explizit ins neue Konto kopiert werden.

## Lokal prüfen

Ab 1.5.4 kann der Server öffentlich verfügbare Rechercheartikel als PDF in die Dokumentbibliothek importieren. Der Button benötigt keinen OpenAI-Schlüssel; der ausdrückliche KI-Importauftrag nutzt den vorhandenen Schlüssel und das gewählte Modell zur Quellenauswahl. Der bestehende Chromium-Browser im Docker-Image löst Artikelseiten und öffentliche Weiterleitungen auf. PDFs werden mit geprüften öffentlichen Zieladressen heruntergeladen (höchstens 12 MB und 100 Seiten), seitenweise gelesen und im bestehenden Attachment-Volume gespeichert. Es ist kein zusätzlicher Dienst oder Datenbankschemawechsel erforderlich.

Ab 1.5.10 prüft Noto sichtbare Recherchequellen vorab auf ein öffentlich abrufbares PDF. Diese Prüfung benötigt keine OpenAI-Anfrage. Die Ergebnisse werden 15 Minuten zwischengespeichert; vorübergehende Fehler nur 30 Sekunden. Zwei Quellen können gleichzeitig geprüft werden. Geschlossene Quellenlisten lösen keine Prüfung aus. Nicht verfügbare PDFs bleiben als Webquelle erhalten und können gezielt erneut geprüft werden. Der tatsächliche Download prüft die Datei nochmals; es entstehen keine leeren Dokumenteinträge, wenn die Quelle nicht importierbar ist.

Seit 0.4 lädt die Modellauswahl die [OpenAI-Modellliste](https://developers.openai.com/api/reference/resources/models/methods/list) nach Anmeldung serverseitig. Die Liste wird fünf Minuten gecacht. Da die API keine Funktionsmerkmale liefert, filtert Noto auf unterstützte allgemeine GPT-Analysefamilien; Audio-, Realtime-, Bild-, Codex- und reine Suchmodelle werden ausgeblendet. Modellverfügbarkeit garantiert keine Berechtigung für jedes einzelne Tool. `OPENAI_MODELS` kann als optionale kommaseparierte Einschränkung gesetzt werden (dann auch `text-embedding-3-small` für die Suche aufnehmen). Ohne diese Einstellung werden die verfügbaren Modelle automatisch geprüft. Lokale Windows-Notizbücher können die Liste mit ihrem eigenen Schlüssel aus dem Anmeldedatenspeicher laden.

Der sichtbare Produktname und die Icons heißen Noto. Speicher-, Sitzungs- und Exportformatkennungen bleiben für bestehende Daten kompatibel.

`npm test`, `npm run build`, `npm run build:server`, `docker build -t notto:test .`.

Der Backend-Test startet eine isolierte PostgreSQL-kompatible Testdatenbank und prüft Einladungen, Sessions, Kontentrennung, unveränderliche Anhänge, CAS-Konflikte und Hintergrundanalysen mit kontrollierten API-Antworten. Er verwendet keine echten OpenAI-Zugangsdaten.
