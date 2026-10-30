import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDataPreview } from '../src/export/data-preview.js';
import { buildSelection } from '../src/export/selection.js';
import { defaultExportSettings } from '../src/export/settings.js';
import { dataPage } from '../src/web/views.js';
import { buildPersonJson } from '../src/export/person-json.js';

const snapshot = {
  groups: [{ id: 10, name: 'Selected', information: { website_expose: true,
    website_contact_person_ids: '20', note: '<script>doNotExecute()</script>', imageUrl: 'javascript:doNotExecute()',
    privateInternalField: 'not-in-preview' } }, { id: 11, name: 'Hidden', information: { website_expose: false } }],
  persons: [{ id: 20, firstName: 'Alex', lastName: 'Example', emails: [{ email: 'alex@example.org', isDefault: true,
    contactLabelId: 7, privateInternalField: 'not-in-preview' }], imageUrl: 'https://example.org/avatar.jpg', mobile: 'synthetic-mobile',
    website_responsibilities: 'Kontakt', privateInternalField: 'not-in-preview' }],
  masterData: { groupCategories: [], targetGroups: [] },
};

test('Anzeige enthält die ausgewählten Exportattribute, keine ungefilterten API-Zusatzfelder', () => {
  const data = buildDataPreview(snapshot, buildSelection(snapshot, defaultExportSettings), '2026-10-25T10:00:00Z');
  assert.equal(data.fetchedGroups, 2);
  assert.equal(data.groups.length, 1);
  assert.equal(data.persons[0]!.fields['E-Mail-Kandidaten'], 'alex@example.org · Label-ID: 7 · Standardadresse');
  assert.equal(data.persons[0]!.fields['Mobilnummer (Kandidat)'], 'synthetic-mobile');
  assert.equal(data.persons[0]!.fields['Zuständigkeit'], 'Kontakt');
  assert.equal(JSON.stringify(data).includes('not-in-preview'), false);
  assert.equal(data.groups[0]!.fields['Verfügbare Ansprechpartner-IDs'], '20');
});

test('Datenansicht kodiert Inhalte und lädt weder HTML noch Bilder aus CT', () => {
  const data = buildDataPreview(snapshot, buildSelection(snapshot, defaultExportSettings), '2026-10-25T10:00:00Z');
  const html = dataPage(data);
  assert.match(html, /&lt;script&gt;doNotExecute\(\)&lt;\/script&gt;/);
  assert.equal(html.includes('<script>doNotExecute()'), false);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('href="javascript:'), false);
  assert.match(dataPage(data, true), /vorherigen Datenstand/);
  assert.match(dataPage(), /Noch keine Daten abgerufen/);
});

test('Gruppen-JSON enthält nur ausgewählte aufbereitete Felder und wird sicher dargestellt', () => {
  const data = buildDataPreview(snapshot, buildSelection(snapshot, defaultExportSettings), '2026-10-25T10:00:00Z');
  assert.deepEqual(data.technicalGroups, [{ id: 10, name: 'Selected', categories: [], targetGroups: [],
    ageCategory: '', recurrenceDescription: '', contactPersonIds: [20], showOnLandingPage: false,
    startDate: '', endDate: '', weekday: '', startTime: '',
    note: '<script>doNotExecute()</script>', imageUrl: 'javascript:doNotExecute()' }]);
  const html = dataPage(data);
  assert.match(html, /href="#technical-groups-json"/);
  assert.match(html, /id="technical-groups-json"/);
  assert.match(html, /aria-label="Gruppendaten als JSON"/);
  assert.equal(html.includes('<script>doNotExecute()'), false);
  assert.equal(JSON.stringify(data.technicalGroups).includes('not-in-preview'), false);
  const empty = { groups: [], persons: [], masterData: snapshot.masterData };
  assert.deepEqual(buildDataPreview(empty, buildSelection(empty, defaultExportSettings), '2026-10-25T10:00:00Z').technicalGroups, []);
});

test('Technische Personenansicht erfüllt exakt die gewünschte JSON-Struktur', () => {
  const selection = buildSelection(snapshot, defaultExportSettings);
  const result = buildPersonJson(selection);
  assert.deepEqual(result, [{ id: 20, firstName: 'Alex', lastName: 'Example', email: 'alex@example.org',
    imageUrl: 'https://example.org/avatar.jpg', responsibilities: 'Kontakt', sortOrder: 1,
    groups: [{ id: 10, name: 'Selected' }] }]);
  assert.deepEqual(Object.keys(result[0]!), ['id', 'firstName', 'lastName', 'email', 'imageUrl', 'responsibilities', 'sortOrder', 'groups']);
  assert.equal(JSON.stringify(result).includes('synthetic-mobile'), false);
  const data = buildDataPreview(snapshot, selection, '2026-10-25T10:00:00Z');
  assert.deepEqual(data.technicalPersons, result);
  assert.match(dataPage(data), /Technische Ansicht: Personen als JSON/);
});

