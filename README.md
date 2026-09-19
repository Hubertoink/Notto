# Notto

Eine lokale Windows-Notizapp mit andockbarem Randwidget und derselben Oberfläche im Browser. React 19, Astryx, Motion und Tauri 2. KI und Diktat sind in diesem ersten Stand bewusst noch nicht implementiert.

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

## Bedienung

- **Strg + Umschalt + Leertaste:** Schnellnotiz über das Randwidget (Windows, solange Notto läuft).
- **Strg + N:** neue Notiz im Hauptfenster.
- **Strg + K:** Suche fokussieren.
- **Strg + Enter:** Notiz speichern.
- **Escape:** Randwidget einklappen; der Entwurf bleibt erhalten.
- Widget am Griff verschieben. Nach dem Loslassen dockt es links oder rechts am aktuellen Monitor an. Der Arbeitsbereich berücksichtigt Taskleiste und Skalierung.
- Ein Klick hält die Hover-Vorschau offen. Während der Eingabe schließt sie sich nicht beim Verlassen mit der Maus.
- Das Hauptfenster schließt in den Tray. Über das Tray-Menü lässt sich Notto vollständig beenden oder das Widget ausblenden.
- Bilder über die Bildschaltfläche, Einfügen aus der Zwischenablage oder Drag-and-drop hinzufügen. Unterstützt: PNG, JPEG, WebP, GIF, AVIF bis 12 MB pro Bild.
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

## Cloud einrichten

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
- Aufgaben oder externe KI-Auswertungen werden noch nicht angelegt.
- RLS isoliert Konten in PostgreSQL. Bilder liegen in einem privaten Bucket mit Kontozuordnung im Pfad. Remote-Bilder werden im Markdown nicht ungefragt geladen.
- Abmelden entfernt **nicht** die lokalen Konto-Caches. Diese Version ist für persönliche Windows-/Browserprofile gedacht, nicht für gemeinsam genutzte öffentliche Rechner.
- Keine Ende-zu-Ende-Verschlüsselung oder App-Sperre in Version 0.1. Das Backend kann die synchronisierten Inhalte lesen.

## Web bereitstellen

`npm run build` erstellt eine statische Webapp unter `dist/`. Sie kann über Sites oder einen statischen HTTPS-Host bereitgestellt werden. `.openai/hosting.json` verweist auf die private Sites-Instanz. Die Cloud-Verbindung kann auch nach dem Deployment in der App konfiguriert werden. Lokale Browsernotizen werden nicht auf den Webhost hochgeladen.

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
