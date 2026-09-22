# Notto 0.2: Wissen, Dateien und KI

**Für den aktuellen Mittwald-Betrieb ab Version 0.3 gilt [SELF-HOSTING.md](SELF-HOSTING.md).** Die folgende Supabase-Anleitung dokumentiert ausschließlich den früheren Stand. Im neuen Betrieb werden keine Supabase-Schlüssel benötigt.

## Desktop (Windows und Linux)

In der Seitenleiste **Wissen & KI → KI einrichten** öffnen. Den eigenen OpenAI-API-Schlüssel hinterlegen und KI aktivieren. Der Schlüssel liegt im Anmeldedatenspeicher des Systems; er wird weder in Markdown noch in Browser-Speicher, Backups oder der Cloud gespeichert. Standardmodell: `gpt-4.1-mini`, Embeddings: `text-embedding-3-small`, Audio: `gpt-transcribe`. Zugriff auf die Modelle hängt vom API-Konto ab.

Hintergrundanalyse ist separat aktivierbar und läuft bei geöffneter Hauptanwendung. Pro neuer Notizfassung entsteht eine Analyse. Fehler stoppen diese Fassung für die aktuelle Sitzung; „Neu analysieren“ versucht sie erneut. Der Standardtag `#privat` und einzeln ausgeschlossene Notizen bleiben außen vor. KI ist standardmäßig aus. Recherche startet gezielt oder nach gesonderter Aktivierung automatisch für Aufgaben und Kontaktkandidaten. OCR wird gezielt gestartet. Alle API-Aufrufe zählen gegen das lokale Tageslimit (auch Fehlversuche); dies ist kein Euro-Kostenlimit.

## Web und geräteübergreifendes Wissen

1. Die bestehende Supabase-Verbindung wie im README unter „Cloud einrichten“ konfigurieren.
2. Zusätzlich `supabase/migrations/202609190002_intelligence.sql` im Supabase SQL-Editor ausführen. Sie erlaubt PDF-Anhänge und ergänzt eine separate, per RLS geschützte Wissensebene.
3. Die Supabase CLI mit dem Projekt verbinden und `supabase functions deploy notto-ai` ausführen.
4. In den Supabase Edge Function Secrets `OPENAI_API_KEY` hinterlegen. `NOTTO_AI_USERS` enthält eine kommagetrennte Liste freigegebener Auth-Benutzer-UUIDs. Ohne diese Freigabe kann niemand den Server-Schlüssel verwenden. Optional `NOTTO_AI_MODELS` als Modell-Allowlist setzen (Standard: `gpt-4.1-mini,text-embedding-3-small`). Niemals einen API-Schlüssel als `VITE_*` Variable eintragen.
5. In Notto anmelden, KI für das betreffende Notizbuch aktivieren. Analysen und Entscheidungen werden nach Änderungen und spätestens jede Minute bei geöffneter Hauptanwendung synchronisiert. „Wissen synchronisieren“ startet dies zusätzlich manuell. Originalnotizen behalten ihren bisherigen automatischen Sync.

Der Server erlaubt höchstens 100 Anfragen pro Benutzer und UTC-Tag. Die lokale Grenze kann niedriger sein. Der Proxy akzeptiert ausschließlich Responses, Embeddings und Transkription, limitiert Ausgabe und Web-Aufrufe und setzt `store:false`. Eine dauerhafte serverseitige Jobverarbeitung ist in dieser Version nicht enthalten.

## Verhalten und Grenzen

- Bilder und PDFs bis 12 MB, als unveränderte Anhänge, einschließlich älterer Versionen im ZIP-Export. PDFs sind direkt in Notto seitenweise sichtbar und speicherbar.
- PDF-Text wird lokal mit PDF.js extrahiert (maximal 100 Seiten). OCR über OpenAI liest Bilder und höchstens fünf gescannte PDF-Seiten pro Dokument. Erkannte Texte sind überprüfbare Ableitungen, keine Änderungen am PDF oder Notiztext. Nach einer neuen Extraktion eine vorhandene Analyse erneut starten.
- Aufgaben, Kontakte und Themen werden als unbestätigte Vorschläge mit wörtlichem Beleg gespeichert. Erledigen, Ablehnen und Korrigieren erzeugen eigene Ereignisse. Erneute Analysen gleicher Belegstellen behalten diese Entscheidungen. Ändert sich die zitierte Passage, entsteht ein neuer Vorschlag; ältere Entscheidungen bleiben sichtbar und exportierbar.
- Themen mit gleichem Namen werden zusammen angezeigt. Automatische semantische Zusammenführung ähnlich benannter Themen und Kontakt-Dubletten ist noch nicht enthalten.
- Kontaktrecherche zeigt öffentliche Quellen und Kandidaten. Daten werden nicht ungeprüft in ein Adressbuch geschrieben. Bestätigte Angaben lassen sich über „Korrigieren“ übernehmen.
- Semantische Suche verwendet zwischengespeicherte Embeddings; maximal 1.000 Textabschnitte je Suche. Bei großen Beständen ist die erste Indexierung schrittweise wiederholbar, wenn das Tageslimit erreicht wird. Antworten validieren Quellenindex und wörtliches Zitat; fehlende Belege ergeben eine ausdrückliche Nicht-Antwort. Dies prüft die Existenz der Belege, nicht automatisch jede semantische Schlussfolgerung.
- Ausschlüsse gelten auf diesem Gerät. Bereits erzeugte Ableitungen bleiben im eigenen Speicher; sie werden bei der Suche ausgeblendet. Bereits übermittelte API-Inhalte lassen sich durch einen späteren Ausschluss nicht zurückholen.
- Diktat: Mikrofonfreigabe, maximal drei Minuten, anschließend Transkription prüfen und explizit einfügen. Audio bleibt nur vorübergehend im Arbeitsspeicher; Abbrechen verwirft es. Bereits gestartete API-Anfragen können noch Kosten verursachen.

Ohne konfigurierte Zugangsdaten funktionieren Notizen, PDFs, Vorschau, Export und lokale PDF-Textextraktion. Echte KI-Ausgaben und Live-Cloud-Sync müssen mit dem eigenen Konto geprüft werden; automatisierte Tests verwenden kontrollierte API-Antworten.

## Implementierungsreferenzen

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Embeddings](https://developers.openai.com/api/docs/guides/embeddings)
- [Transkription](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Websuche](https://developers.openai.com/api/docs/guides/tools-web-search)
- [PDF.js](https://mozilla.github.io/pdf.js/examples/)
- [Keyring 3](https://docs.rs/keyring/3.6.3/keyring/)
