import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, unlink, rmdir, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExportSettingsStore, ExportSettingsError, exportSettingsSchema, defaultExportSettings } from '../src/export/settings.js';
import { buildSelection, collectContactPersonIds } from '../src/export/selection.js';
import { SelectionError } from '../src/export/selection.js';
import { warningMessage } from '../src/export/warnings.js';

test('Speichern aktiviert neue Werte und erhält sie nach erneutem Laden', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ct-settings-'));
  const file = join(dir, 'export.json');
  try {
    const store = await ExportSettingsStore.load(file);
    const before = store.snapshot();
    const changed = structuredClone(before.config);
    changed.export.accessPath.exposureIndicator = 'information.public';
    await store.save(changed, before.revision);
    assert.deepEqual(store.snapshot().config, changed);
    assert.deepEqual((await ExportSettingsStore.load(file)).snapshot().config, changed);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), changed);
    // Der Aufrufer kann den aktiven Stand nicht über ein zurückgegebenes Objekt verändern.
    const copy = store.snapshot(); copy.config.export.person.sortOrder = 'evil';
    assert.equal(store.snapshot().config.export.person.sortOrder, 'website_person_sort_order');
  } finally { await unlink(file).catch(() => {}); await rmdir(dir); }
});

test('Ungültige und konkurrierende Änderungen überschreiben den gültigen Stand nicht', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ct-settings-'));
  const file = join(dir, 'export.json');
  try {
    const store = await ExportSettingsStore.load(file);
    const before = store.snapshot();
    await assert.rejects(store.save({ export: {} }, before.revision), (e: unknown) => e instanceof ExportSettingsError && e.code === 'SETTINGS_INVALID');
    const a = structuredClone(before.config); a.export.person.sortOrder = 'order_a';
    const b = structuredClone(before.config); b.export.person.sortOrder = 'order_b';
    const results = await Promise.allSettled([store.save(a, before.revision), store.save(b, before.revision)]);
    assert.equal(results[0]!.status, 'fulfilled');
    assert.equal(results[1]!.status, 'rejected');
    assert.equal(store.snapshot().config.export.person.sortOrder, 'order_a');
  } finally { await unlink(file).catch(() => {}); await rmdir(dir); }
});

test('Schreibfehler aktivieren keine ungespeicherte Konfiguration; beschädigte Datei stoppt Laden', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ct-settings-'));
  const blocked = join(dir, 'blocked');
  try {
    const store = await ExportSettingsStore.load(join(blocked, 'export.json'));
    await writeFile(blocked, 'not a directory');
    const before = store.snapshot(); const changed = structuredClone(before.config);
    changed.export.person.sortOrder = 'new_order';
    await assert.rejects(store.save(changed, before.revision), (e: unknown) => e instanceof ExportSettingsError && e.code === 'SETTINGS_WRITE');
    assert.deepEqual(store.snapshot(), before);
    await assert.rejects(ExportSettingsStore.load(blocked), (e: unknown) => e instanceof ExportSettingsError && e.code === 'SETTINGS_READ');
  } finally { await unlink(blocked); await rmdir(dir); }
});

test('Feldpfade verhindern Prototypzugriff und erlauben keine Ausdrücke', () => {
  for (const path of ['__proto__.x', 'information.constructor.x', 'information["x"]', 'x()', '', 'information.']) {
    const config = structuredClone(defaultExportSettings); config.export.accessPath.exposureIndicator = path;
    assert.equal(exportSettingsSchema.safeParse(config).success, false);
  }
});

