# ChurchTools-Adapter im Anwendungscode

Stand: 2026-10-30

## Bibliotheken und Zuständigkeiten

Der serverseitige Adapter verwendet @churchtools/churchtools-client mit axios-cookiejar-support und tough-cookie. Die konkret installierten Versionen stehen in [package.json](../package.json) und [package-lock.json](../package-lock.json). Die Anwendung verwendet Node.js 24 und TypeScript/ESM.

| Modul | Aufgabe |
| --- | --- |
| src/churchtools/config.ts | CT-URL, Token und Transportlimits validieren |
| src/churchtools/client.ts | Authentifizierung, Sitzung, Abfragen, Pagination und Downloads |
| src/churchtools/schemas.ts | Mindeststruktur externer Antworten validieren |
| src/export/selection.ts | Freigaben, Beziehungen und Stammdaten auswerten |
| src/export/person-json.ts | Personenformat und E-Mail-Auswahl |
| src/export/local-images.ts | Bilder prüfen, aufbereiten und URLs umschreiben |
| src/export/json-archive.ts | Vollständigen lokalen Abruf archivieren und wiederherstellen |
| src/web/server.ts | Angemeldete Aktionen, Startabruf und Rückmeldungen koordinieren |

CT-Zugangsdaten und CookieJar verbleiben auf dem Server. SDK-Typen ersetzen keine Laufzeitprüfung; eigene CT-Felder werden an den benötigten Stellen ausgewertet.

## Öffentliche Methoden

ChurchToolsApi bietet checkConnection(), getGroups(), getPersons(ids?), getMasterData(), readSnapshot() und downloadImages(urls).

readSnapshot() kann Funktionen zur Ermittlung der benötigten Ansprechpartner- und Avatar-IDs erhalten. Der Webablauf verwendet diese Funktionen mit einem festen Konfigurationsstand. Ohne ID-Planung stellt die Methode einen allgemeinen Snapshot bereit.

getPersons([]) liefert ohne Fachabfrage eine leere Liste; getPersons(ids) unterstützt höchstens 100 positive IDs pro Aufruf und liest auch dann alle Seiten. Der Snapshotablauf zerlegt größere Ansprechpartnerlisten in Pakete.

Öffentliche Operationen erzeugen getrennte SDK-Instanzen mit CookieJar und Abbruchbudget. Anmeldung wird durch /whoami bestätigt. Die Anwendung kontrolliert Wiederanmeldung, begrenzte Retries, Antwortgrößen und Seitenlimits selbst.

downloadImages() verwendet einen getrennten authentifizierten Lauf. Es werden nur URLs derselben CT-Origin akzeptiert; Redirects und URLs mit eingebetteten Zugangsdaten oder login_token sind ausgeschlossen.

## Tests und Änderungen

Die Tests unter test/churchtools.test.ts verwenden die installierte Bibliothek gegen lokale HTTP-Nachbildungen. Sie prüfen insbesondere Login, Pagination, ID-Pakete, Fehler, Zeitgrenzen und Redirect-Verweigerung.

Bei Änderungen am Adapter Typprüfung, Tests und Build ausführen. Authentifizierungsheader, Query-Token, CookieJar und rohe Transportfehler nicht an die Oberfläche oder ungefiltert in Logs weiterreichen.

[Zugang konfigurieren](CT-API.md) · [Repository und Prüfungen](REPOSITORY.md)
