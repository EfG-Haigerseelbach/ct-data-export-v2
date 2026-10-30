# WordPress-Import konfigurieren und überwachen

Stand: 2026-10-30

Die Seite **Import in WordPress** steuert zwei WP-All-Import-Aufträge: Ansprechpartner und Angebote. Die Aufträge selbst, ihre Dateiquellen und Feldzuordnungen müssen in WordPress eingerichtet sein.

## Vollständige Import-URLs

Unter **Exportkonfiguration → Import in WordPress** je Auftrag eine trigger- und eine processing-URL hinterlegen. Neutrales Beispiel für einen Auftrag:

~~~text
https://wordpress.example/wp-load.php?import_key=EIGENER_SCHLUESSEL&import_id=12&action=trigger
https://wordpress.example/wp-load.php?import_key=EIGENER_SCHLUESSEL&import_id=12&action=processing
~~~

Die ID muss die tatsächliche ID des jeweiligen Auftrags sein. Bei WordPress in einem Unterverzeichnis muss der Pfad zu dessen wp-load.php führen. Zusammengehörige URLs benötigen gleichen Host, Pfad, Key und ID; die action unterscheidet sich.

Der Server liest die tatsächlichen IDs aus den URLs. Die internen Kennungen 5/6 bezeichnen lediglich die beiden Zuordnungen Ansprechpartner/Angebote, solange vollständige URL-Paare konfiguriert sind.

Geänderte URLs werden über processing geprüft. Erwartet wird eine JSON-Antwort mit status=403 und message:

~~~text
Import #<ID> is not triggered. Request skipped.
~~~

HTTP 200 oder 403 ist bei genau diesem Inhalt zulässig. Unbekannte Antworten, andere IDs, HTML, Weiterleitungen und Authentifizierungsfehler verhindern die Übernahme. Alte Werte bleiben aktiv.

processing ist kein rein lesender Ping: Läuft bereits ein Import, kann die Probe dessen Verarbeitung fortsetzen. URLs deshalb nur bei inaktiven Aufträgen ändern. Während laufender oder unklarer Importe ist die URL-Konfiguration gesperrt.

## Optionaler Umgebungs-Fallback

Für noch leere URL-Paare können WP_IMPORT_ENDPOINT und WP_IMPORT_KEY verwendet werden:

~~~dotenv
WP_IMPORT_ENDPOINT=https://wordpress.example/wp-load.php
WP_IMPORT_KEY=<eigener-Import-Key>
~~~

Dieser Weg verwendet die Remote-Import-IDs 5 für Ansprechpartner und 6 für Angebote. Für andere IDs vollständige URLs in der Oberfläche konfigurieren.

Ist WP_IMPORT_KEY gesetzt, muss WP_IMPORT_ENDPOINT eine explizite, nicht leere HTTPS-URL ohne Query, Fragment oder eingebettete Zugangsdaten sein. Es gibt keinen festen Host-Fallback. Ohne Key ist der Umgebungs-Fallback deaktiviert; vollständig gespeicherte URL-Paare funktionieren unabhängig davon.

Die vier URLs liegen in config/export.json und enthalten den geheimen Import-Key. Die Datei gehört nicht ins Repository. Nur angemeldete Verwalter dürfen die Exportkonfiguration sehen.

## Start und Verarbeitung

Nach einem vollständigen SFTP-Upload sicherstellen, dass beide WordPress-Importquellen denselben Datenstand lesen. Dann jeden gewünschten Auftrag über **Import starten** auslösen.

Die Anwendung sendet trigger einmal und danach processing. Bei Fortschritt erfolgt die nächste Verarbeitung nach zwei Minuten; die Überwachung ist auf 60 Schritte begrenzt. Beide Aufträge haben getrennte Zustände und können unabhängig gestartet werden. Es wird keine Reihenfolge erzwungen.

Die Oberfläche zeigt laufenden Zustand, letzten Start, letzten bestätigten Abschluss und dessen Ergebnis. Ein laufender Auftrag lässt sich nicht erneut starten. Die Verarbeitung läuft auch nach Verlassen der Seite oder Abmelden weiter.

Die Anwendung führt keinen SFTP-Upload automatisch aus, ändert keine WordPress-Dateiquelle und konfiguriert keine Felder oder Löschregeln im Plugin.

## Abschlussnachweis

Nur die erwartete JSON-Meldung mit status=200 bestätigt einen Abschluss:

~~~text
Import #<ID> complete
~~~

HTTP 200 allein, Fortschrittszähler und is not triggered sind kein Abschlussnachweis. already processing wird als weiterhin laufend behandelt. Ein eindeutig gemeldeter Abbruch wird als fehlgeschlagen protokolliert.

Bei Timeout oder unbekannter/übersetzter Antwort gilt **Abschluss unklar**. Die Anwendung sendet keinen erneuten trigger. **Verarbeitung erneut prüfen** nutzt ausschließlich processing. Bleibt der Zustand unklar, in WordPress kontrollieren.

Ein technischer Abschluss bestätigt nicht, dass alle Beiträge, Felder und Bilder fachlich korrekt importiert wurden. Dazu Pluginprotokolle, Statistiken und die angezeigten Inhalte prüfen.

## Persistenz

var/wordpress-imports.json bewahrt Zustände und letzten bestätigten Abschluss ohne Import-Key. Nach Neustart wird ein zuvor laufender Import als unklar behandelt und kann über processing wieder aufgenommen werden.

Fehler beim Speichern verhindern eine sichere neue Startfreigabe. Es darf nur ein Anwendungsprozess dieselbe Statusdatei verwalten. Externe Cronjobs können zusätzlich auf WordPress zugreifen und müssen betrieblich abgestimmt sein.

Implementierung: [Importsteuerung](../src/wordpress/imports.ts), [URL-Validierung](../src/wordpress/urls.ts).

[SFTP-Upload](SFTP.md) · [Dokumentationsübersicht](README.md)
