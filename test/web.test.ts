import { WordpressImports } from '../src/wordpress/imports.js';
import sharp from 'sharp';
import { buildDataPreview } from '../src/export/data-preview.js';
import type { ImageValidator } from '../src/export/image-validation.js';
import { dataHashes } from '../src/export/image-validation.js';
import { JsonArchive } from '../src/export/json-archive.js';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, unlink, rmdir, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createAccount, verifyAccount } from '../src/web/auth.js';
import { createWebServer } from '../src/web/server.js';
import { dashboardPage } from '../src/web/views.js';
import { CtError } from '../src/churchtools/client.js';
import type { CtConnection } from '../src/churchtools/client.js';
import { ExportSettingsStore } from '../src/export/settings.js';
import { settingsFields } from '../src/export/settings.js';
import type { CtSnapshot } from '../src/export/selection.js';
import { WarningStore } from '../src/export/warnings.js';
import type { ApiGroup } from '../src/churchtools/schemas.js';

const secret = 'Test-Passwort-2026!';
const account = await createAccount('test-admin', secret);

async function fixture(t: TestContext, secureCookie = false, ct?: CtConnection & { downloadImages?: (urls:string[])=>Promise<Map<string,{body?:Buffer;error?:string}>>; readSnapshot?: (selectContactIds?: (groups: ApiGroup[]) => number[]) => Promise<CtSnapshot> }, autoLoad = false, uploader?: { upload(data: import('../src/export/data-preview.js').DataPreview): Promise<string>; checkConnection?(): Promise<void> }, archive?: JsonArchive, imageValidator?: ImageValidator | false, wordpressImports?: WordpressImports, initialNow = Date.now(), headerLabel = '') {
  const directory = await mkdtemp(join(tmpdir(), 'ct-web-test-'));
  for (const file of ['groups.json', 'contactPersons.json']) await writeFile(join(directory, file), '[]');
  let now = initialNow;
  const exportSettings = await ExportSettingsStore.load(join(directory, 'export.json'));
  const warningStore = await WarningStore.load(join(directory, 'warnings.json'));
  const server = createWebServer({ ...(imageValidator === false ? {} : { imageValidator: imageValidator ?? (async (data) => ({ mode:'authenticated-local' as const, checkedAt: new Date().toISOString(), uploadAllowed: true, ...dataHashes(data), errors: [] })) }), account, directory, headerLabel, ...(wordpressImports ? { wordpressImports } : {}), autoLoad, ...(archive ? { archive } : {}), ...(uploader ? { uploader } : {}), secureCookie, exportSettings, warningStore, now: () => now, ...(ct ? { ct } : {}) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
    for (const file of ['groups.json', 'contactPersons.json']) await unlink(join(directory, file));
    await unlink(join(directory, 'export.json')).catch(() => {});
    await unlink(join(directory, 'warnings.json')).catch(() => {});
    await rmdir(directory);
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (path: string, cookie = '') => fetch(base + path, { headers: { cookie }, redirect: 'manual' });
  const post = (path: string, cookie: string, form: Record<string, string>, json = false) => fetch(base + path, {
    method: 'POST', headers: { cookie, ...(json ? { Accept: 'application/json' } : {}) }, body: new URLSearchParams(form), redirect: 'manual',
  });
  const login = await get('/login');
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(await login.text())![1]!;
  return { initialLoad: server.initialLoad, get, post, cookie, csrf, login, exportSettings, warningStore, directory, advance: () => { now += 61 * 60 * 1000; } };
}

test('Passwörter werden gesalzen gespeichert und korrekt geprüft', async () => {
  const second = await createAccount('test-admin', secret);
  assert.notEqual(account.hash, second.hash);
  assert.ok(await verifyAccount(account, 'test-admin', secret));
  assert.equal(await verifyAccount(account, 'other', secret), false);
  assert.equal(await verifyAccount(account, 'test-admin', 'incorrect'), false);
  await assert.rejects(createAccount('test-admin', 'kurz'));
});

test('Konfiguration ist nur angemeldet erreichbar und in der Navigation verlinkt', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.get('/configuration')).headers.get('location'), '/login');
  const login = await f.post('/login', f.cookie, { csrf: f.csrf, username: 'test-admin', password: secret });
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const response = await f.get('/configuration', cookie);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  assert.match(html, /href="\/configuration">Konfiguration/);
  assert.match(html, /CT_BASE_URL/);
  assert.match(html, /CT_API_TOKEN/);
});

test('Dashboard ist geschützt und Formular/Session haben Schutzheader', async (t) => {
  const f = await fixture(t);
  const result = await f.get('/');
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('location'), '/login');
  assert.match(f.login.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
  assert.equal(f.login.headers.get('cache-control'), 'no-store');
  assert.match(f.login.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.equal((await f.post('/validate', f.cookie, { csrf: f.csrf })).status, 303);
});

test('Anmeldung, Prüfung und Abmeldung funktionieren einschließlich Session-Wechsel', async (t) => {
  const f = await fixture(t);
  const login = await f.post('/login', f.cookie, { csrf: f.csrf, username: account.username, password: secret });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  assert.notEqual(cookie, f.cookie);
  assert.equal((await f.get('/', f.cookie)).status, 303);
  let page = await (await f.get('/', cookie)).text();
  assert.match(page, /Angemeldet als test-admin/);
  const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(page)![1]!;
  assert.equal((await f.post('/validate', cookie, { csrf })).status, 303);
  page = await (await f.get('/', cookie)).text();
  assert.match(page, /Dateien erfüllen den Strukturvertrag/);
  assert.equal((await f.post('/logout', cookie, { csrf })).status, 303);
  assert.equal((await f.get('/', cookie)).status, 303);
});

test('Falsche Zugangsdaten und CSRF-Versuche geben keinen Zugang', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.post('/login', f.cookie, { username: account.username, password: secret })).status, 403);
  const login = await f.post('/login', f.cookie, { csrf: f.csrf, username: account.username, password: 'incorrect' });
  assert.equal(login.status, 401);
  assert.match(await login.text(), /Benutzername oder Passwort ist falsch/);
  assert.equal((await f.get('/', f.cookie)).status, 303);
});

test('Anmeldeversuche werden nach fünf Versuchen begrenzt', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) {
    assert.equal((await f.post('/login', f.cookie, { csrf: f.csrf, username: 'test-admin', password: 'incorrect' })).status, 401);
  }
  const result = await f.post('/login', f.cookie, { csrf: f.csrf, username: 'test-admin', password: secret });
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('retry-after'), '900');
});

