# Weboberfläche einrichten und verwenden

Stand: 2026-10-30

## Installation

Node.js 24 und npm werden benötigt. In PowerShell aus der Repository-Wurzel:

~~~powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run user:create
~~~

Unter Linux/macOS npm statt npm.cmd und cp statt Copy-Item verwenden. In PowerShell vermeidet npm.cmd die Ausführung von npm.ps1.

Der Einrichtungsbefehl fragt Benutzername und Passwort zweimal ab. Passwörter müssen 12 bis 256 Zeichen enthalten. Das Konto liegt mit Salt und scrypt-Passworthash in config/local.json; es ist unabhängig von ChurchTools, SFTP und WordPress. Ein bestehendes Konto wird nicht überschrieben.

Die private .env befüllen und den Server mit explizit geladener Umgebung starten:

~~~powershell
node --env-file=.env --import tsx src/web/main.ts
~~~

Für den kompilierten Betrieb:

~~~powershell
npm.cmd run build
node --env-file=.env dist/src/web/main.js
~~~

npm start und npm run start:built laden .env nicht automatisch. Bereits im Prozess gesetzte Umgebungsvariablen haben beim Node-Aufruf Vorrang vor Werten aus der Umgebungsdatei.

Standardadresse: [http://127.0.0.1:3000](http://127.0.0.1:3000). Mit Strg+C wird der Server beendet.

## Allgemeine Einstellungen

| Variable | Bedeutung |
| --- | --- |
| PORT | Lokaler Port, Standard 3000 |
| APP_HEADER_LABEL | Optionaler Name im Kopfbereich; leer blendet ihn aus |
| APP_PUBLIC_BASE_URL | Von WordPress erreichbare Adresse für Bild-URLs; lokal standardmäßig http://127.0.0.1:PORT |
| CT_WEB_SECURE_COOKIE | Für HTTPS-Betrieb true setzen; Standard false |
| CT_EXPORT_DIRECTORY | Optionaler Ordner für die separate Dateiprüfung; Standard var/import |

APP_HEADER_LABEL wird getrimmt und ausschließlich als maskierter Text ausgegeben:

~~~dotenv
APP_HEADER_LABEL="Meine Organisation"
~~~

Nach Änderungen an Umgebungsvariablen ist ein Neustart erforderlich. Über die Oberfläche gespeicherte [Exporteinstellungen](EXPORTKONFIGURATION.md) gelten dagegen unmittelbar für nachfolgende Abrufe.

## Seiten

- **Übersicht:** ChurchTools-Verbindung prüfen und konfigurierte externe JSON-Dateien prüfen.
- **Konfiguration:** CT_BASE_URL, Zustand des Tokens sowie ausgewählte SFTP-Umgebungswerte ansehen. Token, Passwort und Schlüssel werden nicht angezeigt.
- **Exportkonfiguration:** Feldpfade, E-Mail-Label, Bildgröße und WordPress-Import-URLs bearbeiten; Daten manuell abrufen.
- **Abgerufene Daten:** Gruppen, Personen, technische JSON-Ansichten und Abrufhistorie ansehen.
- **Warnungen:** Fehlende Ansprechpartner zentral nachverfolgen.
- **SFTP-Upload:** Verbindung testen oder den aktuellen freigegebenen Datenstand übertragen.
- **Import in WordPress:** Die zwei eingerichteten Importaufträge getrennt starten und überwachen.

CT-Verbindungstest, manuelle Auswahlprüfung und Speichern der Konfiguration arbeiten mit JavaScript ohne vollständiges Neuladen. Während eines CT-Vorgangs ist der Verbindungsbutton gesperrt; sein Zustand wird lokal abgefragt und nach Abschluss aktualisiert. Der Startabruf richtet sich nach der [30-Minuten-Regel](DATENANSICHT.md#startabruf-und-wiederverwendung).

## Anmeldung und Hosting

Der Server lauscht auf 127.0.0.1 und unterstützt ein Verwaltungskonto. Sitzungen liegen im Arbeitsspeicher und enden nach einer Stunde, beim Abmelden oder Neustart. Abmelden steht im gemeinsamen Kopfbereich; daneben erscheinen die Benutzerinitialen mit vollständigem Benutzernamen im Tooltip.

Cookies verwenden HttpOnly und SameSite=Strict, bei CT_WEB_SECURE_COOKIE=true zusätzlich Secure. Schreibende Formulare sind durch CSRF-Token geschützt. Nach erfolgreicher Anmeldung werden Sitzung und Token erneuert. Nach fünf Anmeldeversuchen pro Verbindungs-IP gilt eine Sperre bis zum Ablauf des 15-Minuten-Fensters.

Für externen Betrieb einen HTTPS-Reverse-Proxy einrichten. Weitergeleitete IP-Header werden nicht als Clientidentität vertraut; hinter einem Proxy teilen sich Anfragen gegebenenfalls dessen Anmeldelimit. Hinweise zum Betrieb: [Serveranleitung](SERVER.md).

## Fehlende Konfiguration

Ohne vollständige, nicht leere CT_BASE_URL und CT_API_TOKEN startet die Weboberfläche ohne CT-Adapter. Mit beiden Werten werden URL und Limits validiert; ungültige vollständige Werte verhindern den Start.

Startfehler nennen unter anderem fehlende/ungültige Kontodaten, unzulässigen oder belegten Port, ungültige CT-Einstellungen und fehlerhafte Cookie-/Bild-URL-Konfiguration. Liegt kein lokaler Zugang vor, zuerst user:create ausführen. Änderungen außerhalb der Oberfläche werden erst nach einem Neustart geladen.

[Dokumentationsübersicht](README.md)
