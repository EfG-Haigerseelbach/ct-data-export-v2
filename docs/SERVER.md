# Serverbetrieb

Stand: 2026-10-30

Anwendung, WordPress und SFTP dürfen auf einem gemeinsamen oder auf getrennten Servern laufen. Alle folgenden Pfade und Konten sind Beispiele. Systemadministration und Anwendungskonto sind getrennt zu behandeln.

## Anwendung installieren

Node.js 24, npm und ein unprivilegiertes Anwendungskonto bereitstellen. Repository beispielsweise nach /srv/ct-data-export auschecken. Im Repository-Verzeichnis unter dem Anwendungskonto:

~~~bash
npm ci
cp .env.example .env
npm run user:create
npm run check
npm run build
~~~

Die .env mit eigenen Werten befüllen und auf diesem Linux-System nur für das Anwendungskonto lesbar halten:

~~~bash
chmod 600 .env
node --env-file=.env dist/src/web/main.js
~~~

config/ und var/ müssen für das Anwendungskonto schreibbar sein. npm ci muss für Entwicklung, Tests und Build die Entwicklungsabhängigkeiten einschließen. Der kompilierte Webserver wird danach direkt mit Node gestartet.

## Prozessdienst

Beispiel einer systemd-Unit; User, Arbeitsverzeichnis und Node-Pfad an die Installation anpassen:

~~~ini
[Unit]
Description=ChurchTools data export
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=export-app
WorkingDirectory=/srv/ct-data-export
ExecStart=/usr/bin/node --env-file=.env dist/src/web/main.js
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=multi-user.target
~~~

Das Konto export-app muss bereits vorhanden sein und die Anwendung sowie ihre privaten Dateien lesen können. Die Unit als eigene Datei in der Dienstverwaltung installieren und dort aktivieren. Nur einen Prozess pro Zustandsverzeichnis betreiben.

Bei Updates config/, var/ und die private .env erhalten. Nach Installation/Build den Dienst neu starten und Anmeldung, Bildroute und Verbindungen prüfen.

## HTTPS und öffentliche Bilder

Der Node-Server lauscht auf 127.0.0.1:PORT. Für externen Zugriff einen HTTPS-Reverse-Proxy auf diesen Port einrichten. Die folgenden Werte gehören in die private Umgebung:

~~~dotenv
PORT=3000
CT_WEB_SECURE_COOKIE=true
APP_PUBLIC_BASE_URL=https://export.example.org
~~~

APP_PUBLIC_BASE_URL muss von WordPress aus erreichbar sein. Der Proxy muss auch /media/... an die Anwendung weiterleiten. Ohne eine erreichbare Bildroute können JSON-Dateien hochgeladen werden, WordPress kann ihre Bilder aber nicht beziehen.

Quellverzeichnis, .env, config/ und var/ niemals pauschal als statischen Webinhalt ausliefern. Die Anwendung stellt nur bekannte Bilder öffentlich bereit; Verwaltungsseiten und JSON-Ansichten erfordern Anmeldung.

## SFTP-Kontosicht und Dateirechte

Ein eigenes Dateikonto mit möglichst enger Zielberechtigung verwenden. Den tatsächlichen SFTP-Dienst, Port und Hostschlüssel prüfen. Hosting-Verwaltungen können für Dateikonten einen anderen Dienstport als für administrative SSH-Shells bereitstellen.

Die Anwendung schreibt ausschließlich SFTP_DIRECTORY/current/groups.json und contactPersons.json. Bei einem auf sein Home eingeschränkten Konto kann dieses Home als / erscheinen. Dann muss current innerhalb dieser Sicht erreichbar sein und SFTP_DIRECTORY=/ lauten.

Das Konto benötigt Such-/Betretungsrechte auf den Elternverzeichnissen und Schreibrechte auf beiden vorhandenen Dateien. Für die Neuanlage einer Datei sind zusätzlich Schreibrechte im Zielverzeichnis nötig. PHP/WordPress muss die JSON-Dateien danach lesen können. Die Anwendung fordert bei neu angelegten Dateien Modus 0600 an.

Ein Symlink auf einen absoluten Hostpfad kann innerhalb einer eingeschränkten SFTP-Wurzel ins Leere zeigen. Eigentumsänderungen am Link ändern nicht die Erreichbarkeit seines Ziels.

## Optional: gemeinsamer Ordner per Bind-Mount

Wenn SFTP und WordPress auf demselben Linux-Host laufen, kann ein Bind-Mount den privaten Importordner in der Kontosicht bereitstellen. Beispiel:

~~~text
/srv/wordpress-import/          eigentliche JSON-Dateien
/srv/sftp/export-upload/        SFTP-Kontowurzel
/srv/sftp/export-upload/current Mountpunkt
~~~