test('Sitzungen laufen ab und Secure-Cookies lassen sich aktivieren', async (t) => {
  const f = await fixture(t, true);
  assert.match(f.login.headers.get('set-cookie')!, /; Secure/);
  const result = await f.post('/login', f.cookie, { csrf: f.csrf, username: account.username, password: secret });
  const cookie = result.headers.get('set-cookie')!.split(';')[0]!;
  f.advance();
  assert.equal((await f.get('/', cookie)).status, 303);
  assert.equal((await f.post('/validate', cookie, { csrf: f.csrf })).status, 403);
});

test('Benutzername wird in der Oberfläche HTML-kodiert', () => {
  const html = dashboardPage('abc', '<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('CT-Verbindungsprüfung ist geschützt und zeigt keine Antwortinhalte', async (t) => {
  let calls = 0;
  const f = await fixture(t, false, { async checkConnection() { calls++; } });
  assert.equal((await f.post('/ct/check', f.cookie, { csrf: f.csrf })).status, 303);
  assert.equal(calls, 0);
  const login = await f.post('/login', f.cookie, { csrf: f.csrf, username: account.username, password: secret });
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const html = await (await f.get('/', cookie)).text();
  const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(html)![1]!;
  assert.equal((await f.post('/ct/check', cookie, { csrf: 'wrong' })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await f.post('/ct/check', cookie, { csrf })).status, 303);
  assert.equal(calls, 1);
  assert.match(await (await f.get('/', cookie)).text(), /Anmeldung bei ChurchTools erfolgreich/);
});

test('Asynchroner Verbindungstest liefert Erfolg und Fehler als JSON ohne Weiterleitung', async (t) => {
  let fail = false;
  const f = await fixture(t, false, { async checkConnection() { if (fail) throw new CtError('CT_AUTH'); } });
  const user = await loginToSettings(f);
  const page = await f.get('/', user.cookie);
  assert.match(page.headers.get('content-security-policy')!, /script-src 'self'; connect-src 'self'/);
  const html = await page.text();
  assert.match(html, /src="\/assets\/connection.js" defer/);
  assert.match(html, /id="ct-check-form"/);
  assert.match(html, /id="ct-check-result"/);
  const asset = await f.get('/assets/connection.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type')!, /text\/javascript/);
  assert.match(await asset.text(), /event.preventDefault\(\)/);
  const result = await f.post('/ct/check', user.cookie, { csrf: user.csrf }, true);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('location'), null);
  assert.equal((await result.json()).status, 'connected');
  fail = true;
  const error = await f.post('/ct/check', user.cookie, { csrf: user.csrf }, true);
  assert.equal(error.status, 502);
  assert.equal(error.headers.get('location'), null);
  assert.equal((await error.json()).code, 'CT_AUTH');
  assert.match(await (await f.get('/', user.cookie)).text(), /connection-error/);
});

test('JSON-Anfragen behalten Sitzungs-/CSRF-Schutz und melden fehlende Konfiguration', async (t) => {
  const f = await fixture(t);
  const anonymous = await f.post('/ct/check', f.cookie, { csrf: f.csrf }, true);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).code, 'LOGIN_REQUIRED');
  const user = await loginToSettings(f);
  const csrf = await f.post('/ct/check', user.cookie, { csrf: 'invalid' }, true);
  assert.equal(csrf.status, 403);
  assert.equal((await csrf.json()).code, 'CSRF_INVALID');
  const unconfigured = await f.post('/ct/check', user.cookie, { csrf: user.csrf }, true);
  assert.equal(unconfigured.status, 409);
  assert.equal((await unconfigured.json()).code, 'CT_CONFIG');
  f.advance();
  const expired = await f.post('/ct/check', user.cookie, { csrf: user.csrf }, true);
  assert.equal(expired.status, 401);
  assert.equal((await expired.json()).code, 'SESSION_EXPIRED');
});

test('Parallel laufende CT-Prüfung wird auch asynchron als belegt gemeldet', async (t) => {
  let release!: () => void;
  let started!: () => void;
  const begun = new Promise<void>((resolve) => { started = resolve; });
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const f = await fixture(t, false, { async checkConnection() { started(); await pending; } });
  const user = await loginToSettings(f);
  const first = f.post('/ct/check', user.cookie, { csrf: user.csrf }, true);
  await begun;
  try {
    const busy = await f.post('/ct/check', user.cookie, { csrf: user.csrf }, true);
    assert.equal(busy.status, 202);
    assert.equal((await busy.json()).code, 'CT_BUSY');
  } finally { release(); }
  assert.equal((await first).status, 200);
});

async function loginToSettings(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await f.post('/login', f.cookie, { csrf: f.csrf, username: account.username, password: secret });
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const html = await (await f.get('/settings', cookie)).text();
  const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(html)![1]!;
  const revision = /name="revision" value="([a-f0-9]+)"/.exec(html)![1]!;
  const config = f.exportSettings.snapshot().config;
  const fields = Object.fromEntries(settingsFields.map((field) => [field.key, (config.export[field.section] as Record<string, string>)[field.key]! ]));
  return { cookie, csrf, revision, fields };
}

