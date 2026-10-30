# ChurchTools → WordPress

TypeScript-Anwendung mit geschützter Weboberfläche zum Abrufen freigegebener ChurchTools-Gruppen und Ansprechpartner. Unterstützt lokale Abrufarchive mit Bildern, konfigurierbare Exportfelder, SFTP-Upload und die Steuerung bestehender WP-All-Import-Aufträge.

## Installation

Voraussetzung: Node.js 24 und npm. Alle Befehle im Wurzelverzeichnis dieses Repositorys ausführen.

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run user:create
```

.env mit den eigenen Werten befüllen. Danach mit explizit geladener Umgebung starten:

```powershell
node --env-file=.env --import tsx src/web/main.ts
```

Unter Linux/macOS npm statt npm.cmd und cp statt Copy-Item verwenden. Weboberfläche: [http://127.0.0.1:3000](http://127.0.0.1:3000). Ohne CT-Zugangsdaten kann die Oberfläche gestartet werden; es werden keine CT-Daten abgerufen. npm start lädt .env nicht automatisch.

## Konfiguration und Daten

- .env: lokale Zugangsdaten; von Git ausgeschlossen.
- config/local.json: Benutzername und Passworthash, angelegt durch user:create; von Git ausgeschlossen.
- config/export.json: über die Oberfläche gespeicherte Exportkonfiguration, kann geheime WordPress-Import-URLs enthalten; von Git ausgeschlossen. Ohne Datei werden die Standardwerte aus dem Code verwendet.
- var/: private Abrufarchive, Bilder, Warnungen und Importstatus; von Git ausgeschlossen.
- CT_EXPORT_DIRECTORY: optionales Verzeichnis für die separate Prüfung bestehender Exportdateien; Standard var/import. Dort werden keine Dateien automatisch angelegt.

Beim Start wird ein erfolgreicher Archivstand bis einschließlich 30 Minuten Alter wiederverwendet. Andernfalls erfolgt ein neuer CT-Abruf. Manuelle Abrufe bleiben möglich. Der SFTP-Upload überschreibt ausschließlich groups.json und contactPersons.json unter SFTP_DIRECTORY/current; current muss bereits existieren. Upload und WordPress-Import zeitlich trennen.

## Prüfen und bauen

```powershell
npm.cmd run check
npm.cmd run build
```

check führt Typprüfung und synthetische Tests aus und benötigt keine benachbarten Projektordner, produktiven Zugangsdaten oder WordPress-Kopie. Tests verwenden lokale HTTP-Testserver und temporäre Dateien. Buildausgabe: dist/. Für kompilierten Start mit Umgebung:

```powershell
node --env-file=.env dist/src/web/main.js
```

Vorhandene Exportdateien optional separat prüfen:

```powershell
npm.cmd run validate -- /pfad/zu/exportdateien
```

## Dokumentation

[Alle Anleitungen im Überblick](docs/README.md)

- [Weboberfläche](docs/WEB.md)
- [ChurchTools-Zugang](docs/CT-API.md)
- [Exportkonfiguration](docs/EXPORTKONFIGURATION.md)
- [Datenansicht und Archive](docs/DATENANSICHT.md)
- [Bildoptimierung](docs/BILDOPTIMIERUNG.md)
- [SFTP-Upload](docs/SFTP.md)
- [WordPress-Import](docs/WORDPRESS-IMPORT.md)
- [Serverbetrieb](docs/SERVER.md)
- [Repository-Verwaltung](docs/REPOSITORY.md)

Die Dokumentation beschreibt den aktuellen Anwendungsstand mit neutralen Beispielen. Die Anwendung benötigt keine außerhalb dieses Repositorys liegenden Dateien.
