# Zentrale Warnungen

Stand: 2026-10-30

## Fehlende Ansprechpartner

Ist eine in einer ausgewählten Gruppe referenzierte Person nicht verfügbar, wird nur diese Verknüpfung ausgelassen. Gruppe und übrige Ansprechpartner werden weiterverarbeitet. Es werden weder Personenplatzhalter erzeugt noch CT-Berechtigungen umgangen.

Die Warnung SELECTION_CONTACT enthält Gruppen-ID, Personen-ID und konfigurierten Kontaktfeldpfad. Ungültige Datenformate, fehlende Stammdaten und technische Abfragefehler bleiben Fehler. Bildfehler sind eine getrennte [Uploadsperre](BILDOPTIMIERUNG.md#fehler-und-sftp-sperre).

## Bearbeiten

Nach Anmeldung die Seite **Warnungen** öffnen. Die Zahl offener Warnungen erscheint auch in der Navigation und im Hinweisbanner.

In ChurchTools prüfen, ob die Person noch Ansprechpartner sein soll:

- Veraltete Verknüpfungen in der Gruppe korrigieren.
- Bei weiterhin benötigten Personen die fachlich erforderlichen Leserechte prüfen.
- Absichtlich eingeschränkte Rechte nicht allein für den Export erweitern.

Danach **Exportkonfiguration → Auswahl mit ChurchTools prüfen** ausführen. Wurde dieselbe ausgewählte Gruppe mit demselben Kontaktfeld erfolgreich ohne die fehlende Referenz geprüft, wird die Warnung als behoben markiert.

Behobene Einträge bleiben sichtbar. Wiederholte Funde aktualisieren letzten Fundzeitpunkt und Anzahl; ein erneut auftretender Fall öffnet denselben Eintrag wieder.

## Speicherung

var/warnings.json enthält technische IDs, Feldpfad, Code, Status, Zeitpunkte und Anzahl der Feststellungen. Namen, E-Mail-Adressen, Telefonnummern, Token und API-Antwortkörper werden nicht gespeichert.

Die Liste gilt zentral für alle angemeldeten Sitzungen und bleibt nach Neustarts erhalten. Gespeichert wird über eine synchronisierte temporäre Datei und anschließenden Dateiaustausch. Fehler beim Speichern werden gemeldet.

Keine automatische Behebung erfolgt bei CT-Ausfall, fehlender Gruppe, anderem Kontaktfeld oder zwischenzeitlich geänderter Konfiguration. Ein nicht mehr sichtbarer Datensatz ist kein Nachweis für eine Korrektur.

Warnungsspeicher und Anwendung sind für einen einzelnen Prozess ausgelegt. Die Datei zusammen mit den übrigen privaten Zustandsdaten sichern.

Implementierung: [Warnungsspeicher](../src/export/warnings.ts), [Auswahl](../src/export/selection.ts).

[Dokumentationsübersicht](README.md)