test('Einstellungen sind geschützt; ungültige Formulare, CSRF und veraltete Stände überschreiben nichts', async (t) => {
  const referenceData: CtSnapshot = { groups: [{ id: 1, name: 'Reference', information: { website_expose: true, new_release: true,
  website_groupcategory_ids: '', website_targetgroup_ids: '', website_agecategory: '', website_recurrence_description: '',
  website_contact_person_ids: '20', website_show_on_landing_page: false } }], persons: [{ id: 20, firstName: 'A', lastName: 'B', website_expose: false, website_person_sort_order: 0 }], masterData: { groupCategories: [], targetGroups: [] } };
  const f = await fixture(t, false, { checkConnection: async () => {}, readSnapshot: async () => referenceData });
  assert.equal((await f.get('/settings', f.cookie)).status, 303);
  assert.equal((await f.post('/settings', f.cookie, { csrf: f.csrf })).status, 303);
  const user = await loginToSettings(f);
  const original = f.exportSettings.snapshot();
  const form = { ...user.fields, csrf: user.csrf, revision: user.revision };
  assert.equal((await f.post('/settings', user.cookie, { ...form, csrf: 'invalid' })).status, 403);
  const invalid = await f.post('/settings', user.cookie, { ...form, exposureIndicator: '"><script>attack</script>' });
  assert.equal(invalid.status, 400);
  const invalidHtml = await invalid.text();
  assert.equal(invalidHtml.includes('<script>'), false);
  assert.deepEqual(f.exportSettings.snapshot(), original);
  const asyncMissing = await f.post('/settings', user.cookie, { ...form, sortOrder: 'missing_attribute' }, true);
  assert.equal(asyncMissing.status, 422);
  assert.deepEqual((await asyncMissing.json()).fields, ['sortOrder']);
  const syntax = await f.post('/settings', user.cookie, { ...form, categoryData: 'bad path' }, true);
  assert.deepEqual((await syntax.json()).fields, ['categoryData']);
  const missing = await f.post('/settings', user.cookie, { ...form, sortOrder: 'missing_attribute' });
  assert.equal(missing.status, 422);
  assert.match(await missing.text(), /Person 20: missing_attribute/);
  assert.deepEqual(f.exportSettings.snapshot(), original);
  await assert.rejects(readFile(join(f.directory, 'export.json')), { code: 'ENOENT' });
  assert.equal((await f.post('/settings', user.cookie, { ...form, exposureIndicator: 'information.new_release' })).status, 303);
  assert.equal(f.exportSettings.snapshot().config.export.accessPath.exposureIndicator, 'information.new_release');
  assert.equal((await f.post('/settings', user.cookie, form)).status, 409);
  assert.match(await (await f.get('/settings', user.cookie)).text(), /Konfiguration gespeichert und aktiviert/);
  const asyncSaved = await f.post('/settings', user.cookie, { ...form, revision: f.exportSettings.snapshot().revision, exposureIndicator: 'information.new_release' }, true);
  assert.equal(asyncSaved.status, 200);
  assert.equal(asyncSaved.headers.get('location'), null);
  const saved = await asyncSaved.json();
  assert.equal(saved.status, 'saved');
  assert.equal(saved.changed, false);
  assert.equal(saved.updatedAt, f.exportSettings.snapshot().updatedAt);
  assert.ok(saved.updatedAt);
  assert.match(await (await f.get('/settings', user.cookie)).text(), /id="settings-updated-at">Zuletzt geändert:/);
  assert.equal(saved.revision, f.exportSettings.snapshot().revision);
});

test('Nach Speichern verwendet die nächste CT-Auswahl ohne Neustart die neuen Feldpfade', async (t) => {
  let reads = 0;
  const data: CtSnapshot = { groups: [
    { id: 1, name: 'One', information: { website_expose: true, other_release: true } },
    { id: 2, name: 'Two', information: { website_expose: false, other_release: true } },
  ], persons: [], masterData: { groupCategories: [], targetGroups: [] } };
  Object.assign(data.groups[0]!.information, { website_groupcategory_ids: '', website_targetgroup_ids: '', website_agecategory: '', website_recurrence_description: '', website_contact_person_ids: '20', website_show_on_landing_page: false });
  data.persons.push({ id: 20, firstName: 'A', lastName: 'B', website_expose: false, website_person_sort_order: 0 });
  const f = await fixture(t, false, { async checkConnection() {}, async readSnapshot() { reads++; return data; } });
  const user = await loginToSettings(f);
  assert.equal((await f.post('/settings/preview', f.cookie, { csrf: f.csrf })).status, 403);
  assert.equal(reads, 0);
  assert.equal((await f.post('/settings/preview', user.cookie, { csrf: 'invalid' })).status, 403);
  await f.post('/settings/preview', user.cookie, { csrf: user.csrf });
  assert.match(await (await f.get('/settings', user.cookie)).text(), /Ausgewählte Gruppen<\/dt><dd>1<\/dd>/);
  await f.post('/settings', user.cookie, { ...user.fields, csrf: user.csrf, revision: user.revision, exposureIndicator: 'information.other_release' });
  assert.match(await (await f.get('/settings', user.cookie)).text(), /seit der letzten Prüfung geändert/);
  await f.post('/settings/preview', user.cookie, { csrf: user.csrf });
  assert.match(await (await f.get('/settings', user.cookie)).text(), /Ausgewählte Gruppen<\/dt><dd>2<\/dd>/);
  assert.equal(reads, 3);
});

test('Ein laufender CT-Prüflauf mischt keine nachträglich gespeicherten Einstellungen hinein', async (t) => {
  let complete!: (data: CtSnapshot) => void;
  let started!: () => void;
  const begun = new Promise<void>((resolve) => { started = resolve; });
  const pending = new Promise<CtSnapshot>((resolve) => { complete = resolve; });
  const f = await fixture(t, false, { async checkConnection() {}, async readSnapshot() { started(); return pending; } });
  const user = await loginToSettings(f);
  const preview = f.post('/settings/preview', user.cookie, { csrf: user.csrf }, true);
  await begun;
  const external = f.exportSettings.snapshot();
  external.config.export.accessPath.exposureIndicator = 'information.new_release';
  await f.exportSettings.save(external.config, external.revision);
  complete({ groups: [{ id: 1, name: 'Test', information: { website_expose: true, new_release: false } }],
    persons: [], masterData: { groupCategories: [], targetGroups: [] } });
  const response = await preview;
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.stale, true);
  assert.equal(result.preview, undefined);
  const html = await (await f.get('/settings', user.cookie)).text();
  assert.match(html, /seit der letzten Prüfung geändert/);
  assert.equal(html.includes('Ausgewählte Gruppen</dt>'), false);
});

test('Asynchrone Auswahl aktualisiert Vorschau und zentrale Warnungsanzahl ohne Weiterleitung', async (t) => {
  let fixed = false;
  const f = await fixture(t, false, { async checkConnection() {}, async readSnapshot() {
    return { groups: [{ id: 260, name: 'Private group', information: { website_expose: true,
      website_contact_person_ids: fixed ? '' : '73' } }], persons: [], masterData: { groupCategories: [], targetGroups: [] } };
  } });
  const user = await loginToSettings(f);
  const html = await (await f.get('/settings', user.cookie)).text();
  assert.match(html, /src="\/assets\/selection.js" defer/);
  assert.match(html, /id="selection-form"/);
  assert.match(html, /id="selection-result"/);
  assert.match(html, /id="warning-banner"/);
  const asset = await f.get('/assets/selection.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type')!, /text\/javascript/);
  const check = await f.post('/settings/preview', user.cookie, { csrf: user.csrf }, true);
  assert.equal(check.status, 200);
  assert.equal(check.headers.get('location'), null);
  const result = await check.json();
  assert.equal(result.status, 'preview');
  assert.equal(result.preview.groups, 1);
  assert.equal(result.preview.contacts, 0);
  assert.equal(result.openWarnings, 1);
  assert.equal(JSON.stringify(result).includes('Private group'), false);
  assert.equal(f.warningStore.openCount(), 1);
  fixed = true;
  const next = await f.post('/settings/preview', user.cookie, { csrf: user.csrf }, true);
  assert.equal((await next.json()).openWarnings, 0);
  assert.equal(f.warningStore.openCount(), 0);
});

