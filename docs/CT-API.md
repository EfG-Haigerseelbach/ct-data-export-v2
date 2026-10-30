# ChurchTools-Zugang

Stand: 2026-10-30

## Dienstzugang einrichten

Die Anwendung verwendet einen ChurchTools-Login-Token eines Dienstbenutzers. Der Dienstbenutzer benötigt Leserechte für die verwendeten Gruppen, Personen, eigenen Felder, Stammdaten und Bilder. Berechtigungen werden nicht umgangen.

~~~dotenv
CT_BASE_URL=https://organisation.example.church.tools
CT_API_TOKEN=
~~~

Den eigenen Token lokal eintragen. CT_BASE_URL ist die HTTPS-Instanzadresse ohne /api, Query, Fragment oder eingebettete Zugangsdaten. Der Client ergänzt den API-Pfad. Token nicht mit dem Passwort des lokalen Verwaltungskontos verwechseln.

Die private .env wird explizit geladen:

~~~powershell
node --env-file=.env --import tsx src/churchtools/cli.ts
~~~

Alternativ Umgebungsvariablen vorab im Terminal setzen und npm.cmd run ct:check ausführen. Nach dem Build lautet der CLI-Einstieg dist/src/churchtools/cli.js.

Der Verbindungstest prüft Anmeldung und Identität, nicht sämtliche Leserechte oder Exportfelder. Für einen vollständigen Abruf **Exportkonfiguration → Auswahl mit ChurchTools prüfen** verwenden.

## Ablauf

Der Adapter meldet sich mit dem Token an und prüft eine positive Personen-ID über /whoami. Fachabfragen lesen /groups, /persons und /person/masterdata mit begrenzter Pagination. Ansprechpartner ausgewählter Gruppen werden zusätzlich gezielt nach IDs abgefragt; siehe [Personenabfragen](ANSPRECHPARTNER.md).

Für ausgewählte Personen wird imageUrl aus fileUrl der Antwort von /files/avatar/{personId} ermittelt. Der weitere Bilddownload erfolgt authentifiziert mit dem Dienstbenutzer; die Anwendung stellt anschließend eigene Bild-URLs bereit. Die CT-Datei-URL muss deshalb nicht anonym erreichbar sein. Details: [Bildoptimierung](BILDOPTIMIERUNG.md).

Eine öffentliche Adapteroperation besitzt eine eigene Client-Instanz mit CookieJar. Ein Snapshot hält Abfragen in einer Sitzung zusammen, ist aber keine Datenbanktransaktion in ChurchTools. Änderungen an CT-Daten während des Abrufs sind möglich.

## Limits

| Variable | Standard | Zulässiger Bereich |
| --- | --- | --- |
| CT_REQUEST_TIMEOUT_MS | 15000 | 50–60000 ms pro Anfrage |
| CT_OPERATION_TIMEOUT_MS | 60000 | 50–300000 ms pro Adapteroperation |
| CT_MAX_PAGES | 100 | 1–1000 Seiten je Sammlung |
| CT_PAGE_SIZE | 100 | 1–100 Datensätze je Seite |
| CT_MAX_RETRIES | 2 | 0–3 zusätzliche Wiederholungen |

429 berücksichtigt Retry-After; auch Wartezeiten unterliegen dem Operationsbudget. Geeignete Leseanfragen mit 429/502/503/504 werden begrenzt wiederholt. Eine nachträglich abgelaufene CT-Sitzung wird bei 401 einmal erneuert. Dauerhafte Authentifizierungsfehler und 403 bleiben Fehler; nicht lesbare einzelne Gruppenkontakte können separat als Warnung behandelt werden.

Redirects werden nicht verfolgt. Antwortgrößen, Seitengrenzen, doppelte IDs und unerwartete Antwortformen werden geprüft. Bilddownloads haben ein eigenes Gesamtbudget von 120 Sekunden und maximal 10 MiB pro Bild.

## Fehler und Protokolle

CT_AUTH, CT_FORBIDDEN, CT_RATE_LIMIT, CT_TIMEOUT, CT_RESPONSE, CT_NETWORK, CT_PAGE_LIMIT und CT_HTTP benennen die Fehlerklasse. Auswahlfehler nennen technische IDs und Feldpfade; fehlende Ansprechpartner erscheinen in der [Warnungsliste](WARNUNGEN.md).

Die Anwendung gibt keine rohen Axios-Fehler oder vollständigen API-Antworten aus. Der CT-Client verwendet beim Token-Login einen Query-Parameter. Proxy-, Zugriffs- und Debuglogs müssen entsprechend behandelt werden.

Implementierung: [CT-Adapter](../src/churchtools/client.ts), [Konfiguration](../src/churchtools/config.ts), [Eingabeschemas](../src/churchtools/schemas.ts).

[Dokumentationsübersicht](README.md)
