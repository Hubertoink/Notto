# Notizsekretär und Gedächtnis

## Ziel und Bedienung

Unter **Wissen & KI → Notizsekretär** einen konkreten Auftrag eingeben, etwa „Fasse den Stand des Medienraums zusammen und finde Widersprüche“. Noto sucht, liest nach und erstellt eine belegte Übersicht, gerichtete Beziehungen und Sammlungszuordnungen. Ergebnisse bleiben getrennt von Originalnotizen. Übersichten und Beziehungen lassen sich übernehmen oder verwerfen; Zuordnungen lassen sich übernehmen und rückgängig machen. Ein erneuter Auftrag erzeugt eine neue, nachvollziehbare Fassung.

## Ablauf und Grenzen

1. Kombinierte Volltext-/Vektorsuche liefert bis zu zwölf Textstellen, bevorzugt aus unterschiedlichen Notizen.
2. Der Agent darf `search_notes` und `read_note` verwenden. Lesen liefert auch Links, bestätigte Beziehungen und die letzten Aufgabenentscheidungen. Kein Werkzeug kann Originaltexte ändern, löschen oder externe Aktionen ausführen.
3. Höchstens vier Werkzeugrunden, acht Werkzeugaufrufe, sechs Agentenantworten einschließlich höchstens einer Belegkorrektur, 24 Quellen und 100.000 Zeichen Gesprächskontext. Danach muss ein Ergebnis vorliegen. Insgesamt höchstens zehn KI-Anfragen einschließlich Suchindex, Suchvektor und bis zu zwei Belegprüfungen. Die Korrekturrunde bekommt konkrete Prüfhinweise und keine Werkzeuge. Eine Laufzeitgrenze von drei Minuten wird zwischen Schritten geprüft; laufende Provideranfragen haben zusätzlich ihr eigenes Timeout.
4. Jede Aussage braucht einen nachweisbaren Beleg. Beziehungen brauchen zwei verschiedene Notizen. Eine zusätzliche Modellprüfung beurteilt, ob die gesamten Aussagen von den angegebenen Quellen getragen werden. Schlussfolgerungen und Widersprüche bleiben sichtbar gekennzeichnet. Diese Prüfung verringert Fehler, garantiert aber keine Wahrheit.
5. Freigaben und Inhaltsfassungen werden vor weiteren Schritten und vor dem Speichern erneut geprüft. Abbruch verwirft ungespeicherte Ergebnisse; eine bereits laufende Provideranfrage kann noch Kosten verursachen.
6. Protokolle enthalten Status, Arbeitsschritte und Laufzeit, keine internen Gedanken oder Schlüssel. Statelose Tool-Fortsetzungen reichen benötigte Reasoning-Ausgaben innerhalb des laufenden Durchlaufs weiter; diese werden nicht als Gedächtnis gespeichert.

Eine einzelne Oberfläche zeigt bis zu zwanzig gespeicherte Durchläufe. Das Modell wählt das Ergebnis, die Anwendung validiert und speichert es. Die vorgeschlagenen Beziehungen sind gerichtet: A ergänzt, widerspricht, konkretisiert oder ersetzt B; beziehungsweise A ist ein Beispiel für B. „Ersetzt“ erfordert einen expliziten Beleg und wird nicht allein aus einem jüngeren Datum abgeleitet.

## Gedächtnis

Arbeitsanweisungen bleiben global für das jeweilige Notizbuch. Projektwissen und gelernte Korrekturen werden anhand des Auftrags, ihrer Begriffe, ihres optionalen Projekts und ihrer Quellen ausgewählt. Irrelevante Einträge werden nicht mitgesendet. Das Limit von 10.000 Zeichen umfasst die vollständig serialisierten Einträge, Quellen und Rahmentexte. OCR und Belegprüfung erhalten kein persönliches Memory.

Sync-Revisionen und Inhaltsrevisionen sind getrennt: Die vorhandene Texthistorie bestimmt die Inhaltsrevision. Anpinnen und Sammlungswechsel invalidieren weder Memory noch Analysen. Inhaltliche Änderungen erfordern eine erneute Quellenprüfung. Unveränderte Textabschnitte können ihre Embeddings wiederverwenden. Bestehende Datensätze benötigen keine Migration; nicht mehr nachvollziehbare alte Revisionen bleiben vorsichtshalber ungültig.

Einträge können einen Projektbereich, ein Ablaufdatum und ausdrücklich ersetzte Vorgängereinträge haben. Ersetzte Aussagen werden nicht automatisch reaktiviert, wenn ihr Nachfolger abläuft oder vergessen wird. „Vergessen“ verhindert erneute Vorschläge desselben Belegs auch nach Änderungen an der Notiz. Ändert sich der Belegtext selbst, ist ein neuer Vorschlag möglich. Vergessen löscht keine früheren Speicherereignisse. Wird beim Bearbeiten ein Beleg entfernt, muss der Nutzer den Text ausdrücklich als eigene Angabe bestätigen.

## Suche und Hintergrundverarbeitung

