# Repository und Entwicklung

Stand: 2026-10-30

## Eigenständiger Checkout

Die Repository-Wurzel enthält package.json, package-lock.json, src/, test/ und docs/. Zum Arbeiten Node.js 24 und npm verwenden:

~~~powershell
npm.cmd ci
npm.cmd run check
npm.cmd run build
~~~

Unter Linux/macOS npm statt npm.cmd verwenden. check kombiniert Typprüfung und Tests. Tests verwenden synthetische Daten, temporäre Dateien und lokale HTTP-Server. Sie benötigen keine produktiven Zugangsdaten, WordPress-Kopie oder benachbarten Projektordner.

Die Tests müssen lokale Loopback-Verbindungen und temporäre Dateien verwenden dürfen. Einschränkungen durch eine Entwicklungs-Sandbox können entsprechende Tests verhindern.

Der TypeScript-Build liegt unter dist/. Die Anwendung startet aus der Repository-Wurzel; ein abweichendes Arbeitsverzeichnis ändert die Auflösung relativer Konfigurations- und Datenpfade.

## Private Dateien

Die Ausschlüsse in [.gitignore](../.gitignore) betreffen insbesondere:

- .env und weitere private Umgebungsdateien
- config/local.json mit dem lokalen Verwaltungskonto
- config/export.json mit eigenen Feldpfaden und gegebenenfalls geheimen Import-URLs
- var/ mit Datenarchiven, Bildern, Warnungen und Importstatus
- node_modules/, dist/, Protokolle sowie gängige Schlüssel- und Sicherungsdateien

Die bereinigte .env.example und [config/export.example.json](../config/export.example.json) können als Vorlagen ins Repository aufgenommen werden. Auch Dokumentation und Testdaten dürfen keine echten Zugangsdaten oder Personenexporte enthalten. Ausschlussregeln verhindern nicht, dass bereits versionierte Dateien in der Historie bleiben.

Vor einem Commit Änderungen und vorgemerkte Dateien prüfen:

~~~powershell
git status --short
git diff --cached
~~~

Ein frischer Checkout benötigt ein eigenes Konto über user:create und eine private Umgebung aus .env.example. Exportkonfigurationen ohne lokale Datei verwenden die Standardwerte; Änderungen über die Oberfläche werden lokal gespeichert.

## Optionaler Dateiprüfer

Neben der Abrufpipeline gibt es einen lesenden Prüfer für Verzeichnisse mit groups.json und contactPersons.json:

~~~powershell
npm.cmd run validate -- /pfad/zu/exportdateien
~~~

Nach dem Build ist der Einstieg dist/src/cli.js. Die Ausgabeverträge liegen in [contracts.ts](../src/contracts.ts). Der Prüfer erwartet unter anderem Gruppen mit eingebetteten contactPersons sowie formatierte Datums-/Wochentagswerte. Er schreibt keine Dateien.

Dieser Vertrag unterscheidet sich von der technischen Gruppenansicht mit contactPersonIds und CT-Terminfeldern. Der Prüfer ist deshalb keine Freigabeprüfung für das aktuelle SFTP-Paar.

Exitcodes: 0 für einen strukturell lesbaren Bestand, 1 bei ungültigen/unlesbaren Dateien und 2 bei falschem Aufruf. Eine erfolgreiche Strukturprüfung bestätigt weder Bild-Erreichbarkeit noch ein WordPress-Mapping.

## Modulübersicht

| Verzeichnis | Inhalt |
| --- | --- |
| src/churchtools | CT-Konfiguration, SDK-Adapter und Eingabeschemas |
| src/export | Auswahl, Settings, Warnungen, Personen-JSON, Bilder und Archive |
| src/transfer | SFTP |
| src/wordpress | URL-Prüfung und Importsteuerung |
| src/web | Zugang, HTTP-Routen, HTML-Ansichten und Browsercode |
| test | Synthetische Vertrags-, Adapter-, Web- und Browsertests |

Die Anwendung ist für einen Prozess mit dateibasierter Persistenz ausgelegt. Neue Funktionen müssen Anmeldung, CSRF, Konfigurationsrevisionen, Uploadfreigabe und vorhandene Zustandsdateien berücksichtigen.

[Webeinrichtung](WEB.md) · [CT-Adapter](CT-CLIENT.md) · [Dokumentationsübersicht](README.md)