test('Alle neun Einstellungen bestimmen Auswahl, Metadaten und Personensortierung', () => {
  const config = structuredClone(defaultExportSettings);
  config.export.accessPath = { exposureIndicator: 'information.visible', categoryData: 'information.cats',
    targetGroupIds: 'information.audience', agecategory: 'information.age', recurrenceDescription: 'information.repeat',
    contactPersonIds: 'information.contacts', showOnLandingPage: 'information.landing' };
  config.export.person = { attributeThatIndicatesToExport: 'public', sortOrder: 'order' };
  const data = {
    groups: [{ id: 1, name: 'Selected', information: { visible: true, cats: [3], audience: { 4: true }, age: '18+', repeat: 'weekly', contacts: '20', landing: '1' } },
      { id: 2, name: 'Hidden', information: { visible: 'false' } }],
    persons: [{ id: 20, firstName: 'Contact', lastName: 'Example', public: false, order: 2 },
      { id: 21, firstName: 'Own release', lastName: 'Example', public: true, order: 1 }],
    masterData: { groupCategories: [{ id: 3, nameTranslated: 'Category' }], targetGroups: [{ id: 4, nameTranslated: 'Audience' }] },
  };
  const result = buildSelection(data, config);
  assert.deepEqual(collectContactPersonIds(data.groups, config), [20]);
  assert.deepEqual(result.groups, [{ id: 1, name: 'Selected', categories: ['Category'], targetGroups: ['Audience'],
    ageCategory: '18+', recurrenceDescription: 'weekly', contactPersonIds: [20], showOnLandingPage: true }]);
  assert.deepEqual(result.persons.map((p) => [p.id, p.sortOrder]), [[21, 1], [20, 2]]);
  assert.equal(buildSelection(data, defaultExportSettings).groups.length, 0);
});

test('Ungültige Freigaben bleiben Fehler; fehlende Kontakte werden mit Warnung ausgelassen', () => {
  const base = { groups: [{ id: 1, name: 'Test', information: { website_expose: 'yes' } }], persons: [],
    masterData: { groupCategories: [], targetGroups: [] } };
  assert.throws(() => buildSelection(base, defaultExportSettings), SelectionError);
  const contacts = { ...base, groups: [{ id: 1, name: 'Test', information: { website_expose: true, website_contact_person_ids: '999' } }] };
  const result = buildSelection(contacts, defaultExportSettings);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0]!.contactPersonIds, []);
  assert.equal(result.warnings[0]!.personId, 999);
});

test('Diagnose nennt Gruppe, Feldpfad und fehlende Kontakt-ID ohne Namen oder Kontakte', () => {
  const data = { groups: [{ id: 260, name: 'Vertraulicher Gruppenname', information: {
    website_expose: true, website_contact_person_ids: '999',
  } }], persons: [], masterData: { groupCategories: [], targetGroups: [] } };
  const result = buildSelection(data, defaultExportSettings);
  const warning = result.warnings[0]!;
  assert.equal(warning.code, 'SELECTION_CONTACT');
  assert.equal(warning.groupId, 260);
  assert.equal(warning.fieldPath, 'information.website_contact_person_ids');
  assert.equal(warning.personId, 999);
  assert.match(warningMessage(warning), /Gruppe 260/);
  assert.match(warningMessage(warning), /Ansprechpartner-ID 999/);
  assert.equal(warningMessage(warning).includes('Vertraulicher Gruppenname'), false);
});

test('Format- und Stammdatenfehler sind unterscheidbar, Rohwerte bleiben verborgen', () => {
  const base = { groups: [{ id: 10, name: 'Test', information: { website_expose: true } as Record<string, unknown> }],
    persons: [], masterData: { groupCategories: [], targetGroups: [] } };
  for (const [field, value, expectedCode] of [
    ['website_expose', { private: 'not-for-the-browser' }, 'SELECTION_FLAG'],
    ['website_agecategory', { private: 'not-for-the-browser' }, 'SELECTION_TEXT'],
    ['website_contact_person_ids', 'not-for-the-browser@example.org', 'SELECTION_IDS'],
    ['website_groupcategory_ids', [123], 'SELECTION_MASTERDATA'],
  ] as const) {
    const data = structuredClone(base); data.groups[0]!.information[field] = value;
    assert.throws(() => buildSelection(data, defaultExportSettings), (error: unknown) => {
      assert.ok(error instanceof SelectionError);
      assert.equal(error.code, expectedCode);
      assert.equal(error.context.fieldPath, `information.${field}`);
      assert.equal(JSON.stringify(error).includes('not-for-the-browser'), false);
      assert.equal(error.message.includes('not-for-the-browser'), false);
      return true;
    });
  }
});

test('Personenfreigabefehler zeigen den Personenpfad statt einer Gruppenmeldung', () => {
  const data = { groups: [], persons: [{ id: 20, firstName: 'Private', lastName: 'Name', website_expose: [] }],
    masterData: { groupCategories: [], targetGroups: [] } };
  assert.throws(() => buildSelection(data, defaultExportSettings), (error: unknown) =>
    error instanceof SelectionError && error.code === 'SELECTION_FLAG' && error.context.recordType === 'person'
    && error.context.fieldPath === 'website_expose' && !error.message.includes('Private'));
});

