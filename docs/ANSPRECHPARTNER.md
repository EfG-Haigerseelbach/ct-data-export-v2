# Gruppen und Ansprechpartner auswählen

Stand: 2026-10-30

## Auswahlregeln

Nur Gruppen mit aktiviertem konfiguriertem Freigabefeld werden ausgewählt. Aus deren Ansprechpartnerfeld sammelt die Anwendung Personen-IDs, bereinigt Dubletten und fragt Kontakte in Paketen mit höchstens 100 IDs ab. Auch gefilterte Antworten werden vollständig paginiert.

Zusätzlich werden Personen mit eigener aktivierter Exportfreigabe berücksichtigt. Eine Person wird somit ausgewählt, wenn sie selbst freigegeben ist **oder** als lesbarer Ansprechpartner einer ausgewählten Gruppe geführt wird. Eine zusätzliche eigene Freigabe ist für Gruppenkontakte nicht erforderlich.

Freigabefelder unterstützen true/false, 1/0 und die entsprechenden getrimmten Strings. Leere oder fehlende Werte gelten als deaktiviert; unbekannte Formate erzeugen einen Fehler. Ansprechpartner-IDs können unter anderem als positive Zahl, Liste oder durch Leerzeichen, Komma beziehungsweise Semikolon getrennter Text vorliegen. Die Feldpfade sind [konfigurierbar](EXPORTKONFIGURATION.md).

Unbekannte Kategorie-/Zielgruppen-IDs oder fehlerhafte ID-/Textfelder bleiben Fehler. Nicht lesbare oder fehlende Ansprechpartner werden dagegen mit einer [zentralen Warnung](WARNUNGEN.md) aus den Verknüpfungen entfernt. Die übrige Gruppe bleibt erhalten.

## Personenabfragen

Der Abruf plant die Ansprechpartner anhand der gespeicherten Gruppenfreigabe. Angeforderte Kontakte werden gezielt aus /persons gelesen und mit der allgemeinen Personenabfrage zusammengeführt. Ein leeres Kontakt-ID-Array löst keine zusätzliche ungefilterte Kontaktabfrage aus.

Wird ein Kontaktpaket mit 403 abgelehnt, isoliert der Adapter dessen IDs durch Einzelabfragen. Weiterhin verbotene Kontakte werden ausgelassen; Authentifizierungs-, Netzwerk- und grundlegende Endpointfehler werden nicht als leere erfolgreiche Ergebnisse behandelt.

## Personenfelder

Das exportierte Personenarray enthält:

| Feld | Inhalt |
| --- | --- |
| id | ChurchTools-Personen-ID |
| firstName, lastName | Namen |
| email | Ausgewählte einzelne E-Mail-Adresse |
| imageUrl | Bild-URL dieser Anwendung |
| responsibilities | Text aus dem eigenen CT-Feld website_responsibilities, sonst leer |
| sortOrder | Fortlaufende Reihenfolge ab 1 |
| groups | Zugeordnete ausgewählte Gruppen mit id und name |

Sortiert wird nach dem konfigurierten Personen-Sortierfeld, anschließend Vorname und ID. Die Ausgabe erhält danach fortlaufende sortOrder-Werte.

Die E-Mail-Auswahl bevorzugt das [konfigurierte Kontaktlabel](EXPORTKONFIGURATION.md#e-mail-auswahl), sofern gesetzt. Ohne passenden nicht leeren Eintrag gilt Standardadresse, danach erste nicht leere Adresse. Label-IDs können von CT numerisch oder als Text geliefert werden. Ohne Adresse bleibt email leer.

Telefon- und E-Mail-Kandidaten können in der angemeldeten Detailansicht stehen. Telefonnummern und vollständige Kandidatenlisten gehören nicht zum technischen Personenarray. Das eigene Feld website_responsibilities ist derzeit fest benannt; diese Zuordnung wird nicht über die Exportkonfiguration geändert.

## Schnittstelle

Die Implementierung trennt [API-Abruf](../src/churchtools/client.ts), [Auswahl und Verknüpfungen](../src/export/selection.ts), [E-Mail-Auswahl und Personenformat](../src/export/person-json.ts) sowie [Detailansicht](../src/export/data-preview.ts).

Die tatsächliche Ausgabe und die Freigaberegeln vor Einrichtung des WordPress-Imports prüfen. Beschreibungstexte, CT-Datumswerte und IDs werden nicht automatisch in beliebige WordPress-Felder umgewandelt.

[Dokumentationsübersicht](README.md)
