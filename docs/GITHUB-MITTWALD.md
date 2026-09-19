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

## Noch umzusetzen: eigenes Backend

Der hochgeladene Stand 0.2 enthält weiterhin die bisherige Supabase-Anbindung. Für den vereinbarten Mittwald-Betrieb folgen ein eigenes Backend für Login und konfliktbewusste Synchronisation, PostgreSQL, persistenter Anhangspeicher, serverseitige KI-Jobs sowie Container- und Deployment-Konfiguration. Die normale App-Oberfläche soll anschließend nur Serveradresse und Login benötigen.

Für das Deployment werden das konkrete Mittwald-Projekt und eine Ziel-Domain benötigt. API- und Deployment-Schlüssel gehören in Server-Secrets bzw. GitHub Actions Secrets. Den OpenAI-Schlüssel benötigt später ausschließlich der laufende Notto-Server. Ob der Mittwald-Runner selbst Images bauen kann, muss am installierten Runner geprüft werden; alternativ übernimmt ein GitHub-Runner den Image-Build.
