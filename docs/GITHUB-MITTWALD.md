# GitHub und Mittwald

Repository: https://github.com/Hubertoink/Notto

## Bereits vorbereitet

- `Notto checks`: Tests und Web-Build bei Änderungen auf main und bei Pull Requests auf einem kurzlebigen GitHub-Runner.
- `Windows installer`: unter Actions manuell startbar. Erstellt nach TypeScript- und Rust-Tests einen Windows-Installer als herunterladbares Artefakt. Veröffentlicht noch kein Release und installiert nichts auf deinem PC.
- `Mittwald runner checks`: manuell startbar, sobald der Mittwald-Runner registriert ist. Benötigte Labels: `self-hosted`, `Linux`, `X64`, `notto`. Dieser Workflow akzeptiert ausschließlich main. Ungeprüfte Pull Requests laufen auf GitHub-Runnern.

## Mittwald-Runner verbinden

1. In GitHub im Repository **Settings → Actions → Runners → New self-hosted runner** öffnen und Linux/x64 wählen.
2. In der Mittwald CI Runner Extension **GitHub Actions / Repository** auswählen und den von GitHub angezeigten Registrierungsbefehl dort verwenden. Den kurzlebigen Registrierungstoken nicht ins Repository eintragen.
3. Dem Runner das zusätzliche Label `notto` geben und in GitHub prüfen, dass er „Idle“ ist. Die Runner-Version muss die verwendeten Node-24-Actions unterstützen.
4. Unter **Actions → Mittwald runner checks → Run workflow**, Branch main, einen ersten Prüflauf starten.

Diese Einrichtung bindet einen Runner an; sie stellt noch keinen Notto-Server bereit.

## Eigenes Backend und Container

Version 0.3 enthält das eigene Backend für Login, Synchronisation, Anhänge und serverseitige KI-Jobs. Der Workflow `Notto container` baut ein privates Image. Zielprojekt ist `p-wqa66m`, Domain `noto-app.de`. Betrieb und Deployment stehen in [SELF-HOSTING.md](SELF-HOSTING.md). Die App benötigt Serveradresse und Login.

Die Registry-Zugangsdaten sind als GitHub Actions Secrets eingerichtet. Der Image-Build läuft zunächst auf GitHub, da noch kein Mittwald-Runner an dieses Repository angebunden ist. Der manuelle Mittwald-Prüfworkflow bleibt für dessen Registrierung vorbereitet. Der laufende Notto-Server benötigt seinen eigenen OpenAI-Schlüssel; Build-Jobs benötigen diesen Schlüssel nicht.