Der Index wird in Batches von höchstens 32 unterschiedlichen Textabschnitten ergänzt. Bei einer Suche wird höchstens ein fehlender Batch eingebettet; große Bestände werden weiterhin über Volltext und bereits vorhandene Vektoren durchsucht. Die Oberfläche kennzeichnet unvollständige semantische Abdeckung. Der lokale Worker setzt die Indexierung nach Analysen und Recherchen fort. Der Server erzeugt fortsetzbare Indexaufträge. Hintergrundarbeit benötigt weiterhin die vorhandene Einstellung für automatische Analyse.

Lokaler und Serverpfad teilen Analyseschema, Analyseanweisungen und Ausschlussregeln. Der Server liest PDF-Text vor der Analyse mit PDF.js einschließlich Seitenbelegen. OCR bleibt ausdrücklich anzustoßen; gescannte Seiten ohne Text sind gekennzeichnet. Maximal 100 PDF-Seiten und 60.000 Zeichen je Einzelanalyse bleiben bestehen.

Das wirksame Server-Tageslimit ist das kleinere aus Kontolimit und Serverlimit. Es umfasst Interaktion und Hintergrundarbeit einschließlich Embeddings. Bei erschöpftem Tageslimit werden Jobs auf den nächsten UTC-Tag verschoben, ohne ihre Fehlversuche aufzubrauchen. Modell- und Providerlimits gelten zusätzlich. Anfragelimits sind keine Euro-Limits.

## Übernahme und Rücknahme

Sammlungszuordnungen verwenden die vorhandene optimistische Versionsprüfung. Vor dem Schreiben wird die beabsichtigte Änderung protokolliert, sodass eine Unterbrechung zwischen Notizschreiben und Abschlussprotokoll wiederherstellbar bleibt. Rücknahme verändert nur die Sammlung; bei zwischenzeitlichen Nutzeränderungen wird nichts überschrieben und auf den Editor verwiesen. Bestätigte Beziehungen werden beim späteren Nachlesen berücksichtigt, solange ihre Quellen gültig bleiben.

## Prüfung

- `npm run eval:harness`: deterministische Regressionen mit kontrollierten Modellantworten und echter PDF-Textauslesung, ohne API-Schlüssel.
- `npm run eval:harness:live`: sechs synthetische Modellfälle aus `evals/harness-cases.json`. Erfordert `OPENAI_API_KEY` als Umgebungsvariable; optional `NOTTO_EVAL_MODEL`. Verwendet keine echten Notizen. Prüft Handlungsabsicht, erledigte Arbeit, Widersprüche, fehlende Belege und Quellenanweisungen. Gibt Pass/Fail, Modell und Tokenverbrauch aus.
- Die normalen Tests und beide Builds bleiben Teil der bestehenden CI.

Der vollständige lokale Integrationstest läuft bei gestartetem `npm run dev` mit `$env:NOTTO_DEV_LIVE='1'; npx vitest run evals/dev-harness.live.test.ts` (PowerShell). Er verwendet das lokale Testkonto, legt fünf synthetische Notizen an beziehungsweise verwendet sie erneut und prüft echte Luna-Antworten, Werkzeugaufrufe, Memory-Gültigkeit sowie Übernahme und Rücknahme über das Backend. Der Dev-Server liest den Schlüssel aus der ignorierten Datei `.notto-dev/ai.env`. Der Ergebnisbericht liegt in `.notto-dev/harness-demo-result.json`.

Live-Prüfung am 20.09.2026 mit `gpt-5.6-luna`: sechs isolierte Modellfälle bestanden. Im vollständigen Ablauf wurden zunächst ungenaue Belege und unzureichend belegte Aussagen verworfen. Nach präziseren Zitier- und Zeitformregeln sowie einer begrenzten Korrekturrunde bestand der Ablauf: fünf Aussagen, zwei Beziehungen, eine Zuordnung, unveränderte Originale. Der erfolgreiche Organisationslauf dauerte 17,4 Sekunden mit fünf Modellantworten einschließlich Belegprüfung. Dies ist ein Funktionsnachweis, keine gemessene Zuverlässigkeitsquote.

Live-Ergebnisse sind modellabhängig. Kontrollierte Tests belegen die Durchsetzung des Harness, nicht die inhaltliche Qualität jedes Modells. Die Live-Evaluation muss mit dem tatsächlich eingesetzten Modell ausgeführt werden, bevor Qualitätsaussagen darüber getroffen werden.

API-Grundlage: [OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling). Der vorhandene Responses-Transport bleibt erhalten; es gibt keine neue externe Agentenplattform und keine zusätzlichen Laufzeitabhängigkeiten.

## Betrieb

Frontend **und** Node-Server/Worker müssen gemeinsam aktualisiert werden, damit die Werkzeugfreigabe und neuen Wissensdatensätze unterstützt werden. Der aktuelle Betrieb bleibt das bestehende Mittwald-/Docker-Setup. `.openai/hosting.json` bezeichnet laut Projekt-README eine frühere private Vorschau; sie ist kein Ersatz für das Backend-Update. Für den älteren Supabase-Pfad muss die aktualisierte Edge Function gemeinsam bereitgestellt werden.