test('JSON-E-Mail bevorzugt Website-Label, dann Standard, erste Adresse oder leeren String', () => {
  const select = (emails: { email: string; contactLabelId?: number | string; isDefault?: boolean }[]) => {
    const data = { ...snapshot, persons: [{ ...snapshot.persons[0]!, emails }] };
    return buildPersonJson(buildSelection(data, defaultExportSettings), 7)[0]!.email;
  };
  assert.equal(select([{ email: 'default@example.org', isDefault: true }, { email: 'website@example.org', contactLabelId: 7 }]), 'website@example.org');
  assert.equal(select([{ email: 'first@example.org' }, { email: 'default@example.org', isDefault: true }]), 'default@example.org');
  assert.equal(select([{ email: ' ' }, { email: 'first@example.org' }]), 'first@example.org');
  assert.equal(select([]), '');
  assert.equal(select([{ email: 'website@example.org', contactLabelId: '7' }]), 'website@example.org');
});

test('JSON-Vorschau ist sicher als Text eingebettet und bleibt bei leeren Ergebnissen ein Array', () => {
  const data = structuredClone(snapshot);
  data.persons[0]!.firstName = '</code><script>attack()</script>';
  const preview = buildDataPreview(data, buildSelection(data, defaultExportSettings), '2026-10-25T10:00:00Z');
  const html = dataPage(preview);
  assert.equal(html.includes('</code><script>attack()'), false);
  assert.match(html, /&lt;\/code&gt;&lt;script&gt;attack/);
  assert.deepEqual(buildPersonJson({ groups: [], persons: [], warnings: [] }), []);
});


test('Abrufhistorie zeigt Datum/Uhrzeit in Berlin sowie Auslöser und Status', () => {
 const html = dataPage(undefined, false, 0, '', undefined, undefined, [
  { startedAt: '2026-10-27T10:15:30Z', source: 'manual', status: 'success' },
  { startedAt: '2026-10-27T09:00:00Z', source: 'startup', status: 'error' }
 ]);
 assert.match(html, /27\.10\.2026, 11:15:30/);
 assert.match(html, /datetime="2026-10-27T10:15:30Z"/);
 assert.match(html, /Manuelle Auswahlprüfung/); assert.match(html, /Anwendungsstart/);
 assert.match(html, /✅ Erfolgreich/); assert.match(html, /❌ Fehlgeschlagen/);
 assert.match(dataPage(), /Noch keine Abrufe vorhanden/);
});


test('Ansprechpartner- und Gruppen-IDs verlinken vorhandene Ziele und bewahren Textkodierung', () => {
 const preview=buildDataPreview(snapshot,buildSelection(snapshot,defaultExportSettings),'2026-10-27T10:00:00Z');
 const html=dataPage(preview);
 assert.match(html, /href="#person-20" data-record-link/);
 assert.match(html, /href="#group-10" data-record-link/);
 assert.match(html, /id="person-20"/);assert.match(html, /id="group-10"/);
 preview.groups[0]!.fields['Verfügbare Ansprechpartner-IDs']='20, 999, <script>bad</script>';
 const safe=dataPage(preview);assert.equal(safe.includes('href="#person-999"'),false);assert.equal(safe.includes('<script>bad'),false);
});


test('Abrufhistorie zeigt Gesamtgröße lesbar und fehlende Größen neutral', async()=>{
 const {formatFileSize}=await import('../src/web/views.js');
 assert.equal(formatFileSize(0),'0 B');assert.equal(formatFileSize(1024),'1 KiB');assert.equal(formatFileSize(1536),'1,5 KiB');assert.equal(formatFileSize(1048576),'1 MiB');
 const html=dataPage(undefined,false,0,'',undefined,undefined,[{startedAt:'2026-10-27T10:00:00Z',source:'manual',status:'success',totalBytes:1536}]);
 assert.match(html, /Gesamtgröße/);assert.match(html, /1,5 KiB/);assert.match(html, /1\.536 Bytes inklusive JSON, Bildern und Manifest/);
});


test('E-Mail-Auswahl verwendet eine andere konfigurierte Label-ID oder keine Bevorzugung',()=>{
 const data={...snapshot,persons:[{...snapshot.persons[0]!,emails:[{email:'standard@example.org',isDefault:true},{email:'other@example.org',contactLabelId:'23'},{email:'legacy@example.org',contactLabelId:7}]}]};
 const selection=buildSelection(data,defaultExportSettings);
 assert.equal(buildPersonJson(selection,23)[0]!.email,'other@example.org');
 assert.equal(buildPersonJson(selection,null)[0]!.email,'standard@example.org');
 assert.equal(buildPersonJson(selection,999)[0]!.email,'standard@example.org');
 assert.equal(buildDataPreview(data,selection,'2026-10-30T10:00:00Z',23).technicalPersons[0]!.email,'other@example.org');
});
