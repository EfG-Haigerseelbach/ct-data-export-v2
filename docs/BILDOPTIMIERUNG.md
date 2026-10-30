# Bilder herunterladen und aufbereiten

Stand: 2026-10-30

## Download

Personen- und Gruppenbilder werden mit dem konfigurierten CT-Dienstbenutzer geladen. Für Personen stammt die Quelladresse aus fileUrl des Avatar-Endpunkts; Gruppen verwenden die vorhandene Bildadresse ihrer CT-Daten.

Der Downloader akzeptiert nur URLs derselben CT-Origin. Er sendet keine CT-Cookies an fremde Hosts, verfolgt keine Redirects und lehnt eingebettete Zugangsdaten sowie login_token in Bild-URLs ab.

Der Bildlauf hat ein Gesamtbudget von 120 Sekunden. Pro Antwort gelten maximal 10 MiB, bei der Dekodierung maximal 20 Millionen Pixel. SVG-Dateien und nicht dekodierbare Inhalte werden abgewiesen. Aufbereitete PNG-Dateien dürfen höchstens 25 MiB groß sein.

## Aufbereitung

Personenbilder werden proportional in die konfigurierte maximale Kantenlänge eingepasst. Standard ist 960 Pixel; erlaubt sind 64–4096 oder 0 für keine Größenreduktion. Kleine Bilder werden nicht vergrößert. Es gibt keinen Beschnitt und keine Streckung.

EXIF-Ausrichtung wird angewendet, Farben werden nach sRGB konvertiert. Die Ausgabe ist PNG mit verlustfreier Kompression, ohne Palettenquantisierung und mit Unterstützung für Transparenz. Es werden keine neuen JPEG-Kompressionsartefakte erzeugt; bei Verkleinerung gehen Bilddetails verloren.

Gruppenbilder werden nicht verkleinert, aber ebenfalls normalisiert. Wenn dieselbe Quelle für Person und Gruppe verwendet wird, entstehen bei Bedarf getrennte Ausgabevarianten.

Die Einstellung unter **Exportkonfiguration → Personenbilder** gilt ab dem nächsten Abruf. Bestehende Archive bleiben unverändert. Die passende Größe richtet sich nach Darstellung, Pixeldichte und WordPress-Theme; 960 Pixel ist ein Anwendungsstandard, keine WordPress-Vorgabe.

## Fehler und SFTP-Sperre

Fehlende URLs, Downloadfehler, unzulässige Quellen und ungültige Bilder erzeugen Fehler mit Datensatz-ID und Code. Der betroffene imageUrl-Wert bleibt leer.

Schon ein Bildfehler sperrt das gesamte Dateipaar für SFTP. Im Manifest stehen uploadAllowed=false sowie die Freigabe je JSON-Datei und die Bildfehler. imageValidation bindet den Prüfstand über Hashes an beide JSON-Inhalte.

Der Abruf kann zur Diagnose erfolgreich archiviert werden und in der Historie als SFTP-gesperrt erscheinen. Erst ein neuer erfolgreicher Abruf kann einen neuen freigegebenen Stand erzeugen. Bereits gespeicherte Fehlermarkierungen werden nicht rückwirkend geändert.

Die öffentliche Bereitstellung erfolgt über die [Bildroute der Anwendung](DATENANSICHT.md#öffentliche-bilder), nicht über die ursprüngliche CT-Adresse.

Implementierung: [Bildaufbereitung](../src/export/local-images.ts), [Download](../src/churchtools/client.ts), [Freigabeprüfung](../src/export/image-validation.ts).

[Dokumentationsübersicht](README.md)
