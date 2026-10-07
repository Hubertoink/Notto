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
2. `Notto container` unter GitHub Actions manuell auf main starten. Er baut ein Image und legt es mit der vollständigen Commit-ID in der privaten Registry ab. Registry-Zugangsdaten sind als Actions-Secrets hinterlegt.
3. `NOTTO_IMAGE` in `.notto-deploy/production.env` auf `p-wqa66m.project.space/notto:<commit>` setzen.
4. `mw stack deploy --stack-id 4ffda78f-d86e-42df-b037-fd189425d44f --compose-file docker-compose.yml --env-file .notto-deploy/production.env -q` ausführen. Keine vollständigen Stack-JSONs in Logs ausgeben: sie enthalten die Server-Secrets.
5. `https://noto-app.de/api/health` prüfen. Windows-Installer separat über den Windows-Workflow erstellen und installieren.

Das Image enthält keine Zugangsdaten. Deployment-Secrets liegen getrennt von Quellcode und Image. Die produktive Veröffentlichung ist bewusst ein eigener Schritt; das Erstellen eines Images aktualisiert den laufenden Dienst nicht.

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
