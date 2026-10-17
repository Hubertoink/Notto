# Testreview vom 18. Oktober 2026

## Ergebnis

Die Suite ist überwiegend angemessen. Die Zahl 471 ist kein Qualitätsnachweis und kein sinnvolles Kürzungsziel: Sie enthält parametrisierte Grenzfälle, deren Laufzeit meist sehr klein ist. Zwei reine Dekorationstests wurden entfernt; **469 automatisierte Fälle bleiben**, dazu ein bewusst nicht automatisch ausgeführter Live-KI-Test. Browser- und Rust-Prüfungen werden separat gezählt.

Der Ausgangslauf enthielt 171 Serverfälle und 300 Client-/Fachlogikfälle in insgesamt 76 ausführbaren Testdateien. Eine zusätzliche Datei enthält die optionale Live-Demo. Der vollständige lokale Lauf benötigte zuletzt etwa 27 Sekunden. Die langsamste Datei war `Editor.test.tsx` mit rund 16,5 Sekunden; viele kleine Parser- und Validierungsfälle sind dagegen sehr billig. Die Laufzeiten hängen von Parallelität, Rechner und Betriebssystem ab.

Prüfumfang: Bestandsaufnahme aller Fallnamen und Laufzeiten; vertiefte Codeprüfung der Speicherung, Synchronisation, Konto- und KI-Grenzen, Quellenprüfung, OpenUI, aktuellen UI-Änderungen und auffälligen Gestaltungsprüfungen. Vier gezielte Fehlereinbauten wurden in einem isolierten Checkout geprüft. Das ist keine vollständige Mutationstestanalyse und keine gemessene prozentuale Codeabdeckung.

## Konkrete Änderungen

- **Entfernt:** Zwei Tests in `note-backgrounds.test.ts`, die feste Bildanzahlen, einen Verzeichnisnamen und die Trennung zweier statischer Bildlisten festschrieben. Änderungen am Bildangebot sind keine Funktionsregression. Die Wiederherstellung einer gültigen Auswahl und der sichere Rückfall bei unbekannten Einstellungen bleiben geprüft.
- **Verbessert:** Der Editor-Test prüft echte Entwurfspersistenz statt CSS-Klassen und das Vorhandensein eines SVG. Solange der Schreibvorgang aussteht, darf die Oberfläche nicht „gesichert“ melden. Danach muss der genaue Text im Repository stehen.
- **Verbessert:** Die Hashtag-Popup-Tests prüfen Sichtbarkeit und Lage relativ zum Cursor bei mehreren Fenstergrößen statt einer willkürlichen exakten Pixelposition.
- **Lücke gefunden und behoben:** Der neue Dokumentzähler zählte zunächst auch Markdown-Beispiele in Code und unbenutzte Linkdefinitionen. Ein erweiterter Negativfall schlug tatsächlich fehl (3 statt 0 Dokumente). Der Zähler wertet nun echte Markdown-Links aus und ignoriert diese Beispiele. Die Dateizählung bleibt dedupliziert und vom Dokumentfilter der Liste unabhängig.
- **Browserprüfung gestärkt:** Die Navigation wird mit der echten `App` und lokal erzeugten Testnotizen geprüft, einschließlich Dokumentzähler. Nur die Anmeldeschranke wird im isolierten Testserver ersetzt; es wird kein Nutzerkonto angesprochen. Die Prüfung kann dadurch auch eine falsche Platzierung des Nutzerbereichs im Komponentenbaum erkennen.
- **CI-Lücke geschlossen:** `npm run test:layout` führt alle fünf Browser-Skripte aus. Der reguläre Check-Workflow installiert Chromium und führt sie bei Pull Requests und Pushes nach `main` aus. Bei Fehlern werden ausschließlich die vorgesehenen PNG-Prüfbilder als Artefakte gesammelt.
- **Aussage korrigiert:** Ein Server-Test mit simulierten Suchantworten behauptet im Namen nicht mehr, eine echte Webrecherche durchzuführen.

## Relevanz der abgedeckten Bereiche

