# Visuelle KI-Aufträge mit OpenUI

Neue strukturierte KI-Aufträge können Vergleichstabellen, nummerierte Ablaufpläne und Quellenkarten kombinieren. Die Darstellung verwendet Notos Farben und Komponenten. „Textansicht“ zeigt die bisherige Kartenansicht. „In Notiz übernehmen“ erzeugt bearbeitbares Markdown; Tabellen werden als Markdown-Tabellen übernommen, Quellenbelege und Hinweise bleiben erhalten. Einzelne Planschritte lassen sich als Checkbox-Aufgabe in den Notizentwurf übernehmen. Das Speichern bleibt eine eigene Nutzeraktion.

Beispielaufträge mit ausgewählten Dokumenten:

- „Vergleiche die Beteiligungsmöglichkeiten beider Konzepte nach Offenheit, Verbindlichkeit und Aufwand.“
- „Entwickle aus dieser Konzeption einen Ablaufplan für den nächsten Jugendhaus-Workshop.“
- „Fasse die Kernaussagen des Dokuments mit Quellenbelegen zusammen.“

## Umfang und Grenzen

Die erste Version ergänzt manuelle KI-Aufträge und ausdrücklich formulierte `/ki`-Aufträge. Automatische Anmerkungen und reine Webrecherchen mit ihrem bestehenden zitierten Antworttext verwenden weiterhin ihre bisherige Darstellung. Vorhandene Ergebnisse bleiben lesbar; eine neue Darstellung entsteht beim erneuten Ausführen. Die Modellentscheidung kann auch eine normale Textantwort ergeben.

OpenUI wird gemeinsam mit dem inhaltlichen Ergebnis erzeugt. Es entsteht kein weiterer Modellaufruf; Komponentenbeschreibung und Layout benötigen zusätzliche Tokens. Es gibt kein Token-Streaming: Die vorhandene Hintergrundverarbeitung und Abfrage des Auftragsstatus bleiben bestehen. Ein Thesys-Konto, Gateway oder weiterer API-Schlüssel ist nicht erforderlich.

## Datenfluss

`server/command-worker.ts` ergänzt das strukturierte Antwortschema um `presentation`. Der gemeinsame Komponentenvertrag in `src/command-presentation.ts` erzeugt die Modellanweisungen. OpenUI-Code darf nur bestehende Ergebnisindizes gruppieren und ordnen; keine neuen Texte, URLs oder Aktionen definieren.

Nach der bisherigen Quellenprüfung validiert Noto den Layoutbaum mit dem OpenUI-Parser und zusätzlichen Grenzen. Jedes Ergebnis muss genau einmal vorkommen. Unbekannte Komponenten, Zustände, Werkzeuge, fehlende oder doppelte Indizes und unvollständige Programme werden verworfen. Wurden unbelegte Ergebnisse entfernt, wird das gesamte Layout verworfen, damit sich keine Quellenzuordnungen durch verschobene Indizes verändern.

Gespeichert wird `{ version: 1, source: "root = Answer([...])" }` im bestehenden JSON-Ergebnis des Auftrags. Eine Datenbankmigration ist nicht nötig. Der Client prüft auch gespeicherte Programme und übergibt ausschließlich eine kanonische Fassung an den Renderer. Quellenlinks, Screenshots, Aussagearten und Notizübernahmen stammen aus Noto. Fehler beim Laden oder Rendern führen zur bisherigen Antwortansicht; auch unbekannte zukünftige Formatversionen bleiben so lesbar.

Der Renderer wird erst bei visuellen Antworten nachgeladen. Verwendet werden die festgeschriebenen MIT-Pakete `@openuidev/react-lang` und `@openuidev/lang-core` 1.0.1. Laufzeit-Telemetrie ist laut OpenUI standardmäßig aus. Installationstelemetrie lässt sich mit `OPENUI_TELEMETRY_DISABLED=1` beim Installieren deaktivieren; die Installation für diese Änderung erfolgte so. Es sind keine Cloud-Überwachung oder Autofix-Dienste eingebunden.

## Prüfen

```sh
npm test -- src/command-presentation.test.ts src/CommandPresentation.test.tsx src/NoteCommands.test.tsx server/commands.test.ts
node scripts/check-command-presentation.mjs
npm run build
npm run build:server
```

Der Chromium-Check verwendet deterministische Ergebnisse mit dem echten Renderer und den App-Styles, prüft 900 und 360 Pixel breite Ansichten sowie Textansicht und Export. Screenshots liegen unter `.notto-dev/openui-qa/`. Modellqualität, WebView2 und WebKitGTK müssen zusätzlich mit echten Aufträgen praktisch geprüft werden.

