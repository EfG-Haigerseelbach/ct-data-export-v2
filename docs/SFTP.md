# SFTP-Upload

Stand: 2026-10-30

## Einrichtung

Die Anwendung überträgt auf Benutzeraktion zwei JSON-Dateien. Der Zielserver darf getrennt vom Anwendungsserver betrieben werden.

| Variable | Bedeutung |
| --- | --- |
| SFTP_HOST | Servername; leer deaktiviert SFTP |
| SFTP_PORT | Dienstport, Standard 22 |
| SFTP_USERNAME | SFTP-Konto |
| SFTP_DIRECTORY | Absoluter Elternpfad von current aus Sicht dieses Kontos |
| SFTP_HOST_FINGERPRINT | Verifizierter Hostschlüssel als SHA256-Fingerabdruck |
| SFTP_PASSWORD | Passwortanmeldung |
| SFTP_PRIVATE_KEY_PATH | Alternativ: lokale private Schlüsseldatei |
| SFTP_PRIVATE_KEY_PASSPHRASE | Optional: Passphrase des Schlüssels |

Genau eine Anmeldemethode verwenden: Passwort oder private Schlüsseldatei. Der Fingerabdruck muss vom tatsächlich verwendeten Dienst stammen; ein anderer Port kann einen anderen Dienst und Hostschlüssel verwenden.

~~~dotenv
SFTP_HOST=sftp.example.org
SFTP_PORT=22
SFTP_USERNAME=export-upload
SFTP_DIRECTORY=/
SFTP_HOST_FINGERPRINT=SHA256:<verifizierter-Fingerabdruck>
SFTP_PASSWORD=<eigenes-Passwort>
~~~

Platzhalter ersetzen. .env explizit laden und nach Änderungen neu starten. Eine unvollständige aktivierte SFTP-Konfiguration verhindert den Start mit einer feldbezogenen Meldung.

## Verbindung prüfen

**SFTP-Verbindung prüfen** bestätigt Hostidentität, Anmeldung und Verbindungsaufbau. Es werden keine Dateien geschrieben oder Ordner angelegt. Zielpfad und Schreibrechte werden dabei nicht geprüft.

Datum und Uhrzeit der letzten erfolgreichen Prüfung stehen auf der Seite. Der Wert bleibt bei fehlgeschlagenen Folgeprüfungen erhalten und wird beim Neustart zurückgesetzt. Der Test arbeitet asynchron und benötigt keine CT-Daten.

## Zielstruktur und Upload

Im Ziel muss current bereits als erreichbares Verzeichnis existieren. Bei SFTP_DIRECTORY=/ sind die einzigen Schreibziele:

~~~text
/current/groups.json
/current/contactPersons.json
~~~

Der Upload überschreibt beide Dateien nacheinander direkt mit Schreibmodus w. Die Anwendung legt keine entfernten Ordner, Archive oder temporären Dateien an und benennt nichts um. Bei Neuanlage fordert sie Modus 0600 an; PHP-Leserechte müssen serverseitig passend eingerichtet sein.

Ein erreichbarer Verzeichnis-Symlink ist möglich, wird aber nicht ersetzt. Innerhalb einer eingeschränkten Kontowurzel kann ein absoluter Hostpfad als Linkziel unerreichbar sein. Alternativen und Rechte: [Serverbetrieb](SERVER.md#sftp-kontosicht-und-dateirechte).

Der Upload verwendet den aktuellen Datenstand der angemeldeten Sitzung. Voraussetzung sind eine passende Konfigurationsrevision und ein durch erfolgreiche Bildverarbeitung freigegebenes JSON-Paar. Gesperrte Daten werden vor dem Verbindungsaufbau abgewiesen.

Ein Upload startet keinen WordPress-Import und ändert keine Importquelle. Bilder werden nicht per SFTP übertragen; ihre URLs verweisen auf die Anwendung.

## Fehler und Koordination

Das Überschreiben ist keine atomare Transaktion. Ein Fehler kann bereits aktualisierte oder nur teilweise geschriebene Dateien hinterlassen. Nach Behebung beide Dateien erneut hochladen und erst nach vollständigem Erfolg importieren.

Nicht während laufender WordPress-Importe hochladen. Verbindungsprüfung und Upload teilen sich eine Sperre innerhalb dieses Anwendungsprozesses; fremde Prozesse und WordPress werden dadurch nicht gesperrt.

Nach Anmeldung prüft stat die Erreichbarkeit des Zielverzeichnisses. Fehlermeldungen nennen den Schritt: Verbindung, Zugriff auf current oder Schreiben einer der Dateien. Hinweise für fehlenden Pfad und verweigerten Zugriff enthalten keine rohen Serverfehler oder Zugangsdaten.

Bei Pfadfehlern die tatsächliche SFTP-Sicht mit demselben Konto und Port prüfen:

~~~text
pwd
ls -la /
cd /current
ls -la
~~~

SFTP_DIRECTORY enthält den Elternpfad, nicht nochmals current. Bei Schreibfehlern insbesondere Rechte der vorhandenen JSON-Dateien prüfen; ein Eigentümerwechsel am Verzeichnis oder Link allein genügt nicht.

Verbindungsaufbau: maximal 15 Sekunden. Uploadlauf: ungefähr 120 Sekunden bis zum erzwungenen Verbindungsabbruch. Es gibt keine automatische Upload-Wiederholung.

Implementierung: [SFTP-Adapter](../src/transfer/sftp.ts).

[Dokumentationsübersicht](README.md)