| Bereich                                    | Warum behalten?                                                                             | Was die Tests tatsächlich belegen                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Originaltexte, Entwürfe, Export, Versionen | Datenverlust wäre teuer und oft erst spät sichtbar.                                         | Unveränderlichkeit, Konfliktkopien, Wiederherstellung, vollständige referenzierte Anhänge und Verhalten bei Schreibfehlern.                                                               |
| Synchronisation und Anmeldung              | Mehrgerätebetrieb und Offline-Nutzung erzeugen Rennen und Fehlerpfade.                      | Wiederholbarkeit, veraltete Schreibversionen, verlorene Antworten, Kontentrennung und Sitzungshandhabung; Transport bzw. native APIs werden teilweise simuliert.                          |
| Server, Datenbank und Netzwerk             | Hier werden Kontogrenzen und zulässige Zugriffe durchgesetzt.                               | Echte Fastify-Routen und SQL-Schema gegen PGlite, Autorisierung, private Netzwerkziele und teilweise echter lokaler HTTP-Verkehr. Kein Nachweis für sämtliche Produktionskonfigurationen. |
| KI-Aufträge, Belege und Freigaben          | Ungültige Belege oder nachträglich entzogene Freigaben dürfen nicht übernommen werden.      | Zustandsübergänge, Abbruch, Wiederholungen, wörtliche Zitate, Dokumentversionen, Ausschlüsse und kontrollierte Modell-/Toolantworten.                                                     |
| Dokumente, OCR und Transkripte             | Fehlende Seiten, doppelte Imports und falsche Quellenzuordnung sind fachlich relevant.      | Parsen, Provenienz, Größen- und Zeitgrenzen, Caches, Teilfehler und Wiederaufnahme. OCR-/Modellqualität wird simuliert.                                                                   |
| Editor, Navigation und Interaktionen       | Fehler entstehen oft beim Zusammenspiel von Eingabe, Speicherung und Zustandswechseln.      | React-Interaktionen und echte Repository-Vorgänge; Browserprüfungen ergänzen Geometrie, Scrollen und Fokus.                                                                               |
| OpenUI                                     | Ein fehlerhaftes Layout darf keine Ergebnisse verlieren, vervielfachen oder Code ausführen. | Zulässige Komponenten, vollständige Ergebniszuordnung, Fallback, echter Renderer und Markdown-Export.                                                                                     |
| Frühere Supabase-Anbindung                 | Der Pfad ist weiterhin im Produkt und dokumentiert.                                         | Migrationen und Zugriffskontrollen in PGlite. Erst zusammen mit einer ausdrücklichen Entfernung dieser Produktfunktion streichen.                                                         |

Ähnliche Prüfungen auf mehreren Ebenen sind nicht automatisch Duplikate: Ein UI-Test belegt beispielsweise, dass eine Aktion die richtige Anfrage auslöst; ein Server-Test belegt unabhängig davon, dass eine direkte unerlaubte Anfrage abgewiesen wird. Das Entfernen der zweiten Prüfung würde eine andere Fehlerklasse ungeschützt lassen.

## Gezielte Fehlereinbauten

Die unveränderte Auswahl bestand mit 65 Tests. Jede Änderung wurde einzeln vorgenommen und anschließend zurückgenommen; die Arbeitskopie und Nutzerdaten wurden nicht verändert.

| Absichtlich eingebauter Fehler                                           | Erkannt durch                              | Fehlgeschlagene Fälle |
| ------------------------------------------------------------------------ | ------------------------------------------ | --------------------: |
| Dokumentanzahl immer 0                                                   | Zähler und echte React-Listenüberschrift   |                     3 |
| `noteAllowed` lässt ausgeschlossene Notizen zu                           | Ausschluss- und Analyseverhalten           |                     2 |
| Lokales Repository akzeptiert veraltete Schreibversionen                 | Konkurrenztest für zwei Fenster            |                     1 |
| OpenUI akzeptiert doppelte Indizes statt vollständiger Ergebnisabdeckung | Negativfall für doppelte Ergebniszuordnung |                     1 |

