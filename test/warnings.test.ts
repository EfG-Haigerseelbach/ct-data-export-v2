import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, unlink, rmdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WarningStore, WarningStoreError } from '../src/export/warnings.js';
import type { SelectionWarning } from '../src/export/warnings.js';
import { buildSelection } from '../src/export/selection.js';
import { defaultExportSettings } from '../src/export/settings.js';

const warning: SelectionWarning = { code: 'SELECTION_CONTACT', groupId: 260,
  fieldPath: 'information.website_contact_person_ids', personId: 73 };
const checked = [{ groupId: 260, fieldPath: warning.fieldPath }];

test('Warnungen bleiben nach Neustart erhalten, werden dedupliziert, behoben und erneut geöffnet', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ct-warnings-'));
  const file = join(dir, 'warnings.json');
  let time = new Date('2026-10-25T10:00:00Z');
  try {
    let store = await WarningStore.load(file, () => time);
    await store.reconcile([warning, warning], checked);
    assert.equal(store.openCount(), 1);
    assert.equal(store.snapshot()[0]!.occurrences, 1);
    const first = store.snapshot()[0]!.firstSeen;
    store = await WarningStore.load(file, () => time);
    assert.equal(store.openCount(), 1);
    time = new Date('2026-10-25T11:00:00Z');
    await store.reconcile([warning], checked);
    assert.equal(store.snapshot().length, 1);
    assert.equal(store.snapshot()[0]!.occurrences, 2);
    assert.equal(store.snapshot()[0]!.firstSeen, first);
    assert.equal(store.snapshot()[0]!.lastSeen, time.toISOString());
    await store.reconcile([], checked);
    assert.equal(store.openCount(), 0);
    assert.equal(store.snapshot()[0]!.resolvedAt, time.toISOString());
    store = await WarningStore.load(file, () => time);
    assert.equal(store.snapshot()[0]!.status, 'resolved');
    await store.reconcile([warning], checked);
    assert.equal(store.openCount(), 1);
    assert.equal(store.snapshot()[0]!.occurrences, 3);
    assert.equal(store.snapshot()[0]!.resolvedAt, null);
    const disk = JSON.parse(await readFile(file, 'utf8')) as { items: Record<string, unknown>[] };
    assert.deepEqual(Object.keys(disk.items[0]!).sort(), ['code','fieldPath','firstSeen','groupId','id','lastSeen','occurrences','personId','resolvedAt','status'].sort());
  } finally { await unlink(file).catch(() => {}); await rmdir(dir); }
});

test('Nicht geprüfte Gruppen oder geänderte Feldpfade schließen keine Warnung', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ct-warnings-'));
  const file = join(dir, 'warnings.json');
  try {
    const store = await WarningStore.load(file);
    await store.reconcile([warning], checked);
    await store.reconcile([], []);
    await store.reconcile([], [{ groupId: 260, fieldPath: 'information.other_contacts' }]);
    await store.reconcile([], [{ groupId: 999, fieldPath: warning.fieldPath }]);
    assert.equal(store.openCount(), 1);
  } finally { await unlink(file).catch(() => {}); await rmdir(dir); }
});

test('Parallele Aufzeichnungen verlieren keine Warnungen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ct-warnings-'));
  const file = join(dir, 'warnings.json');
  try {
    const store = await WarningStore.load(file);
    await Promise.all([store.reconcile([warning], []), store.reconcile([{ ...warning, personId: 74 }], [])]);
    assert.equal(store.openCount(), 2);
  } finally { await unlink(file).catch(() => {}); await rmdir(dir); }
});

test('Warnungs-Schreibfehler verwerfen den bisherigen Stand nicht; beschädigte Datei wird nicht überschrieben', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ct-warnings-'));
  const blocked = join(dir, 'blocked');
  try {
    const store = await WarningStore.load(join(blocked, 'warnings.json'));
    await writeFile(blocked, 'not-json');
    await assert.rejects(store.reconcile([warning], checked), (e: unknown) => e instanceof WarningStoreError && e.code === 'WARNINGS_WRITE');
    assert.deepEqual(store.snapshot(), []);
    await assert.rejects(WarningStore.load(blocked), (e: unknown) => e instanceof WarningStoreError && e.code === 'WARNINGS_READ');
    assert.equal(await readFile(blocked, 'utf8'), 'not-json');
  } finally { await unlink(blocked); await rmdir(dir); }
});

test('Mehrere fehlende Kontakte bleiben Warnungen; verfügbare Beziehungen und die Gruppe bleiben erhalten', () => {
  const result = buildSelection({ groups: [{ id: 260, name: 'Test', information: {
    website_expose: true, website_contact_person_ids: '73;74;75',
  } }], persons: [{ id: 75, firstName: 'Visible', lastName: 'Person' }],
    masterData: { groupCategories: [], targetGroups: [] } }, defaultExportSettings);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0]!.contactPersonIds, [75]);
  assert.deepEqual(result.persons.map((p) => p.id), [75]);
  assert.deepEqual(result.warnings.map((w) => w.personId), [73, 74]);
});