test('Gezielte Ansprechpartnerplanung verwendet beim nächsten asynchronen Aufruf die gespeicherten Feldpfade', async (t) => {
  const planned: number[][] = [];
  const data: CtSnapshot = { groups: [
    { id: 1, name: 'A', information: { website_expose: true, other_release: false, website_contact_person_ids: '20 20' } },
    { id: 2, name: 'B', information: { website_expose: false, other_release: true, other_contacts: '90;90' } },
  ], persons: [{ id: 20, firstName: 'A', lastName: 'Test' }, { id: 90, firstName: 'B', lastName: 'Test' }],
    masterData: { groupCategories: [], targetGroups: [] } };
  Object.assign(data.groups[0]!.information, { website_groupcategory_ids: '', website_targetgroup_ids: '', website_agecategory: '', website_recurrence_description: '', website_show_on_landing_page: false, other_contacts: '20' });
  Object.assign(data.persons[0]!, { website_expose: false, website_person_sort_order: 0 });
  const f = await fixture(t, false, { async checkConnection() {}, async readSnapshot(selectIds) {
    assert.ok(selectIds); planned.push(selectIds(data.groups)); return data;
  } });
  const user = await loginToSettings(f);
  assert.equal((await f.post('/settings/preview', user.cookie, { csrf: user.csrf }, true)).status, 200);
  await f.post('/settings', user.cookie, { ...user.fields, csrf: user.csrf, revision: user.revision,
    exposureIndicator: 'information.other_release', contactPersonIds: 'information.other_contacts' });
  assert.equal((await f.post('/settings/preview', user.cookie, { csrf: user.csrf }, true)).status, 200);
  assert.deepEqual(planned, [[20], [20], [90]]);
});

test('Datenansicht bleibt sitzungsgebunden und schreibt abgerufene Inhalte nicht auf Datenträger', async (t) => {
  const f = await fixture(t, false, { async checkConnection() {}, async readSnapshot() {
    return { groups: [{ id: 10, name: 'Synthetic selected group', information: {
      website_expose: true, website_contact_person_ids: '20', note: '<script>example()</script>',
    } }], persons: [{ id: 20, firstName: 'Synthetic', lastName: 'Person', emails: [{ email: 'synthetic@example.org' }],
      phonePrivate: 'synthetic-private-number' }], masterData: { groupCategories: [], targetGroups: [] } };
  } });
  assert.equal((await f.get('/data', f.cookie)).status, 303);
  const user = await loginToSettings(f);
  assert.match(await (await f.get('/data', user.cookie)).text(), /Noch keine Daten abgerufen/);
  const filesBefore = (await readdir(f.directory)).sort();
  const response = await f.post('/settings/preview', user.cookie, { csrf: user.csrf }, true);
  const result = await response.json();
  assert.equal(result.dataAvailable, true);
  assert.equal(JSON.stringify(result).includes('synthetic@example.org'), false);
  const view = await f.get('/data', user.cookie);
  assert.equal(view.status, 200);
  assert.equal(view.headers.get('cache-control'), 'no-store');
  const html = await view.text();
  assert.match(html, /Synthetic selected group/);
  assert.match(html, /synthetic@example.org/);
  assert.match(html, /synthetic-private-number/);
  assert.match(html, /id="technical-json"/);
  assert.match(html, /&quot;email&quot;: &quot;synthetic@example.org&quot;/);
  assert.match(html, /&quot;name&quot;: &quot;Synthetic selected group&quot;/);
  assert.match(html, /&lt;script&gt;example\(\)&lt;\/script&gt;/);
  assert.deepEqual((await readdir(f.directory)).sort(), filesBefore);
  assert.equal(await readFile(join(f.directory, 'groups.json'), 'utf8'), '[]');
  assert.equal(await readFile(join(f.directory, 'contactPersons.json'), 'utf8'), '[]');
  const fresh = await f.get('/login');
  const cookie = fresh.headers.get('set-cookie')!.split(';')[0]!;
  const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(await fresh.text())![1]!;
  const other = await loginToSettings({ ...f, cookie, csrf });
  const otherPage = await (await f.get('/data', other.cookie)).text();
  assert.match(otherPage, /Noch keine Daten abgerufen/);
  assert.equal(otherPage.includes('synthetic@example.org'), false);
  await f.post('/logout', user.cookie, { csrf: user.csrf });
  assert.equal((await f.get('/data', user.cookie)).status, 303);
});

test('Datenansicht kennzeichnet geänderte Konfiguration und verschwindet bei Sitzungsablauf', async (t) => {
  const f = await fixture(t, false, { async checkConnection() {}, async readSnapshot() {
    return { groups: [], persons: [], masterData: { groupCategories: [], targetGroups: [] } };
  } });
  const user = await loginToSettings(f);
  await f.post('/settings/preview', user.cookie, { csrf: user.csrf }, true);
  const external = f.exportSettings.snapshot(); external.config.export.accessPath.exposureIndicator = 'information.changed';
  await f.exportSettings.save(external.config, external.revision);
  assert.match(await (await f.get('/data', user.cookie)).text(), /vorherigen Datenstand/);
  f.advance();
  assert.equal((await f.get('/data', user.cookie)).status, 303);
});

test('Asynchrone Auswahl meldet Anmeldung, CSRF, Konfiguration und Datenfehler als JSON', async (t) => {
  const f = await fixture(t);
  const anonymous = await f.post('/settings/preview', f.cookie, { csrf: f.csrf }, true);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).openWarnings, undefined);
  const user = await loginToSettings(f);
  const csrf = await f.post('/settings/preview', user.cookie, { csrf: 'invalid' }, true);
  assert.equal(csrf.status, 403);
  assert.equal((await csrf.json()).code, 'CSRF_INVALID');
  const notConfigured = await f.post('/settings/preview', user.cookie, { csrf: user.csrf }, true);
  assert.equal(notConfigured.status, 409);
  assert.equal((await notConfigured.json()).code, 'CT_CONFIG');
  f.advance();
  const expired = await f.post('/settings/preview', user.cookie, { csrf: user.csrf }, true);
  assert.equal(expired.status, 401);
  assert.equal((await expired.json()).code, 'SESSION_EXPIRED');
  const invalid = await fixture(t, false, { async checkConnection() {}, async readSnapshot() {
    return { groups: [{ id: 10, name: 'Private group', information: { website_expose: 'invalid-private-value' } }],
      persons: [], masterData: { groupCategories: [], targetGroups: [] } };
  } });
  const second = await loginToSettings(invalid);
  const failure = await invalid.post('/settings/preview', second.cookie, { csrf: second.csrf }, true);
  assert.equal(failure.status, 502);
  const error = await failure.json();
  assert.equal(error.code, 'SELECTION_FLAG');
  assert.equal(JSON.stringify(error).includes('invalid-private-value'), false);
});

