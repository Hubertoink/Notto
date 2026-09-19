# Noto

**Aktueller Betrieb (0.4): [noto-app.de](https://noto-app.de), eigenes Docker-Backend auf Mittwald.** Die Website beginnt mit Login und Kontoeinrichtung. Windows erlaubt weiterhin lokale Notizen und Konto-Synchronisation. Das eigene Logo und die automatische OpenAI-Modellauswahl sind integriert. Supabase wird für diesen Betrieb nicht benötigt. Einrichtung, Einladungen, OpenAI-Schlüssel und Updates: [SELF-HOSTING.md](docs/SELF-HOSTING.md).

Eine lokale Windows-Notizapp mit andockbarem Randwidget und derselben Oberfläche im Browser. React 19, Astryx, Motion und Tauri 2. Version 0.2 ergänzt PDF-Anhänge, eine getrennte Wissensebene mit KI-Vorschlägen, Recherche, Diktat, Texterkennung und belegte Notizbuchantworten. Einrichtung und Funktionsgrenzen stehen in [docs/AI-SETUP.md](docs/AI-SETUP.md).

## Starten

Der Windows-Installer wird unter `src-tauri/target/release/bundle/nsis/` erzeugt. Die ausführbare App liegt unter `src-tauri/target/release/notto.exe`.

```sh
npm ci
npm run dev             # Browser: http://127.0.0.1:1420
npm run desktop         # Windows-App im Entwicklungsmodus
npm run desktop:build   # Windows-App und Installer
npm test
```

`npm run desktop` startet seinen eigenen Vite-Server; vorher einen separat gestarteten `npm run dev` beenden. Für Windows-Builds werden Rust (MSVC), die Visual Studio C++ Build Tools und WebView2 benötigt. Das Desktop-Skript ergänzt den üblichen Rust-Pfad selbst.

## Kleine Fenster und gemeinsame Suche (0.8)

Die Seitenleiste und Notizbereiche scrollen unabhängig innerhalb der Fensterhöhe. Suchvorschauen sind auf zwei Zeilen und 220 Zeichen begrenzt; Markdown-Linkziele werden nicht ausgeschrieben.

Strg + K bietet neben direkten Wort- und Hashtagtreffern „Sinngemäß suchen“. Diese Aktion verwendet die vorhandene Embedding-Suche und benötigt eine aktivierte KI-Verbindung. Der erste Durchlauf erstellt fehlende Textvektoren; weitere Suchen verwenden den Cache. Ausgeschlossene Notizen werden nicht an die KI übergeben. Normale Treffer bleiben bei einem KI-Fehler verfügbar. Notizbuchfragen sind weiterhin unter „Wissen & KI“ erreichbar. Automatische Anzeigetitel und projektübergreifende Zuordnungen sind noch nicht implementiert.

## Themen und Anmerkungen (0.7)

Die Themenansicht zeigt eigene Hashtags und ergänzende KI-Zuordnungen ohne Bestätigungsworkflow. Vorschläge, die lediglich einen bereits gesetzten Hashtag wiederholen, werden dort nicht doppelt angezeigt. Anhänge zeigen ihren Titel beziehungsweise Dateinamen.

Das Anmerkungsfeld erweitert den KI-Button mit einer Morph-Animation und schließt über das X. „Aktualisieren“ analysiert die gespeicherte Fassung erneut; noch offene Textänderungen müssen zuerst gespeichert werden. Bei einem Fehler bleiben die bisherigen Anmerkungen erhalten.

## Suche, Quellen und Darstellung (0.6)

Strg + K öffnet die schwebende Notizsuche mit einer Morph-Animation. Sie durchsucht aktive und archivierte Notizen; der Papierkorb bleibt ausgeschlossen. Enter öffnet den ersten Treffer, Esc schließt die Suche. Die obere Navigationsleiste und dekorative Notizüberschriften entfallen. Die dunkle Palette orientiert sich an [Omarchy Kanagawa](https://github.com/basecamp/omarchy/blob/master/themes/kanagawa/colors.toml); das helle Farbschema bleibt erhalten.

Quellenlinks werden dedupliziert und unter Windows über den Standardbrowser geöffnet. Noto recherchiert, fasst zusammen, verknüpft Wissen und schlägt Aufgaben für den Nutzer vor. Die KI führt keine Kontoaktionen, Käufe oder Installationen aus und fragt nicht nach Zugangsdaten dafür. Die Rollenbeschreibung gilt für neue Analysen und Recherchen; bestehende Texte können unter „Wissen & KI“ neu recherchiert werden.

## Aufgaben und Anmerkungen (0.5)

„KI-Anmerkungen“ unter dem Notiztitel klappt Vorschläge und Recherchen direkt in der Notiz auf. Die Originaldatei wird dabei nicht verändert; ältere Analysen sind als solche gekennzeichnet.

„Aufgaben“ in der Seitenleiste zeigt offene Aufgaben mit Checkboxen. Ein Klick auf den Bereich öffnet die vollständige Liste einschließlich erledigter Aufgaben und das Eingabefeld für eigene Aufgaben. Das Funkeln-Icon kennzeichnet KI-Vorschläge. Abhaken und Wiederöffnen werden lokal gespeichert und im angemeldeten Konto über die Wissens-Synchronisation zwischen Geräten übertragen. Bestätigte und erledigte KI-Aufgaben bleiben auch bei einer erneuten Analyse erhalten. Aufgaben aus gelöschten Notizen erscheinen erst nach deren Wiederherstellung wieder.

## Bedienung

- **Strg + Alt + Umschalt + N:** globale Schnellnotiz über das Randwidget (Standard ab 0.4.2, solange Noto läuft). Unter Einstellungen → Tastenkürzel & Randwidget änderbar; der Button zeigt die aktive Kombination.
- **Strg + N:** neue Notiz im Windows-Hauptfenster. Im aktiven Website-Tab: **Strg + Umschalt + Leertaste**.
- **Strg + K:** Suche fokussieren.
- **Strg + Enter:** Notiz speichern.
- **Escape:** Randwidget einklappen; der Entwurf bleibt erhalten.
- Widget am Griff verschieben. Nach dem Loslassen dockt es links oder rechts am aktuellen Monitor an. Der Arbeitsbereich berücksichtigt Taskleiste und Skalierung.
- Ein Klick hält die Hover-Vorschau offen. Während der Eingabe schließt sie sich nicht beim Verlassen mit der Maus.
- Das Hauptfenster schließt in den Tray. Über das Tray-Menü lässt sich Notto vollständig beenden oder das Widget ausblenden.
- Bilder und PDFs über die Anhangschaltfläche oder Drag-and-drop hinzufügen. Bilder können auch aus der Zwischenablage eingefügt werden. Unterstützt: PNG, JPEG, WebP, GIF, AVIF und PDF bis 12 MB je Datei. PDF-Links öffnen eine Vorschau.
- „Wissen & KI“ enthält Aufgaben, Kontakte, Themen, Recherche, semantische Suche und Notizbuchfragen. Über das Mikrofon im Editor lässt sich diktieren. Diese Funktionen benötigen eine eigene KI-Verbindung; lokale PDF-Textextraktion funktioniert ohne API-Schlüssel.
- Suche kombiniert Wörter, `"exakte Wortgruppen"` und `#tags`. Tags sind unabhängig von Groß-/Kleinschreibung; Überschriften und Codeblöcke erzeugen keine Tags.
- Papierkorb und Archiv sind reversibel. Historische Textfassungen können als neuer Entwurf übernommen werden.

## Speicherung und Originale

Windows speichert im von Tauri ermittelten App-Datenverzeichnis (`app.notto.desktop`). Der exakte Pfad steht unter Einstellungen → Deine Daten. Dort liegen:

```text
notto.sqlite                  # transaktionales Journal, Versionen, Entwürfe, Suchindex
vault/
  local/
    notes/
      <id>.md                 # automatisch gepflegte, lesbare Markdown-Dateien
      attachments/<id>.png    # unveränderte Bilddateien
  <account-id>/
    notes/...
```

SQLite mit WAL und vollständiger Synchronisation ist das verbindliche Journal. Markdown ist eine automatisch erzeugte Darstellung derselben Originaltexte. Dieses Vorgehen vermeidet Datenverlust zwischen Datei-, Versions- und Sync-Schreibvorgängen. Nach einem Absturz wird eine fehlende oder veraltete Markdown-Datei aus dem Journal wiederhergestellt.

Externe Textänderungen an bestehenden Markdown-Dateien werden vor dem nächsten Überschreiben bzw. beim App-Start als separate Konfliktkopie erhalten. Ein dauerhaft laufender Ordner-Watcher und die automatische Aufnahme neuer externer Dateien sind noch nicht enthalten. Neue `.md`- und `.txt`-Dateien können über „Markdown importieren“ eingelesen werden. Dabei werden fremde Bilder nicht automatisch heruntergeladen.

Der Browser verwendet IndexedDB. Windows und Browser haben **getrennte lokale Speicher**. Notizen werden erst mit angemeldetem Konto zwischen Geräten synchronisiert. Browserdaten können durch Löschen des Browserprofils verloren gehen; dafür gibt es den vollständigen ZIP-Export.

Der Export enthält Markdown, alle referenzierten Bilder (auch aus früheren Versionen), Papierkorb, Entwürfe und `notto-backup.json` mit kompletter Historie und Zuständen. Markdown kann wieder importiert werden; der automatische Import der vollständigen JSON-Historie ist noch nicht implementiert.

## Frühere Supabase-Anbindung (0.2, optional)

Die App funktioniert ohne Backend. Für Login und Synchronisation muss ein eigenes Supabase-Projekt verbunden werden:

1. Supabase-Projekt anlegen und in dessen SQL-Editor die Datei `supabase/migrations/202609190001_notto.sql` ausführen.
2. Unter Authentication den E-Mail-/Passwort-Login aktivieren. Für die Bestätigungs-E-Mail die Webadresse von Notto als Site URL eintragen. Desktop-Nutzer können die E-Mail im Browser bestätigen und sich danach in der App anmelden.
3. Projekt-URL und **öffentlichen Publishable- oder Anon-Key** unter Notto → Einstellungen → Cloud-Verbindung eintragen. Alternativ `.env.example` nach `.env` kopieren, Werte einsetzen und neu bauen.
4. Dasselbe Projekt auf den gewünschten Geräten eintragen und mit demselben Konto anmelden.

Ein Secret- oder Service-Role-Key gehört niemals in die Oberfläche, `.env` mit `VITE_`-Präfix oder den ausgelieferten Client. Einstellungen lehnen die bekannten Secret-Key-Formate ab.

### Verhalten der Synchronisation

- Anmeldung wechselt in ein eigenes Konto-Notizbuch. Lokale Notizen werden nicht automatisch hochgeladen. „Lokale Notizen ins Konto kopieren“ ist eine ausdrückliche Importaktion.
- Änderungen und Entwürfe werden zuerst lokal gesichert. Notizen werden kurz nach Änderungen, alle 30 Sekunden und bei wiederhergestellter Internetverbindung synchronisiert.
- Bilder werden vor den referenzierenden Notizen hochgeladen und beim Herunterladen für Offline-Zugriff gecacht.
- Atomare Versionsprüfungen verhindern verlorene Änderungen. Bei konkurrierenden Änderungen bleibt die lokale Fassung als Konfliktkopie erhalten, die Cloud-Fassung behält ihre ursprüngliche ID.
- Abgebrochene Uploads können ohne doppelte Notizen wiederholt werden.
- KI-Auswertungen werden getrennt von den Originalnotizen gespeichert. Aufgaben, Kontakte und Themen verweisen auf ihre Quellen.
- Das eigene Backend prüft die Kontozuordnung bei jedem Datenzugriff. Anhänge sind nur nach Anmeldung zugänglich. Remote-Bilder werden im Markdown nicht ungefragt geladen.
- Abmelden entfernt **nicht** die lokalen Konto-Caches. Diese Version ist für persönliche Windows-/Browserprofile gedacht, nicht für gemeinsam genutzte öffentliche Rechner.
- Keine Ende-zu-Ende-Verschlüsselung oder App-Sperre. Das Backend kann die synchronisierten Inhalte lesen.

## Web bereitstellen

`npm run build` erstellt die Webapp unter `dist/`. Im Mittwald-Betrieb liefert der App-Container diese zusammen mit der API aus; siehe [SELF-HOSTING.md](docs/SELF-HOSTING.md). `.openai/hosting.json` gehört zur früheren privaten Vorschau. Lokale Browsernotizen werden erst nach ausdrücklichem Kopieren ins Konto synchronisiert.

## Prüfungen und Grenzen

Die automatisierten Prüfungen umfassen Originaltext-Roundtrips, Tags, Suche, Historie, Konfliktschutz, Kontentrennung in IndexedDB, Wiederherstellung des Editors, Synchronisationsabbrüche sowie das echte PostgreSQL-Schema in PGlite inklusive Row Level Security. Rust-Tests prüfen Pfadgrenzen, SQLite-Versionskontrolle, Wiederherstellung der Markdown-Dateien und den Erhalt externer Textänderungen.

```powershell
npm test
& "$env:USERPROFILE/.cargo/bin/cargo.exe" test --manifest-path src-tauri/Cargo.toml --lib
```

Noch separat mit echten Geräten zu prüfen: Monitorwechsel, verschiedene DPI-Skalierungen, Fokusverhalten, Animationen in WebView2 sowie die Anmeldung/Bestätigungs-E-Mails und Ende-zu-Ende-Synchronisation mit einem eingerichteten Supabase-Projekt. Ein Windows-Code-Signing-Zertifikat ist nicht eingerichtet.

## Struktur

- `src/domain.ts`: Originalnotizen, Revisionen, Tags und Suchsemantik.
- `src/repository.ts`: einheitlicher Datenzugriff für Tauri/SQLite und Browser/IndexedDB.
- `src/cloud.ts`: Cloud-Zugriff, Anhänge und konfliktbewusste Synchronisation.
- `src/Editor.tsx`: Editor, Entwürfe, Bilder und Versionshistorie.
- `src/Widget.tsx`: Zustände und Animationen des Randwidgets.
- `src/App.tsx`: Notizbuch mit Suche, Tags, Archiv und Papierkorb.
- `src-tauri/src/lib.rs`: Windows-Fenster, Tray, Shortcut, persistente Daten und Markdown-Dateien.
- `supabase/migrations/`: Backend-Schema, Zugriffsregeln und atomare Sync-Funktion.

Abhängigkeiten sind über `package-lock.json` und `src-tauri/Cargo.lock` festgeschrieben. Astryx ist als Version 0.6.2 eingebunden.