Alle vier Fehler führten zu fehlgeschlagenen Assertions, nicht lediglich zu Import- oder Kompilierfehlern. Das ist ein konkreter Wirksamkeitsnachweis für diese vier Schutzmechanismen, kein Beweis für Fehlerfreiheit der gesamten Suite.

## Verbleibende Grenzen und Prioritäten

1. **KI-Antwortqualität:** Die normale Suite verwendet kontrollierte Modellantworten. Sie beweist keine allgemeine fachliche Richtigkeit, Vollständigkeit oder angemessene Quellenauswahl echter Modellantworten. Der eine Live-Test ist eine bewusst ausgeschaltete Demo mit lokalem Testkonto und kein umfassender Qualitätsbenchmark. Dafür eignen sich die Szenarien in [GENERATIVE-UI.md](GENERATIVE-UI.md) mit menschlicher Bewertung der Originalbelege.
2. **Durchgehende Mehrgeräteabläufe:** Komponenten-, Sync- und Serverprüfungen decken die Teile gut ab. Ein automatisierter Browserablauf mit echter Anmeldung, echter API, Speichern, Neuladen und Offline-Konflikt wäre die nächste wertvolle Ergänzung. Die aktuelle Navigationsprüfung ist ausdrücklich kein solcher Ende-zu-Ende-Test.
3. **Native Oberfläche:** Die fünf Rust-Tests laufen zusätzlich in den Desktop-Builds. Chromium und gemockte Tauri-Aufrufe ersetzen keine Prüfung von WebView2, Keyring, Mikrofon, Monitorwechseln und DPI auf echten Geräten.
4. **Layout:** Zwei der älteren Geometrie-Skripte nutzen reduzierte HTML-Fixtures mit Produktions-CSS. Sie prüfen Layoutregeln, nicht den gesamten Komponentenbaum. Die neuen Navigations- und Auftragseingabeprüfungen verwenden echte React-Komponenten. Screenshots werden erzeugt, aber nicht automatisch pixelweise mit Referenzbildern verglichen.

Für normale Änderungen die betroffenen Tests während der Arbeit verwenden; vor Veröffentlichung den vollständigen Lauf, die Browserchecks und die Builds ausführen. Es gibt derzeit keinen sachlichen Grund, die schnelle Standardsuite pauschal zu halbieren. Die getrennten Release-Workflows behalten ihre eigenen Prüfungen, damit ein manuell gestarteter Container- oder Desktop-Build nicht ungeprüft veröffentlicht wird.

```powershell
npm test
npm run test:layout
npm run build
npm run build:server
```

## Datei-Inventar

Die folgende Übersicht nennt die Fallzahl nach dem Review. Sie dient der Nachvollziehbarkeit des Umfangs; ein vorhandener Testname allein beweist noch keine ausreichende Abdeckung.

