# Noto 0.11.0

Der neue Notizsekretär untersucht mehrere Notizen, erstellt belegte Übersichten, erkennt Widersprüche und schlägt Beziehungen sowie Sammlungszuordnungen vor. Übernahmen bleiben nachvollziehbar; Sammlungszuordnungen lassen sich zurücknehmen. Originaltexte bleiben erhalten.

- Projektbezogenes Gedächtnis mit Ablauf, Korrekturen und inhaltsbezogener Gültigkeit.
- Kombinierte Wort- und Vektorsuche mit schrittweiser Indexierung und Quellenvielfalt.
- Begrenzte Werkzeugaufrufe, strikte Belegprüfung und höchstens eine Korrekturrunde.
- Gemeinsame Regeln und Anfragebudgets für interaktive KI und Hintergrundarbeit.
- Sammlungen, Notizgestaltung und erweiterte Editor-Werkzeuge.
- Lokale Entwicklungsinstanz mit isoliertem Testkonto und optionaler KI-Verbindung.

Geprüft mit automatisierten Frontend-/Backend-Tests, Rust-Tests und Live-Fällen mit GPT-5.6 Luna. Modellantworten bleiben fehleranfällig; nicht belegte Ergebnisse werden verworfen. Der Windows-Installer ist wie bisher nicht mit einem Code-Signing-Zertifikat signiert.

Web-App und Hintergrundworker werden gemeinsam aktualisiert. Bestehende Konten, Notizen und Servereinstellungen bleiben erhalten.