Beide JSON-Dateien zuvor aus einem gültigen Datenstand bereitstellen. Uploads und Importe während der Einrichtung pausieren. Bestehende Daten sichern; vor dem Mounten prüfen, dass der echte Mountpunkt leer ist und keine zu erhaltenden Inhalte verdeckt werden.

Als Administrator, nach Prüfung der Beispielpfade:

~~~bash
mkdir -p /srv/sftp/export-upload/current
mount --bind /srv/wordpress-import /srv/sftp/export-upload/current
findmnt --mountpoint /srv/sftp/export-upload/current
~~~

Ist current bereits ein Link oder Mount, dessen Zustand zunächst klären. Die Anwendung ersetzt keine Links oder Mounts.

Für einen dauerhaften Mount kann nach Sicherung von /etc/fstab ein passender Eintrag ergänzt werden:

~~~fstab
/srv/wordpress-import /srv/sftp/export-upload/current none bind 0 0
~~~

Mit findmnt --verify --verbose prüfen. Auf systemd-Systemen nach fstab-Änderungen systemctl daemon-reload ausführen. Den neuen Mount bei pausierten Zugriffen gezielt über seinen Zielpfad aushängen und wieder einhängen; keine belegten Mounts gewaltsam aushängen. Nach einem Neustart Erreichbarkeit erneut prüfen.

Für ein tatsächliches Betriebssystemkonto namens export-upload kann eine gezielte ACL vorhandene Dateien beschreibbar machen:

~~~bash
setfacl -m u:export-upload:rx /srv/wordpress-import
setfacl -m u:export-upload:rw /srv/wordpress-import/groups.json /srv/wordpress-import/contactPersons.json
getfacl /srv/wordpress-import /srv/wordpress-import/groups.json /srv/wordpress-import/contactPersons.json
~~~

Bei virtuellen Hosting-Konten die tatsächlich zugreifende Systemidentität verwenden. ACL-Werkzeuge und Dateisystemunterstützung sind Voraussetzung. Eigentümer und PHP-Leserechte erhalten; nach Restore oder Austausch der Dateien erneut prüfen.

## WordPress-Dateizugriff

WP All Import benötigt eine zu seiner Installation passende Quelle für beide Dateien. Liegen sie lokal auf dem WordPress-Server, die lokale Dateiquelle des Plugins einrichten. Die Anwendung ändert diese Konfiguration nicht.

Ein Pfad außerhalb des HTTP-Document-Roots ist nicht automatisch für PHP lesbar: Dateirechte und gegebenenfalls open_basedir berücksichtigen. PHP löst Symlinks auf; sie umgehen open_basedir nicht.

Falls JSON-Dateien über einen Pfad innerhalb des Webroots erreichbar sind, dessen HTTP-Schutz mit der tatsächlichen Importquelle abstimmen. Bei lokalem Lesen kann HTTP gesperrt sein; bei einer URL-Quelle würde dieselbe Sperre auch den Importabruf verhindern. Eine Apache-.htaccess schützt nicht automatisch vor statischer Auslieferung durch einen vorgeschalteten nginx.

## Abnahme, Sicherung und Wiederherstellung

1. Mit demselben SFTP-Konto und Port prüfen, dass /current erreichbar ist.
2. In der Anwendung CT- und SFTP-Verbindung testen.
3. Daten abrufen; Konfigurationsrevision, Warnungen und Bildfreigabe prüfen.
4. Die öffentliche Bild-URL von WordPress aus ohne CT-Anmeldung testen.
5. Beide JSON-Dateien vollständig hochladen und ihre Lesbarkeit für PHP prüfen.
6. Erst danach die eingerichteten WordPress-Importe starten und Ergebnisse prüfen.

Uploads und Importe sind betrieblich zu koordinieren: SFTP überschreibt zwei Dateien nacheinander und blockiert keinen WordPress-Leser.

.env, config/ und var/ geschützt sichern. Zu den persistenten Daten gehören Konto, Exporteinstellungen, Warnungen, Importstatus, JSON-Archive und Bilder. Archive werden nicht automatisch bereinigt. Vor Löschen oder Restore prüfen, welche Bild-URLs und Importstände weiter benötigt werden.

Diese Anleitung beschreibt Einrichtungsschritte, keinen automatisch ausgeführten Serverumbau. Die Anwendung richtet weder Konten noch Mounts, ACLs, WordPress-Aufträge oder Reverse-Proxys ein.

[SFTP-Details](SFTP.md) · [WordPress-Import](WORDPRESS-IMPORT.md) · [Dokumentationsübersicht](README.md)