test('Gleichzeitige asynchrone Auswahlprüfung wird als belegt gemeldet', async (t) => {
  let done!: () => void;
  let started!: () => void;
  const begun = new Promise<void>((resolve) => { started = resolve; });
  const pending = new Promise<void>((resolve) => { done = resolve; });
  const f = await fixture(t, false, { async checkConnection() {}, async readSnapshot() {
    started(); await pending; return { groups: [], persons: [], masterData: { groupCategories: [], targetGroups: [] } };
  } });
  const user = await loginToSettings(f);
  const request = f.post('/settings/preview', user.cookie, { csrf: user.csrf }, true);
  await begun;
  try {
    const busy = await f.post('/settings/preview', user.cookie, { csrf: user.csrf }, true);
    assert.equal(busy.status, 503);
    assert.equal((await busy.json()).code, 'CT_BUSY');
  } finally { done(); }
  assert.equal((await request).status, 200);
});

test('Fehlende Kontakte erzeugen eine dauerhafte zentrale Warnung und blockieren die Gruppe nicht', async (t) => {
  let fixed = false;
  let unavailable = false;
  const f = await fixture(t, false, { async checkConnection() {}, async readSnapshot() {
    if (unavailable) throw new Error('Private upstream response');
    return { groups: [{ id: 260, name: 'Nicht im Fehler ausgeben', information: {
      website_expose: true, website_contact_person_ids: fixed ? '' : '999',
    } }], persons: [], masterData: { groupCategories: [], targetGroups: [] } };
  } });
  const user = await loginToSettings(f);
  assert.equal((await f.get('/warnings', f.cookie)).status, 303);
  const response = await f.post('/settings/preview', user.cookie, { csrf: user.csrf });
  assert.equal(response.status, 303);
  assert.match(await (await f.get('/settings', user.cookie)).text(), /Ausgewählte Gruppen<\/dt><dd>1<\/dd>/);
  const html = await (await f.get('/warnings', user.cookie)).text();
  assert.match(html, /Gruppe 260, Feld information.website_contact_person_ids/);
  assert.match(html, /Ansprechpartner-ID 999/);
  assert.equal(html.includes('Nicht im Fehler ausgeben'), false);
  assert.equal(f.warningStore.openCount(), 1);
  assert.match(await (await f.get('/', user.cookie)).text(), /1 offene Warnung/);
  const freshLogin = await f.get('/login');
  const freshCookie = freshLogin.headers.get('set-cookie')!.split(';')[0]!;
  const freshCsrf = /name="csrf" value="([a-f0-9]+)"/.exec(await freshLogin.text())![1]!;
  const anotherSession = await loginToSettings({ ...f, cookie: freshCookie, csrf: freshCsrf });
  assert.match(await (await f.get('/warnings', anotherSession.cookie)).text(), /Ansprechpartner-ID 999/);
  await f.post('/settings/preview', user.cookie, { csrf: user.csrf });
  assert.equal(f.warningStore.snapshot().length, 1);
  assert.equal(f.warningStore.snapshot()[0]!.occurrences, 2);
  unavailable = true;
  const failedCheck = await f.post('/settings/preview', user.cookie, { csrf: user.csrf });
  assert.equal(failedCheck.status, 502);
  assert.equal((await failedCheck.text()).includes('Private upstream response'), false);
  assert.equal(f.warningStore.openCount(), 1);
  unavailable = false;
  fixed = true;
  await f.post('/settings/preview', user.cookie, { csrf: user.csrf });
  assert.equal(f.warningStore.openCount(), 0);
  assert.equal(f.warningStore.snapshot()[0]!.status, 'resolved');
  assert.match(await (await f.get('/warnings', user.cookie)).text(), /Behobene Warnungen \(1\)/);
});


test('Startabruf stellt Daten ohne manuellen Klick nach Anmeldung bereit', async (t) => {
  let calls = 0;
  const ct = { checkConnection: async () => {}, readSnapshot: async () => {
    calls++;
    return { groups: [{ id: 42, name: 'Startup group', information: { website_expose: true } }], persons: [], masterData: { groupCategories: [], targetGroups: [] } };
  } };
  const f = await fixture(t, false, ct, true);
  await f.initialLoad;
  assert.equal(calls, 1);
  assert.equal((await f.get('/data')).headers.get('location'), '/login');
  const login = await f.post('/login', f.cookie, { csrf: f.csrf, username: 'test-admin', password: secret });
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const response = await f.get('/data', cookie);
  assert.match(await response.text(), /Startup group/);
  const settings = await (await f.get('/settings', cookie)).text();
  const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(settings)![1]!;
  assert.equal((await f.post('/settings/preview', cookie, { csrf }, true)).status, 200);
  assert.equal(calls, 2);
  const history = await (await f.get('/data', cookie)).text();
  assert.match(history, /Abrufhistorie/);
  assert.match(history, /<th>Dauer<\/th>/);
  assert.equal((history.match(/\d+,\d s<\/td>/g) ?? []).length, 2);
  assert.match(history, /Anwendungsstart/);
  assert.match(history, /Manuelle Auswahlprüfung/);
  assert.equal((history.match(/<time datetime=/g) ?? []).length, 2);
});

test('Fehler im Startabruf lassen die Weboberfläche nutzbar und einen erneuten Versuch zu', async (t) => {
  let calls = 0;
  const f = await fixture(t, false, { checkConnection: async () => {}, readSnapshot: async () => {
    if (++calls === 1) throw new Error('private-error');
    return { groups: [], persons: [], masterData: { groupCategories: [], targetGroups: [] } };
  } }, true);
  await f.initialLoad;
  const login = await f.post('/login', f.cookie, { csrf: f.csrf, username: 'test-admin', password: secret });
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const html = await (await f.get('/data', cookie)).text();
  assert.match(html, /Automatischer CT-Abruf fehlgeschlagen/);
  assert.match(html, /❌ Fehlgeschlagen/);
  assert.equal(html.includes('private-error'), false);
  const settings = await (await f.get('/settings', cookie)).text();
  const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(settings)![1]!;
  assert.equal((await f.post('/settings/preview', cookie, { csrf }, true)).status, 200);
});