Referenzen: [React-Runtime](https://github.com/thesysdev/openui/tree/main/packages/react-lang), [Komponentendefinitionen](https://www.openui.com/docs/openui-lang/defining-components), [Telemetrie](https://www.openui.com/docs/openui-lang/telemetry).

## Manueller Funktionstest

Eine Notiz mit dem folgenden Text anlegen und in einer neuen Sammlung „OpenUI-Test“ speichern. Unter „KI-Kontext“ diese Sammlung auswählen und Webrecherche für die Notiz ausschalten. Keinen KI-Ausschluss-Tag verwenden. Die Sammlung enthält zunächst nur diese Testnotiz; dadurch werden ihre Aussagen als zitierbare Quellen berücksichtigt.

```text
OpenUI-Test: Beteiligungsnachmittag im Jugendhaus

Dies ist ein erfundenes Testszenario.
Zielgruppe: zwölf Jugendliche von 12 bis 15 Jahren.
Verfügbar: zwei Fachkräfte, 90 Minuten und maximal 100 Euro Materialbudget.

Variante A – Kreativwerkstatt:
Materialkosten: 80 Euro. Platz für zwölf Jugendliche.
Die Jugendlichen wählen ihr Thema selbst. Beide Fachkräfte werden benötigt.
Vorbereitung: 30 Minuten. Durchführung im Werkraum, unabhängig vom Wetter.

Variante B – Spieleparcours:
Materialkosten: 40 Euro. Platz für zwölf Jugendliche.
Die Stationen stehen vorher fest; Jugendliche können die Reihenfolge wählen.
Eine Fachkraft leitet die Stationen, die zweite begleitet die Gruppe.
Vorbereitung: 20 Minuten. Durchführung im Hof, nur bei trockenem Wetter.

Vereinbarungen:
Die Jugendlichen stimmen vor der Entscheidung über beide Varianten ab.
Am Anfang werden gemeinsam Regeln vereinbart.
Am Ende werden zehn Minuten für Rückmeldungen reserviert.
Ein genauer Termin und verantwortliche Personen sind noch nicht festgelegt.
Zu Barrierefreiheit und Versicherungsfragen liegen keine Informationen vor.
```

Über „KI fragen“ diese Aufträge einzeln starten:

1. **Vergleich:** „Vergleiche ausschließlich anhand dieser Notiz beide Varianten als visuelle Vergleichstabelle. Verwende drei Vergleichsaspekte: Kosten und Budgetrest, Beteiligung, Durchführung und Personal. Stelle Unterschiede innerhalb jedes Aspekts gegenüber. Belege jeden Aspekt mit einer Originalstelle. Keine Webrecherche.“ Erwartet: 20 bzw. 60 Euro Budgetrest als Ableitung, zwölf Plätze bei beiden Varianten, Regenabhängigkeit nur bei B und keine Reduzierung der insgesamt zwei Fachkräfte.
2. **Plan:** „Entwickle ausschließlich aus dieser Notiz einen visuellen Ablaufplan für 90 Minuten Kreativwerkstatt mit vier Schritten. Die letzten zehn Minuten sind Rückmeldungen. Kennzeichne deine Zeiteinteilung als Vorschlag, trenne die 30 Minuten Vorbereitung davon und belege die Ausgangspunkte. Erfinde keinen Termin und keine Personennamen.“ Erwartet: nummerierte Schritte, zusammen 90 Minuten einschließlich Abschluss; Übernahme eines Schritts als Checkbox in den Entwurf.
3. **Quellenkarten:** „Zeige drei Quellenkarten: gesicherte Rahmenbedingungen, verpflichtende Vereinbarungen und offene Fragen. Verwende ausschließlich diese Notiz und kurze wörtliche Belege. Sage ausdrücklich, welche Informationen fehlen.“ Erwartet: Termin, Verantwortliche, Barrierefreiheit und Versicherungsfragen bleiben offen.
4. **Kombination:** „Erstelle aus dieser Notiz eine visuelle Übersicht: drei Vergleichsaspekte zu beiden Varianten als Tabelle, drei vorgeschlagene Schritte zur gemeinsamen Entscheidung als Ablaufplan und eine Quellenkarte zu offenen Fragen. Höchstens sieben Ergebnisse insgesamt, jedes mit einem Beleg aus der Notiz. Keine Webrecherche.“ Erwartet: drei Darstellungsarten in einer Antwort, Originalfakten und eigene Vorschläge unterscheidbar.

Nach jedem Auftrag die Quellenbelege öffnen, auf Textansicht und zurück wechseln, eine andere Notiz öffnen und wieder zurückkehren. Die Darstellung und Belege müssen erhalten bleiben. „In Notiz übernehmen“ auf einer Kopie testen: Text und Tabellen müssen bearbeitbar sein; erst Speichern übernimmt den Entwurf. Bei schmalem Fenster darf die Seite nicht horizontal überlaufen.

Zum Ausschluss-Test eine Kopie der Notiz verwenden: `#` eingeben, den oben mit „Keine KI“ markierten Tag übernehmen, speichern und einen neuen KI-Auftrag versuchen. Der Auftrag muss blockiert sein. Bereits gespeicherte Antworten sind kein Gegenbeweis für den Ausschluss; der Test betrifft neue Verarbeitung. Technische Fehlerfälle des OpenUI-Parsers werden automatisiert getestet und sollten nicht durch zufällige Prompt-Formulierungen simuliert werden.