| Datei                                                                         | Fälle | Entscheidung                                                |
| ----------------------------------------------------------------------------- | ----: | ----------------------------------------------------------- |
| [evals/dev-harness.live.test.ts](../evals/dev-harness.live.test.ts)           |     1 | Live-Demo; nur nach ausdrücklicher Aktivierung              |
| [server/app.test.ts](../server/app.test.ts)                                   |    29 | Beibehalten                                                 |
| [server/attachment-jobs.test.ts](../server/attachment-jobs.test.ts)           |     6 | Beibehalten                                                 |
| [server/browser-network.test.ts](../server/browser-network.test.ts)           |     3 | Beibehalten                                                 |
| [server/command-context.test.ts](../server/command-context.test.ts)           |     3 | Beibehalten                                                 |
| [server/command-intent.test.ts](../server/command-intent.test.ts)             |    21 | Beibehalten                                                 |
| [server/command-search.test.ts](../server/command-search.test.ts)             |     2 | Beibehalten                                                 |
| [server/command-verification.test.ts](../server/command-verification.test.ts) |     7 | Beibehalten                                                 |
| [server/commands.test.ts](../server/commands.test.ts)                         |    42 | Beibehalten                                                 |
| [server/document-context.test.ts](../server/document-context.test.ts)         |     1 | Beibehalten                                                 |
| [server/document-download.test.ts](../server/document-download.test.ts)       |    13 | Beibehalten                                                 |
| [server/document-import.test.ts](../server/document-import.test.ts)           |    20 | Beibehalten                                                 |
| [server/document-reader.test.ts](../server/document-reader.test.ts)           |     3 | Beibehalten                                                 |
| [server/models.test.ts](../server/models.test.ts)                             |     3 | Beibehalten                                                 |
| [server/sources.test.ts](../server/sources.test.ts)                           |     5 | Beibehalten                                                 |
| [server/youtube-fetch.test.ts](../server/youtube-fetch.test.ts)               |     7 | Beibehalten                                                 |
| [server/youtube-transcript.test.ts](../server/youtube-transcript.test.ts)     |     6 | Beibehalten                                                 |
| [src/AIActivity.test.tsx](../src/AIActivity.test.tsx)                         |     3 | Beibehalten                                                 |
| [src/App.navigation.test.tsx](../src/App.navigation.test.tsx)                 |     2 | Beibehalten                                                 |
| [src/Bauhaus.test.ts](../src/Bauhaus.test.ts)                                 |     2 | Beibehalten                                                 |
| [src/CommandPresentation.test.tsx](../src/CommandPresentation.test.tsx)       |     2 | Beibehalten                                                 |
| [src/DesktopFrame.test.tsx](../src/DesktopFrame.test.tsx)                     |     2 | Beibehalten                                                 |
| [src/Dictation.test.tsx](../src/Dictation.test.tsx)                           |     2 | Beibehalten                                                 |
| [src/Documents.test.tsx](../src/Documents.test.tsx)                           |     6 | Beibehalten                                                 |
| [src/Editor.test.tsx](../src/Editor.test.tsx)                                 |    32 | Verhaltensprüfung verbessert                                |
| [src/FloatingSearch.test.tsx](../src/FloatingSearch.test.tsx)                 |     5 | Beibehalten                                                 |
| [src/Knowledge.test.tsx](../src/Knowledge.test.tsx)                           |     1 | Beibehalten                                                 |
| [src/Login.test.tsx](../src/Login.test.tsx)                                   |     3 | Beibehalten                                                 |
| [src/NoteCommands.test.tsx](../src/NoteCommands.test.tsx)                     |    10 | Beibehalten                                                 |
| [src/Organization.test.tsx](../src/Organization.test.tsx)                     |     3 | Beibehalten                                                 |
| [src/Settings.test.tsx](../src/Settings.test.tsx)                             |     3 | Beibehalten                                                 |
| [src/SourceImport.test.tsx](../src/SourceImport.test.tsx)                     |     8 | Beibehalten                                                 |
| [src/Topics.test.tsx](../src/Topics.test.tsx)                                 |     2 | Beibehalten                                                 |
| [src/Widget.test.tsx](../src/Widget.test.tsx)                                 |     1 | Beibehalten                                                 |
| [src/analysis-current.test.ts](../src/analysis-current.test.ts)               |    30 | Beibehalten                                                 |
| [src/analysis-quotes.test.ts](../src/analysis-quotes.test.ts)                 |     6 | Beibehalten                                                 |
| [src/annotation-markdown.test.ts](../src/annotation-markdown.test.ts)         |     2 | Beibehalten                                                 |
| [src/backend.desktop.test.ts](../src/backend.desktop.test.ts)                 |     1 | Beibehalten                                                 |
| [src/backend.test.ts](../src/backend.test.ts)                                 |     1 | Beibehalten                                                 |
| [src/cloud.test.ts](../src/cloud.test.ts)                                     |     3 | Beibehalten                                                 |
| [src/collection-drop.test.tsx](../src/collection-drop.test.tsx)               |     1 | Beibehalten                                                 |
| [src/collections.test.ts](../src/collections.test.ts)                         |     2 | Beibehalten                                                 |
| [src/command-presentation.test.ts](../src/command-presentation.test.ts)       |    16 | Beibehalten                                                 |
| [src/connection.test.ts](../src/connection.test.ts)                           |     2 | Beibehalten                                                 |
| [src/document-context.test.ts](../src/document-context.test.ts)               |     5 | Beibehalten                                                 |
| [src/document-ocr.test.ts](../src/document-ocr.test.ts)                       |     4 | Beibehalten                                                 |
| [src/document-store.test.ts](../src/document-store.test.ts)                   |     1 | Beibehalten                                                 |
| [src/document-text.test.ts](../src/document-text.test.ts)                     |     3 | Beibehalten                                                 |
| [src/domain.test.ts](../src/domain.test.ts)                                   |    12 | Beibehalten                                                 |
| [src/drafts.test.tsx](../src/drafts.test.tsx)                                 |     1 | Beibehalten                                                 |
| [src/export.test.ts](../src/export.test.ts)                                   |     2 | Beibehalten                                                 |
| [src/harness.test.ts](../src/harness.test.ts)                                 |    16 | Beibehalten                                                 |
| [src/image-layout.test.ts](../src/image-layout.test.ts)                       |     3 | Beibehalten                                                 |
| [src/intelligence.test.ts](../src/intelligence.test.ts)                       |    11 | Beibehalten                                                 |
| [src/links.test.tsx](../src/links.test.tsx)                                   |     5 | Beibehalten                                                 |
| [src/markdown-images.test.tsx](../src/markdown-images.test.tsx)               |     8 | Beibehalten                                                 |
| [src/memory-policy.test.ts](../src/memory-policy.test.ts)                     |     4 | Beibehalten                                                 |
| [src/note-backgrounds.test.ts](../src/note-backgrounds.test.ts)               |     1 | 2 Dekorationsfälle entfernt; Einstellungsverhalten behalten |
| [src/note-command.test.ts](../src/note-command.test.ts)                       |     3 | Beibehalten                                                 |
| [src/note-links.test.ts](../src/note-links.test.ts)                           |     2 | Beibehalten                                                 |
| [src/note-list-counts.test.ts](../src/note-list-counts.test.ts)               |     3 | Verhaltensprüfung verbessert                                |
| [src/note-reference.test.tsx](../src/note-reference.test.tsx)                 |     2 | Beibehalten                                                 |
| [src/note-relations.test.ts](../src/note-relations.test.ts)                   |     6 | Beibehalten                                                 |
| [src/note-tools.test.ts](../src/note-tools.test.ts)                           |     7 | Beibehalten                                                 |
| [src/repository.test.ts](../src/repository.test.ts)                           |     3 | Beibehalten                                                 |
| [src/research-policy.test.ts](../src/research-policy.test.ts)                 |     2 | Beibehalten                                                 |
| [src/retrieval.test.ts](../src/retrieval.test.ts)                             |     1 | Beibehalten                                                 |
| [src/rewrite.test.ts](../src/rewrite.test.ts)                                 |     3 | Beibehalten                                                 |
| [src/shortcuts.test.ts](../src/shortcuts.test.ts)                             |     2 | Beibehalten                                                 |
| [src/sidebar-disclosure.test.ts](../src/sidebar-disclosure.test.ts)           |     2 | Beibehalten                                                 |
| [src/source-context.test.ts](../src/source-context.test.ts)                   |     3 | Beibehalten                                                 |
| [src/state.test.tsx](../src/state.test.tsx)                                   |     2 | Beibehalten                                                 |
| [src/sync-schema.test.ts](../src/sync-schema.test.ts)                         |     7 | Beibehalten                                                 |
| [src/tag-popup.test.ts](../src/tag-popup.test.ts)                             |     2 | Verhaltensprüfung verbessert                                |
| [src/task-store.test.ts](../src/task-store.test.ts)                           |     4 | Beibehalten                                                 |
| [src/updates.test.ts](../src/updates.test.ts)                                 |     4 | Beibehalten                                                 |
| [src/youtube.test.ts](../src/youtube.test.ts)                                 |    13 | Beibehalten                                                 |