test('SFTP-Upload benötigt Anmeldung, CSRF und aktuellen Datenstand', async (t) => {
  let calls = 0;
  const f = await fixture(t, false, { checkConnection: async () => {}, readSnapshot: async () => ({ groups: [], persons: [], masterData: { groupCategories: [], targetGroups: [] } }) }, true,
    { upload: async () => { calls++; return '/private/export-test'; } });
  await f.initialLoad;
  assert.equal((await f.get('/upload')).headers.get('location'), '/login');
  const login = await f.post('/login', f.cookie, { csrf: f.csrf, username: 'test-admin', password: secret });
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const html = await (await f.get('/upload', cookie)).text();
  const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(html)![1]!;
  const revision = f.exportSettings.snapshot().revision;
  assert.equal((await f.post('/upload', cookie, { csrf: 'wrong', revision })).status, 403);
  assert.equal((await f.post('/upload', cookie, { csrf, revision: 'old' })).status, 409);
  assert.equal(calls, 0);
  const response = await f.post('/upload', cookie, { csrf, revision });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /JSON-Dateien hochgeladen/);
  assert.equal(calls, 1);
});


test('Abmelden steht genau einmal im Kopf jeder geschützten Seite mit gültigem CSRF', async (t) => {
  const f = await fixture(t);
  assert.equal((await (await f.get('/login')).text()).includes('action="/logout"'), false);
  const login = await f.post('/login', f.cookie, { csrf: f.csrf, username: 'test-admin', password: secret });
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  let csrf = '';
  for (const path of ['/', '/settings', '/configuration', '/data', '/warnings', '/upload', '/wordpress-imports']) {
    const html = await (await f.get(path, cookie)).text();
    assert.equal(html.split('action="/logout"').length - 1, 1, path);
    const header = /<header>([\s\S]*?)<\/header>/.exec(html)![1]!;
    assert.match(header, /action="\/logout"/);
    assert.match(header, /class="user-avatar" title="test-admin" aria-label="Angemeldet als test-admin">TA<\/button>/);
    assert.ok(header.indexOf('Abmelden') < header.indexOf('user-avatar'));
    csrf = /name="csrf" value="([a-f0-9]+)"/.exec(header)![1]!;
  }
  assert.equal((await f.post('/logout', cookie, { csrf })).status, 303);
  assert.equal((await f.get('/data', cookie)).headers.get('location'), '/login');
});


test('Archivdateien sind nach Anmeldung über die Historie erreichbar',async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),'ct-web-archive-'));
 const archive=await JsonArchive.load(dir);
 const f=await fixture(t,false,{checkConnection:async()=>{},readSnapshot:async()=>({groups:[],persons:[],masterData:{groupCategories:[],targetGroups:[]}})},true,undefined,archive);
 await f.initialLoad;
 t.after(async()=>{for(const folder of await readdir(dir)){for(const file of await readdir(join(dir,folder)))await unlink(join(dir,folder,file));await rmdir(join(dir,folder));}await rmdir(dir);});
 const user=await loginToSettings(f);
 const html=await(await f.get('/data',user.cookie)).text();
 const url=/href="(\/data\/archive\/[a-f0-9-]+\/groups)"/.exec(html)![1]!;
 assert.equal((await f.get(url)).headers.get('location'),'/login');
 const response=await f.get(url,user.cookie);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const content=await response.text();assert.match(content,/_groups.json/);assert.match(content,/<code>\[\]<\/code>/);
});


test('SFTP-Verbindungstest ist geschützt, benötigt keine CT-Daten und erhält letzte Erfolgszeit bei Fehlern', async(t)=>{
 let checks=0,uploads=0,fail=false;
 const f=await fixture(t,false,undefined,false,{upload:async()=>{uploads++;return '';},checkConnection:async()=>{checks++;if(fail)throw Error('private-details');}});
 assert.equal((await f.post('/sftp/check',f.cookie,{csrf:f.csrf},true)).status,401);
 const user=await loginToSettings(f);
 assert.equal((await f.post('/sftp/check',user.cookie,{csrf:'invalid'},true)).status,403);
 assert.equal(checks,0);
 const success=await f.post('/sftp/check',user.cookie,{csrf:user.csrf},true);
 assert.equal(success.status,200);const result=await success.json();assert.equal(result.status,'connected');assert.ok(result.lastSuccess);
 let page=await(await f.get('/upload',user.cookie)).text();assert.match(page,/sftp-check-form/);assert.match(page,/Europe\/Berlin/);assert.equal(page.includes('Noch keine</span>'),false);
 fail=true;const failure=await f.post('/sftp/check',user.cookie,{csrf:user.csrf},true);assert.equal(failure.status,502);const error=await failure.json();assert.equal(error.lastSuccess,result.lastSuccess);assert.equal(error.message.includes('private-details'),false);
 assert.equal(uploads,0);assert.equal(checks,2);
});


test('Fehlerhafte anonyme Bildprüfung sperrt Webupload auch mit nachgebildetem Transport',async(t)=>{
 let uploads=0;
 const f=await fixture(t,false,{checkConnection:async()=>{},readSnapshot:async()=>({groups:[],persons:[],masterData:{groupCategories:[],targetGroups:[]}})},true,{upload:async()=>{uploads++;return '/remote';}},undefined,
 async(data)=>({checkedAt:new Date().toISOString(),uploadAllowed:false,...dataHashes(data),errors:[{personId:73,code:'HTTP',httpStatus:403}]}));
 await f.initialLoad;const user=await loginToSettings(f);
 const page=await(await f.get('/data',user.cookie)).text();assert.match(page,/SFTP gesperrt/);assert.match(page,/Person 73: HTTP/);
 const upload=await(await f.get('/upload',user.cookie)).text();assert.match(upload,/<button disabled>JSON-Dateien via SFTP/);
 const response=await f.post('/upload',user.cookie,{csrf:user.csrf,revision:f.exportSettings.snapshot().revision});assert.equal(response.status,409);assert.equal(uploads,0);
});


test('Archivierte lokale Bilder sind anonym erreichbar, JSON bleibt geschützt und URLs zeigen auf die Anwendung',async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),'ct-public-images-'));const archive=await JsonArchive.load(dir);
 t.after(async()=>{for(const folder of await readdir(dir)){for(const file of await readdir(join(dir,folder)))await unlink(join(dir,folder,file));await rmdir(join(dir,folder));}await rmdir(dir);});
 const png=await sharp({create:{width:2,height:2,channels:3,background:'blue'}}).png().toBuffer();
 const preview=buildDataPreview({groups:[],persons:[],masterData:{groupCategories:[],targetGroups:[]}}, {groups:[],persons:[],warnings:[]},new Date().toISOString());
 preview.technicalPersons=[{id:20,firstName:'A',lastName:'B',email:'',imageUrl:'https://ct.example/private',responsibilities:'',sortOrder:1,groups:[]}];
 const entry=await archive.save(preview,{startedAt:new Date().toISOString(),source:'manual',status:'loading'},'a'.repeat(64),{publicBaseUrl:'https://exports.example',download:async()=>new Map([['https://ct.example/private',{body:png}]])});
 assert.equal(entry.uploadAllowed,true);assert.match(entry.archiveId!,/^[a-f0-9]{64}$/);
 const sizes=await Promise.all((await readdir(join(dir,entry.archiveId!))).map(async(name)=>(await readFile(join(dir,entry.archiveId!,name))).byteLength));
 assert.equal(entry.totalBytes,sizes.reduce((sum,size)=>sum+size,0));
 const loaded=await JsonArchive.load(dir);const f=await fixture(t,false,undefined,false,undefined,loaded);
 const path=new URL(preview.technicalPersons[0]!.imageUrl).pathname;
 const response=await f.get(path);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('set-cookie'),null);
 const body=Buffer.from(await response.arrayBuffer());assert.equal((await sharp(body).metadata()).width,2);
 assert.equal((await f.get('/data/archive/'+entry.archiveId+'/contactPersons')).headers.get('location'),'/login');
 assert.equal((await f.get('/media/'+entry.archiveId+'/'+'b'.repeat(64)+'.png')).status,404);
 const manifest=JSON.parse(await readFile(join(dir,entry.archiveId!,'manifest.json'),'utf8'));assert.equal(manifest.imageValidation.mode,'authenticated-local');assert.equal(manifest.files.groups.uploadAllowed,true);
});


