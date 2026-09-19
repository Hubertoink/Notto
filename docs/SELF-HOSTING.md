# Notto auf Mittwald (0.3)

Ziel: **https://noto-app.de** (ein t), Projekt `p-wqa66m` / `77a026ee-99bd-4c29-ab09-47a261d1f3dc`.

## Dienste

- Stack `4ffda78f-d86e-42df-b037-fd189425d44f`: App/API, PostgreSQL und Hintergrundverarbeitung.
- Stack `d68be178-038d-40ff-9773-016376a4f54a`: passwortgeschützte Image-Registry unter `p-wqa66m.project.space`. Die Projektadresse ist deshalb keine zweite Notto-Webadresse.
- `database` und `attachments` sind dauerhafte Volumes. Die Datenbank ist nicht öffentlich erreichbar. HTTP wird durch Mittwald unter der Domain mit HTTPS bereitgestellt.
- Die Webapp und `/api` werden aus demselben Container ausgeliefert. Windows spricht dieselbe API an. Eine Supabase-Installation ist für diesen Betrieb nicht erforderlich. Alte Supabase-Verbindungen bleiben ausschließlich aus Kompatibilitätsgründen lesbar.

## Erster Zugang

Die Registrierung benötigt einen zufälligen, einmal verwendbaren Einrichtungscode und die dafür freigegebene E-Mail-Adresse. Die lokale Datei `.notto-deploy/ERSTER-ZUGANG.txt` enthält die Ersteinrichtung. Sie ist von Git und Docker ausgeschlossen. Passwort selbst über **Einstellungen → Neues Konto erstellen** festlegen (mindestens zwölf Zeichen). Ein verbrauchter Code funktioniert auch nach einem Neustart nicht erneut.

Web-Sitzungen liegen in HttpOnly-/Secure-/SameSite-Cookies. Windows legt sein Sitzungstoken im Windows-Anmeldedatenspeicher ab. Sitzungen laufen nach 30 Tagen ab; Abmelden widerruft die jeweilige Sitzung. Das letzte Benutzerprofil wird lokal für Offline-Zugriff auf bereits gespeicherte Notizen vorgehalten. Bereits synchronisierte Notizen bleiben auf dem Gerät; eine App-Sperre ist nicht enthalten.

## OpenAI

`OPENAI_API_KEY` gehört in die geschützte Serverkonfiguration für **app und worker**, niemals in Git, einen `VITE_*`-Wert oder die Browseroberfläche. Die beim ersten Deployment angelegte `.notto-deploy/production.env` enthält dieses Feld zunächst leer. Dort lokal hinterlegen und den Stack erneut deployen; alternativ beide Dienste in mStudio konfigurieren und die lokale Datei für spätere Deployments konsistent halten. Bitte den Schlüssel nicht im Chat senden.

In Notto anschließend **Wissen & KI → KI einrichten → KI aktivieren**. Die Oberfläche zeigt an, ob der Server einen Schlüssel hat. Analyse und Recherche laufen nach separater Aktivierung auch bei geschlossener App. Der Worker verarbeitet gespeicherte Revisionen, prüft Belege und hält Entscheidungen getrennt. Maximal drei Versuche je Job, fünf Minuten Abstand, begrenzte Laufzeit-Lease zur Wiederaufnahme nach Absturz. Serverseitig maximal 100 API-Anfragen pro Benutzer/UTC-Tag; weitere lokale Limits können früher greifen. Keine Euro-Kostengarantie.

PDF-Text und OCR werden über die bestehenden Anhangfunktionen erzeugt und als separate Erkenntnisse synchronisiert. Der Hintergrundworker verwendet die bereits synchronisierten Extraktionen; nach einer späteren Extraktion eine Analyse bei Bedarf manuell wiederholen. Diktat und interaktive Suche verwenden ebenfalls den serverseitigen OpenAI-Schlüssel bei angemeldetem Konto. Das lokale Offline-Notizbuch kann weiterhin optional einen eigenen Windows-Schlüssel verwenden.

## Aktualisieren

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

`npm test`, `npm run build`, `npm run build:server`, `docker build -t notto:test .`.

Der Backend-Test startet eine isolierte PostgreSQL-kompatible Testdatenbank und prüft Einladungen, Sessions, Kontentrennung, unveränderliche Anhänge, CAS-Konflikte und Hintergrundanalysen mit kontrollierten API-Antworten. Er verwendet keine echten OpenAI-Zugangsdaten.
