# Datenansicht und Abrufarchive

Stand: 2026-10-30

## Daten ansehen

Die angemeldete Seite **Abgerufene Daten** zeigt die ausgewählten Gruppen und Personen. Einträge lassen sich aufklappen. Ansprechpartner-IDs verlinken zum passenden Personeneintrag, Gruppen-IDs zurück zur Gruppe; der Zieleintrag wird dabei geöffnet.

Separate technische Ansichten zeigen die beiden JSON-Arrays. Beschreibungen und JSON werden als maskierter Text ausgegeben. Bild-URLs stehen in der Ansicht als Text; das Öffnen der Seite lädt keine CT-Bilder nach.

Personenexporte enthalten id, firstName, lastName, email, imageUrl, responsibilities, sortOrder und groups. Gruppenexporte enthalten Auswahl- und Terminfelder sowie contactPersonIds. Die Gruppen verwenden CT-Datums-/Wochentagswerte und IDs der verfügbaren Ansprechpartner. Ein beliebiges WordPress-Mapping oder eine automatische Umwandlung von Beschreibungen zu HTML findet nicht statt.

## Startabruf und Wiederverwendung

Bei eingerichtetem CT-Zugang prüft die Anwendung beim Start den Beginn des jüngsten erfolgreichen Archivabrufs:

- Bis einschließlich 30 Minuten Alter wird der Archivstand ohne CT-Abfrage wiederhergestellt.
- Bei höherem Alter oder ohne erfolgreichen Archivstand wird neu abgerufen.
- Die manuelle Auswahlprüfung ist unabhängig davon jederzeit möglich.

Wiederverwendung erzeugt keinen neuen Historieneintrag. Konfigurationsrevision und Bildfreigabe bleiben erhalten. Ein Archiv mit abweichender Konfigurationsrevision ist als veraltet erkennbar und muss vor dem Upload neu abgerufen werden.

Wiederhergestellte Ansichten enthalten nur exportierte Felder. Weitere ursprüngliche E-Mail-Kandidaten und Telefonfelder sind nicht im JSON-Archiv enthalten. Die beim Wiederherstellen angezeigten Datensatzzahlen beziehen sich auf die archivierte Auswahl.

Ein unlesbarer aktueller Archivstand wird als Fehler gemeldet und nicht innerhalb der 30 Minuten durch eine unerwartete CT-Abfrage ersetzt. Danach kann manuell abgerufen werden. Ungültige Archivmanifeste können bereits beim Laden des Archivs einen Startfehler verursachen.

## Abrufhistorie

Die Tabelle zeigt höchstens 100 Einträge, neueste zuerst:

| Spalte | Bedeutung |
| --- | --- |
| Datum und Uhrzeit | Abrufbeginn in Europe/Berlin |
| Dauer | Sekunden mit einer Nachkommastelle |
| Auslöser | Anwendungsstart oder manuelle Auswahlprüfung |
| Status | Läuft, erfolgreich, fehlgeschlagen oder erfolgreich mit Uploadsperre |
| JSON-Dateien | Geschützte Ansichten beider archivierten Dateien |
| Gesamtgröße | Summe von JSON-Dateien, Bildern und Manifest |

Die Laufzeit umfasst CT-Anfragen, Auswahl, Bildverarbeitung und Schreiben der JSON-/Bilddateien. Der Messpunkt erfolgreicher Archive liegt unmittelbar vor dem Schreiben des Manifests und der abschließenden Archivfreigabe. durationMs bleibt im Manifest gespeichert.

Einträge ohne gespeicherte Dauer und laufende Abrufe zeigen **-**. Es erfolgt keine Nachberechnung aus Zeitstempeln. Die Gesamtgröße wird aus tatsächlichen Dateilängen ermittelt; ein Tooltip nennt Bytes. Nicht archivierte Einträge haben keinen Dateigrößenwert.

Erfolgreich archivierte Abrufe werden nach Neustarts wieder geladen. Fehlgeschlagene Abrufe bleiben nur im Arbeitsspeicher. Verbindungstests und Hilfsabfragen zur Konfigurationsprüfung erzeugen keine Abrufhistorie.

## Lokale Dateien

Ein archivierter Abruf liegt unter var/exports/{Abruf-ID}/:

~~~text
JJJJ.MM.DD_hhMMss_groups.json
JJJJ.MM.DD_hhMMss_contactPersons.json
manifest.json
{Bildinhalt-SHA256}.png
~~~

Die Dateinamen verwenden den Abrufbeginn in Europe/Berlin. Abruf-IDs sind zufällig erzeugte 64-stellige Hexadezimalwerte. Bilder verwenden einen SHA256-Inhaltshash. Gleiche aufbereitete Bilder werden innerhalb eines Abrufs nur einmal gespeichert.

Ein temporärer Ordner wird vollständig geschrieben und anschließend als Abrufordner freigegeben. Schreibfehler verhindern eine erfolgreiche Archivierung. Ältere Ordner werden nicht automatisch gelöscht; die Begrenzung der Tabelle ist keine Aufbewahrungsregel.

JSON-Dateien und Manifest sind keine öffentlichen Dateirouten. Die Oberfläche und historischen JSON-Ansichten verlangen Anmeldung und werden ohne Browsercache ausgeliefert.

## Öffentliche Bilder

imageUrl verweist auf:

~~~text
APP_PUBLIC_BASE_URL/media/{Abruf-ID}/{Bildhash}.png
~~~

Diese Bildroute benötigt keine Anmeldung, damit WordPress Bilder ohne CT-Zugang laden kann. Nur bekannte archivierte PNG-Dateien werden ausgeliefert. Für produktive Bild-URLs muss APP_PUBLIC_BASE_URL von WordPress erreichbar sein.

Archive und Anwendung müssen verfügbar bleiben, solange ihre Bild-URLs verwendet werden. Löschen eines Archivs entfernt die Bildquelle; es ist kein automatischer Löschabgleich mit WordPress implementiert.

## Aktueller Datenstand

Der Startdatenbestand wird angemeldeten Sitzungen bereitgestellt. Manuelle Vorschauen gehören zur aufrufenden Sitzung. Abmeldung und Neustart beenden deren Speicherzustand, nicht die archivierten Dateien.

SFTP lädt den aktuellen Datenstand der Sitzung hoch; die Historie ist keine Auswahlfunktion für historische Uploads. Neue Abrufe und geänderte Einstellungen überschreiben bestehende Archive nicht.

[Bilder und Uploadfreigabe](BILDOPTIMIERUNG.md) · [Dokumentationsübersicht](README.md)