test('Bildgröße wird asynchron gespeichert und im nächsten Abruf ohne Neustart angewendet; 0 deaktiviert Verkleinerung',async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),'ct-config-images-'));const archive=await JsonArchive.load(dir);
 t.after(async()=>{for(const folder of await readdir(dir)){for(const file of await readdir(join(dir,folder)))await unlink(join(dir,folder,file));await rmdir(join(dir,folder));}await rmdir(dir);});
 const body=await sharp({create:{width:1200,height:600,channels:3,background:'red'}}).png().toBuffer();let reads=0;
 const f=await fixture(t,false,{checkConnection:async()=>{},readSnapshot:async()=>{reads++;return {groups:[],persons:[{id:20,firstName:'A',lastName:'B',website_expose:true,imageUrl:'https://ct.example/image'}],masterData:{groupCategories:[],targetGroups:[]}};},downloadImages:async()=>new Map([['https://ct.example/image',{body}]])},false,undefined,archive,false);
 const user=await loginToSettings(f);
 assert.match(await(await f.get('/settings',user.cookie)).text(),/name="personMaxEdge" type="number"/);
 const invalid=await f.post('/settings',user.cookie,{...user.fields,csrf:user.csrf,revision:user.revision,personMaxEdge:'12'},true);assert.equal(invalid.status,422);assert.deepEqual((await invalid.json()).fields,['personMaxEdge']);
 for(const [edge,expectedWidth,expectedHeight] of [[320,320,160],[0,1200,600]]){
  const save=await f.post('/settings',user.cookie,{...user.fields,csrf:user.csrf,revision:f.exportSettings.snapshot().revision,personMaxEdge:String(edge)},true);assert.equal(save.status,200);
  const previousReads=reads;
  assert.equal((await f.post('/settings/preview',user.cookie,{csrf:user.csrf},true)).status,200);assert.equal(reads,previousReads+1);
  const entry=archive.entries[0]!;assert.equal(entry.uploadAllowed,true);
  const file=await archive.readMedia(entry.archiveId!,entry.media![0]!);const meta=await sharp(file).metadata();assert.equal(meta.width,expectedWidth);assert.equal(meta.height,expectedHeight);
 }
 assert.equal(reads,2);
});


test('WordPress-Importseite schützt Start/Status und zeigt getrennte laufende bzw. abgeschlossene Importe',async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),'wp-web-'));const file=join(dir,'state.json');let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});let triggers=0;
 const imports=await WordpressImports.load({endpoint:'https://example.org/wp-load.php',key:'private-key'},file,{request:async(_config,id,action)=>{if(action==='trigger'){triggers++;return {status:200,message:'#'+id+' Cron job triggered.'};}await pending;return {status:200,message:'Import #'+id+' complete'};}});
 t.after(async()=>{release();await imports.stop();await unlink(file).catch(()=>{});await rmdir(dir);});
 const f=await fixture(t,false,undefined,false,undefined,undefined,undefined,imports);
 assert.equal((await f.get('/wordpress-imports')).headers.get('location'),'/login');
 const user=await loginToSettings(f);assert.equal((await f.post('/wordpress-imports/start',user.cookie,{csrf:'invalid',importId:'5',mode:'start'},true)).status,403);
 assert.equal((await f.post('/wordpress-imports/start',user.cookie,{csrf:user.csrf,importId:'5',mode:'start'},true)).status,202);
 assert.equal((await f.post('/wordpress-imports/start',user.cookie,{csrf:user.csrf,importId:'5',mode:'start'},true)).status,409);
 assert.equal(triggers,1);
 const status=await(await f.get('/wordpress-imports/status',user.cookie)).json();assert.equal(status.wordpress.imports[0].status,'running');assert.equal(status.wordpress.imports[1].status,'idle');
 const html=await(await f.get('/wordpress-imports',user.cookie)).text();assert.match(html,/Import in WordPress/);assert.match(html,/<button disabled>⏳ Import läuft/);assert.equal(html.includes('private-key'),false);
 release();await imports.wait(5);const finished=await(await f.get('/wordpress-imports/status',user.cookie)).json();assert.equal(finished.wordpress.imports[0].lastCompleted.successful,true);
});


test('Geänderte Import-URLs werden geprüft, sofort benutzt und bei Fehlern mit alten Formularwerten beantwortet',async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),'wp-url-form-'));const file=join(dir,'state.json');let good=true,probes=0;
 const imports=await WordpressImports.load(undefined,file,{request:async()=>{probes++;return good?{status:403,message:'Import #5 is not triggered. Request skipped.'}:{status:403,message:'Denied'};}});
 t.after(async()=>{await imports.stop();await unlink(file).catch(()=>{});await rmdir(dir);});
 const f=await fixture(t,false,undefined,false,undefined,undefined,undefined,imports);const user=await loginToSettings(f);
 const pair={contactsTriggerUrl:'https://wp.example/wp-load.php?import_key=private&import_id=5&action=trigger',contactsProcessingUrl:'https://wp.example/wp-load.php?import_key=private&import_id=5&action=processing'};
 assert.equal((await f.post('/settings',user.cookie,{...user.fields,csrf:user.csrf,revision:user.revision,...pair},true)).status,200);
 assert.equal(probes,1);assert.equal(f.exportSettings.snapshot().config.export.wordpress.contactsTriggerUrl,pair.contactsTriggerUrl);
 const before=await readFile(join(f.directory,'export.json'),'utf8');good=false;
 const rejected=await f.post('/settings',user.cookie,{...user.fields,csrf:user.csrf,revision:f.exportSettings.snapshot().revision,contactsTriggerUrl:pair.contactsTriggerUrl.replace('wp.example','bad.example'),contactsProcessingUrl:pair.contactsProcessingUrl.replace('wp.example','bad.example')},true);
 assert.equal(rejected.status,422);const failure=await rejected.json();assert.equal(failure.resetValues.contactsTriggerUrl,pair.contactsTriggerUrl);assert.ok(failure.fields.includes('contactsProcessingUrl'));assert.equal(await readFile(join(f.directory,'export.json'),'utf8'),before);
});


