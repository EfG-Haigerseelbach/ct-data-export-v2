# Exportkonfiguration

Stand: 2026-10-30

Die angemeldete Seite **Exportkonfiguration** steuert Auswahl, E-Mail-Aufbereitung, Bildgröße und WordPress-Importadressen. Gespeicherte Änderungen gelten ohne Neustart für nachfolgende Abrufe.

## Feldpfade

| Konfigurationspfad unter export | Verwendung |
| --- | --- |
| accessPath.exposureIndicator | Gruppenfreigabe |
| accessPath.categoryData | Kategorie-IDs |
| accessPath.targetGroupIds | Zielgruppen-IDs |
| accessPath.agecategory | Altersangabe |
| accessPath.recurrenceDescription | Turnusbeschreibung |
| accessPath.contactPersonIds | Ansprechpartner-IDs |
| accessPath.showOnLandingPage | Startseitenkennzeichen |
| person.attributeThatIndicatesToExport | Eigene Personenfreigabe |
| person.sortOrder | Personensortierung |

Pfade bestehen aus durch Punkte getrennten Feldnamen, beispielsweise information.website_expose. Keine Ausdrücke, Arrayzugriffe oder Prototyp-Schlüssel verwenden. Die mitgelieferten Vorgaben setzen entsprechende eigene Felder in der ChurchTools-Instanz voraus; sie werden dort nicht automatisch angelegt.

Änderungen an diesen neun Pfaden werden vor dem Speichern durch einen CT-Abruf geprüft. Als Referenz dient eine bereits freigegebene Gruppe mit allen bisherigen Attributen und ein lesbarer Ansprechpartner dieser Gruppe. Die neuen Gruppenpfade müssen an dieser Gruppe, die Personenpfade an dieser Person vorhanden sein.

Leere Werte, false, 0 und null zählen als vorhanden; fehlende oder undefinierte Attribute nicht. Die Prüfung bestätigt die Existenz, nicht die fachliche Richtigkeit aller Datensätze. Ohne geeignete Referenz oder bei CT-Fehlern wird nichts gespeichert. Die zusätzliche Auswahlprüfung zeigt die Wirkung auf aktuelle Daten.

## E-Mail-Auswahl

Unter **Personen → Bevorzugte E-Mail-Label-ID** eine positive ganze Zahl eintragen. Leer deaktiviert die Label-Bevorzugung. Gespeichert wird:

~~~json
{
  "email": {
    "preferredContactLabelId": null
  }
}
~~~

Dies ist ein Ausschnitt unter export. Eine gesetzte ID bevorzugt die erste nicht leere E-Mail-Adresse mit diesem Kontaktlabel. Ohne passenden Eintrag gilt Standardadresse, danach erste nicht leere Adresse. Ohne Adresse bleibt email leer. Die Bedeutung und Existenz des Labels sind in der eigenen CT-Instanz zu prüfen; die Anwendung prüft dessen Stammdateneintrag nicht.

Neue Konfigurationen verwenden null. Änderungen gelten beim nächsten Abruf; archivierte Dateien werden nicht umgeschrieben.

## Personenbilder

export.images.personMaxEdge legt die maximale Kantenlänge fest. Standard: 960 Pixel. Erlaubt sind ganze Zahlen von 64 bis 4096 oder 0 zum Abschalten der Größenreduktion.

Seitenverhältnis, kleine Bilder, EXIF-Ausrichtung und verlustfreie PNG-Ausgabe werden berücksichtigt. Gruppenbilder werden nicht verkleinert. [Einzelheiten](BILDOPTIMIERUNG.md).

## Import-URLs

Unter **Import in WordPress** gibt es je zwei vollständige HTTPS-URLs:

- export.wordpress.contactsTriggerUrl und contactsProcessingUrl
- export.wordpress.offersTriggerUrl und offersProcessingUrl

Jedes Paar muss dieselbe Herkunft, denselben Pfad, Import-Key und dieselbe Import-ID verwenden. action muss trigger beziehungsweise processing sein. IDs werden aus den URLs gelesen. Die URL enthält einen geheimen Schlüssel und darf nicht veröffentlicht werden.

Geänderte Paare werden vor Übernahme über processing geprüft. Nur die erwartete Meldung zum nicht gestarteten Import bestätigt den Endpoint. Dieser Aufruf kann einen extern gestarteten Import weiterverarbeiten; deshalb nur bei inaktiven Importen konfigurieren. Bei Fehlern bleiben die alten URLs aktiv und werden im Formular wiederhergestellt.

Ein bereits konfiguriertes Paar kann über die Oberfläche nur durch ein anderes erfolgreich geprüftes Paar ersetzt werden. Leere Paare können den optionalen Umgebungs-Fallback verwenden. [Einrichtung und Antwortauswertung](WORDPRESS-IMPORT.md).

## Speichern und Prüfen

**Speichern und verwenden** ist nur bei Änderungen aktiv. Während der Prüfung ist der Button gesperrt und zeigt einen Ladezustand. Erfolg erscheint als Popup; fehlerhafte Eingaben werden markiert. Die Seite wird mit JavaScript nicht neu geladen.

Identische Werte werden auch serverseitig nicht erneut geschrieben. Revisionen schützen gegen veraltete Formulare. Bei Schreibfehlern bleibt der bisherige Stand aktiv. Unter dem Einleitungstext steht die Änderungszeit der Konfigurationsdatei in Europe/Berlin.

**Auswahl mit ChurchTools prüfen** liest ausschließlich gespeicherte Werte. Ungespeicherte Eingaben werden nicht verwendet. Der Abruf erzeugt ein lokales Archiv; er lädt keine Daten per SFTP hoch und startet keinen WordPress-Import.

## Datei und Betrieb

Die Konfiguration liegt in config/export.json und ist von Git ausgeschlossen. Ohne Datei gelten die Vorgaben aus [settings.ts](../src/export/settings.ts). Fehlende optionale Abschnitte erhalten Standardwerte, ohne die Datei beim Laden automatisch zu überschreiben.

Dateiaustausch und Warteschlange koordinieren Änderungen innerhalb eines Prozesses. Mehrere Instanzen dürfen nicht gleichzeitig dieselbe Konfigurationsdatei verwalten. Externe Dateiänderungen erfordern einen Neustart.

Ein Abruf behält seinen Konfigurationsstand. Wird inzwischen gespeichert, gilt seine Vorschau als veraltet und muss vor dem Upload erneut abgerufen werden.

[Dokumentationsübersicht](README.md)

## Beispielkonfiguration

[config/export.example.json](../config/export.example.json) enthält eine versionierbare Vorlage. Die vier Import-URLs verwenden wordpress.example, beispielhafte Import-IDs und BEISPIEL_IMPORT_KEY. Die übrigen Werte zeigen eine mögliche Konfiguration und sind an die eigene CT-Instanz anzupassen.

Bei einer Neuinstallation kann die Vorlage nach config/export.json kopiert werden. Eine vorhandene lokale Datei dabei nicht überschreiben. Beispieladressen vor Verwendung ersetzen oder die vier URL-Werte leeren und später über die Oberfläche konfigurieren. Die Datei wird nicht automatisch als aktive Konfiguration geladen; nur config/export.json ist aktiv.