test('Leerzeichen bei Flags und numerische Einzel-IDs werden eindeutig normalisiert', () => {
  const data = { groups: [{ id: 10, name: 'Test', information: {
    website_expose: ' TRUE ', website_show_on_landing_page: ' false ', website_groupcategory_ids: 3,
    website_contact_person_ids: [' 20 '],
  } }], persons: [{ id: 20, firstName: 'Test', lastName: 'Person' }],
    masterData: { groupCategories: [{ id: 3, nameTranslated: 'Category' }], targetGroups: [] } };
  const result = buildSelection(data, defaultExportSettings);
  assert.deepEqual(result.groups[0]!.categories, ['Category']);
  assert.deepEqual(result.groups[0]!.contactPersonIds, [20]);
  assert.equal(result.groups[0]!.showOnLandingPage, false);
});


test('Unverändertes Speichern erhält Datei und Änderungszeit auch nach Neustart', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'ct-settings-time-')); const file = join(dir,'export.json');
 try {
  const store = await ExportSettingsStore.load(file); const initial = store.snapshot();
  assert.equal(initial.updatedAt,null);
  assert.equal(await store.save(initial.config,initial.revision),false);
  await assert.rejects(stat(file), {code:'ENOENT'});
  const changed = structuredClone(initial.config); changed.export.person.sortOrder = 'changed_order';
  assert.equal(await store.save(changed,initial.revision),true);
  assert.ok(store.snapshot().updatedAt);
  const historical = new Date('2026-10-20T10:00:00Z'); await utimes(file,historical,historical);
  const loaded = await ExportSettingsStore.load(file); const before = await stat(file);
  assert.equal(loaded.snapshot().updatedAt,historical.toISOString());
  assert.equal(await loaded.save(changed,loaded.snapshot().revision),false);
  assert.equal((await stat(file)).mtimeMs,before.mtimeMs);
  assert.equal((await ExportSettingsStore.load(file)).snapshot().updatedAt,historical.toISOString());
 } finally {await unlink(file).catch(()=>{}); await rmdir(dir);}
});


test('Alte Konfiguration erhält Bildstandard und ungültige Bildgrößen werden abgewiesen',async()=>{
 const legacy=structuredClone(defaultExportSettings) as {export:Record<string,unknown>};delete legacy.export.images;
 const parsed=exportSettingsSchema.parse(legacy);assert.equal(parsed.export.images.personMaxEdge,960);
 for(const edge of [-1,1,63,4097,1.5]){const invalid=structuredClone(parsed);invalid.export.images.personMaxEdge=edge;assert.equal(exportSettingsSchema.safeParse(invalid).success,false);}
 for(const edge of [0,64,320,960,4096]){const valid=structuredClone(parsed);valid.export.images.personMaxEdge=edge;assert.equal(exportSettingsSchema.safeParse(valid).success,true);}
 const dir=await mkdtemp(join(tmpdir(),'ct-image-settings-'));const file=join(dir,'export.json');
 try {await writeFile(file,JSON.stringify(legacy));const store=await ExportSettingsStore.load(file);assert.equal(store.snapshot().config.export.images.personMaxEdge,960);const changed=store.snapshot();changed.config.export.images.personMaxEdge=480;await store.save(changed.config,changed.revision);assert.equal((await ExportSettingsStore.load(file)).snapshot().config.export.images.personMaxEdge,480);}
 finally{await unlink(file);await rmdir(dir);}
});


test('Bevorzugte E-Mail-Label-ID ist optional und muss positiv ganzzahlig sein',()=>{
 const legacy=structuredClone(defaultExportSettings) as {export:Record<string,unknown>};delete legacy.export.email;
 assert.equal(exportSettingsSchema.parse(legacy).export.email.preferredContactLabelId,null);
 for(const id of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'7']) {
  const config={export:{...defaultExportSettings.export,email:{preferredContactLabelId:id}}};
  assert.equal(exportSettingsSchema.safeParse(config).success,false);
 }
});