test('Startabruf wird auf Übersicht als laufend gezeigt und CT-Status nach Abschluss freigegeben',async(t)=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});let checks=0;
 const f=await fixture(t,false,{checkConnection:async()=>{checks++;},readSnapshot:async()=>{await pending;return {groups:[],persons:[],masterData:{groupCategories:[],targetGroups:[]}};}},true);
 try{
  assert.equal((await f.get('/ct/status')).status,401);
  const user=await loginToSettings(f);
  assert.equal((await(await f.get('/ct/status',user.cookie)).json()).busy,true);
  const html=await(await f.get('/',user.cookie)).text();assert.match(html,/<button disabled>⏳ CT-Prüfung läuft bereits/);
  const collision=await f.post('/ct/check',user.cookie,{csrf:user.csrf},true);assert.equal(collision.status,202);assert.equal((await collision.json()).status,'busy');assert.equal(checks,0);
  release();await f.initialLoad;
  assert.equal((await(await f.get('/ct/status',user.cookie)).json()).busy,false);
 }finally{release();await f.initialLoad;}
});


for (const age of [5 * 60 * 1000, 30 * 60 * 1000, 30 * 60 * 1000 + 1]) {
 test('Startabruf berücksichtigt Archiv-Alter ' + age + ' ms und stellt aktuelle Archive wieder her', async(t)=>{
  const now = Date.now();
  const dir=await mkdtemp(join(tmpdir(),'ct-start-cache-'));
  const archive=await JsonArchive.load(dir);
  const snapshot={groups:[{id:42,name:'Archivgruppe',information:{website_expose:true}}],persons:[],masterData:{groupCategories:[],targetGroups:[]}};
  const preview=buildDataPreview(snapshot,{groups:[{id:42,name:'Archivgruppe',categories:[],targetGroups:[],ageCategory:'',recurrenceDescription:'',contactPersonIds:[],showOnLandingPage:false}],persons:[],warnings:[]},new Date(now-age).toISOString());
  preview.imageValidation={mode:'authenticated-local',checkedAt:new Date(now).toISOString(),uploadAllowed:true,...dataHashes(preview),errors:[]};
  await archive.save(preview,{startedAt:new Date(now-age).toISOString(),source:'manual',status:'loading'},'a'.repeat(64));
  let calls=0;
  const f=await fixture(t,false,{checkConnection:async()=>{},readSnapshot:async()=>{calls++;return snapshot;}},true,undefined,await JsonArchive.load(dir),undefined,undefined,now);
  await f.initialLoad;
  t.after(async()=>{for(const folder of await readdir(dir)){for(const file of await readdir(join(dir,folder)))await unlink(join(dir,folder,file));await rmdir(join(dir,folder));}await rmdir(dir);});
  assert.equal(calls,age>30*60*1000?1:0);
  const user=await loginToSettings(f);
  const html=await(await f.get('/data',user.cookie)).text();
  assert.match(html,/Archivgruppe/);
  if(age<=30*60*1000) {
   assert.equal((html.match(/<time datetime=/g)??[]).length,1);
   const settings=await(await f.get('/settings',user.cookie)).text();
   const csrf=/name="csrf" value="([a-f0-9]+)"/.exec(settings)![1]!;
   assert.equal((await f.post('/settings/preview',user.cookie,{csrf},true)).status,200);
   assert.equal(calls,1);
  }
 });
}


test('Konfigurierter Kopfbereich erscheint auf Anmeldung und allen Verwaltungsseiten als sicherer Text',async(t)=>{
 const label='Gemeinde <script>alert(1)</script> & $&';
 const f=await fixture(t,false,undefined,false,undefined,undefined,undefined,undefined,undefined,label);
 const expected='Gemeinde &lt;script&gt;alert(1)&lt;/script&gt; &amp; $&amp;';
 assert.ok((await(await f.get('/login')).text()).includes(expected));
 const user=await loginToSettings(f);
 for(const path of ['/','/settings','/data','/upload','/configuration','/warnings','/wordpress-imports']) {
  const html=await(await f.get(path,user.cookie)).text();
  assert.ok(html.includes('<span>'+expected+'</span>'),path);
  assert.equal(html.includes('<script>alert(1)</script>'),false);
 }
});


test('E-Mail-Label wird asynchron gespeichert, markiert Fehler und gilt beim nächsten Abruf',async(t)=>{
 const f=await fixture(t,false,{checkConnection:async()=>{},readSnapshot:async()=>({groups:[],persons:[{id:20,firstName:'A',lastName:'B',website_expose:true,emails:[{email:'default@example.org',isDefault:true},{email:'preferred@example.org',contactLabelId:23}]}],masterData:{groupCategories:[],targetGroups:[]}})});
 const user=await loginToSettings(f);
 const form={...user.fields,csrf:user.csrf,revision:user.revision,preferredContactLabelId:'23'};
 const saved=await f.post('/settings',user.cookie,form,true);assert.equal(saved.status,200);
 const revision=(await saved.json()).revision;
 assert.equal(f.exportSettings.snapshot().config.export.email.preferredContactLabelId,23);
 assert.equal((await ExportSettingsStore.load(join(f.directory,'export.json'))).snapshot().config.export.email.preferredContactLabelId,23);
 assert.match(await(await f.get('/settings',user.cookie)).text(),/name="preferredContactLabelId"[^>]*data-saved-value="23"[^>]*value="23"/);
 assert.equal((await f.post('/settings/preview',user.cookie,{csrf:user.csrf},true)).status,200);
 assert.match(await(await f.get('/data',user.cookie)).text(),/preferred@example.org/);
 const invalid=await f.post('/settings',user.cookie,{...form,revision,preferredContactLabelId:'0'},true);
 assert.equal(invalid.status,422);assert.deepEqual((await invalid.json()).fields,['preferredContactLabelId']);
 assert.equal(f.exportSettings.snapshot().config.export.email.preferredContactLabelId,23);
 const cleared=await f.post('/settings',user.cookie,{...form,revision,preferredContactLabelId:''},true);
 assert.equal(cleared.status,200);assert.equal(f.exportSettings.snapshot().config.export.email.preferredContactLabelId,null);
});
