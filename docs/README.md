# Dokumentation

Stand: 2026-10-30

Diese Dokumentation beschreibt den implementierten Stand der Anwendung. Alle Befehle werden aus der Repository-Wurzel ausgeführt; alle lokalen Pfade beziehen sich darauf. Domains, Konten und Installationspfade in Beispielen müssen durch eigene Werte ersetzt werden.

## Einrichtung und Bedienung

- [Weboberfläche](WEB.md): Installation, Anmeldung, Umgebungsvariablen und Seiten.
- [ChurchTools-Zugang](CT-API.md): Dienstzugang, Leserechte, Limits und Fehler.
- [Exportkonfiguration](EXPORTKONFIGURATION.md): Auswahlfelder, E-Mail-Auswahl, Bildgröße und Import-URLs.
- [Ansprechpartner](ANSPRECHPARTNER.md): Gruppenauswahl, gezielte Personenabfragen und Exportfelder.
- [Datenansicht und Archive](DATENANSICHT.md): Startabruf, Historie, JSON-Dateien und öffentliche Bilder.
- [Bildoptimierung](BILDOPTIMIERUNG.md): Format, Größe und Uploadsperre.
- [Warnungen](WARNUNGEN.md): Nicht auflösbare Ansprechpartner erkennen und bearbeiten.
- [SFTP-Upload](SFTP.md): Verbindung, Zielpfade und Überschreiben.
- [WordPress-Import](WORDPRESS-IMPORT.md): Importaufträge konfigurieren, starten und überwachen.

## Betrieb und Entwicklung

- [Serverbetrieb](SERVER.md): Deployment, HTTPS, persistente Daten und SFTP-Kontosicht.
- [CT-Adapter](CT-CLIENT.md): Bibliothek, Modulgrenzen und Ablauf.
- [Repository](REPOSITORY.md): private Dateien, Prüfungen und optionaler JSON-Prüfer.

Die Anwendung betreibt einen einzelnen Node-Prozess und unterstützt ein lokales Verwaltungskonto. Auswahl, Dateiformate, Importzuordnung und Berechtigungen müssen auf der eigenen ChurchTools- und WordPress-Installation eingerichtet werden.
