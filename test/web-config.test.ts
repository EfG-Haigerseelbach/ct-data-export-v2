import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWebSettings, parseAccountFile, parseWebEnvironment, StartupError } from '../src/web/config.js';
import { readEnvironmentInfo } from '../src/web/config.js';
import { configurationPage } from '../src/web/views.js';

test('Umgebungsanzeige unterscheidet fehlende, leere und belegte Tokens ohne Tokenwert', () => {
  for (const [value, expected] of [[undefined, 'Nicht gesetzt'], ['', 'Gesetzt, aber leer'], ['  ', 'Gesetzt, aber leer'], ['synthetic-token-private', 'Gesetzt und nicht leer']] as const) {
    const info = readEnvironmentInfo({ CT_BASE_URL: 'https://example.church.tools/<script>', ...(value !== undefined ? { CT_API_TOKEN: value } : {}) });
    const html = configurationPage(info);
    assert.ok(html.includes(expected));
    assert.ok(html.includes('https://example.church.tools/&lt;script&gt;'));
    assert.equal(JSON.stringify(info).includes('synthetic-token-private'), false);
    assert.equal(html.includes('synthetic-token-private'), false);
    assert.equal(html.includes('<script>'), false);
  }
});

const account = { username: 'test-admin', salt: 'a'.repeat(32), hash: 'b'.repeat(64) };
const code = (expected: string) => (error: unknown) => error instanceof StartupError && error.code === expected;

test('Zusatzfelder verhindern den Start nicht und gelangen nicht in die Kontodaten', () => {
  const result = parseAccountFile(JSON.stringify({ ...account, password_explicit: 'synthetic-private-value', capi_login_token: 'synthetic-token' }));
  assert.deepEqual(result.account, account);
  assert.equal(result.ignoredFields, 2);
  assert.equal(JSON.stringify(result).includes('synthetic-'), false);
});

test('Windows-JSON mit BOM wird gelesen, fehlerhafte Dateien werden konkret abgewiesen', () => {
  assert.deepEqual(parseAccountFile('\uFEFF' + JSON.stringify(account)).account, account);
  assert.throws(() => parseAccountFile('{'), code('ACCOUNT_JSON'));
  assert.throws(() => parseAccountFile(JSON.stringify({ username: 'test', password: 'synthetic' })), code('ACCOUNT_INVALID'));
  assert.throws(() => parseAccountFile('null'), code('ACCOUNT_INVALID'));
});

test('Fehlender lokaler Zugang hat eine eigene Einrichtungsfehlermeldung', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ct-startup-'));
  try { await assert.rejects(loadWebSettings({}, join(directory, 'missing.json')), code('ACCOUNT_MISSING')); }
  finally { await rmdir(directory); }
});

test('Webstart erlaubt alle Kombinationen fehlender oder leerer CT-Zugangsdaten', () => {
  for (const baseUrl of [undefined, '', '  ', 'https://example.church.tools']) {
    for (const apiToken of [undefined, '', '  ', 'synthetic-secret']) {
      if (baseUrl?.trim() && apiToken?.trim()) continue;
      const env = { ...(baseUrl !== undefined ? { CT_BASE_URL: baseUrl } : {}),
        ...(apiToken !== undefined ? { CT_API_TOKEN: apiToken } : {}) };
      const result = parseWebEnvironment(env);
      assert.equal(result.ctConfig, undefined);
      assert.deepEqual(result.environmentInfo, readEnvironmentInfo(env));
    }
  }
  assert.ok(parseWebEnvironment({ CT_BASE_URL: 'https://example.church.tools', CT_API_TOKEN: 'synthetic-secret' }).ctConfig);
});

test('Port und ungültige vollständige CT-Konfiguration werden ohne Geheimnisse gemeldet', () => {
  assert.equal(parseWebEnvironment({}).port, 3000);
  assert.throws(() => parseWebEnvironment({ PORT: 'bad' }), code('PORT_INVALID'));
  assert.throws(() => parseWebEnvironment({ CT_BASE_URL: 'invalid', CT_API_TOKEN: 'synthetic-secret' }), code('CT_CONFIG'));
  try {
    parseWebEnvironment({ CT_BASE_URL: 'https://example.church.tools', CT_API_TOKEN: 'synthetic-secret', CT_MAX_PAGES: '-1' });
    assert.fail('Ungültige Konfiguration wurde akzeptiert');
  } catch (error) {
    assert.ok(error instanceof StartupError);
    assert.equal(error.code, 'CT_CONFIG');
    assert.equal(error.message.includes('synthetic-secret'), false);
  }
  assert.throws(() => parseWebEnvironment({ CT_WEB_SECURE_COOKIE: 'wrong' }), code('COOKIE_CONFIG'));
});


test('Initialen berücksichtigen Namensbestandteile und HTML-sichere Tooltips', async () => {
  const { userInitials, configurationPage } = await import('../src/web/views.js');
  assert.equal(userInitials('Max Mustermann'), 'MM');
  assert.equal(userInitials('test-admin'), 'TA');
  assert.equal(userInitials('tester'), 'TE');
  const html = configurationPage({ baseUrl: undefined, tokenSet: false, tokenNonEmpty: false }, 0, 'csrf', 'Max "<script>');
  assert.match(html, /title="Max &quot;&lt;script&gt;"/);
  assert.equal(html.includes('<script>'), false);
});


test('Konfiguration zeigt ausschließlich freigegebene SFTP-Werte ohne zusätzlichen Abschnitt', () => {
 const info = readEnvironmentInfo({ SFTP_HOST: 'sftp.example.org', SFTP_PORT: '2222', SFTP_DIRECTORY: '/private/<data>', SFTP_HOST_FINGERPRINT: 'SHA256:example', SFTP_PASSWORD: 'synthetic-secret', SFTP_PRIVATE_KEY_PASSPHRASE: 'synthetic-passphrase' });
 const html = configurationPage(info);
 for (const value of ['SFTP_HOST', 'SFTP_PORT', 'SFTP_DIRECTORY', 'SFTP_HOST_FINGERPRINT', 'sftp.example.org', '2222', '/private/&lt;data&gt;', 'SHA256:example']) assert.ok(html.includes(value));
 assert.equal(html.includes('SFTP-Einstellungen'), false);
 assert.equal(JSON.stringify(info).includes('synthetic-'), false);
 assert.equal(html.includes('synthetic-'), false);
 assert.equal((html.match(/<section/g) ?? []).length, 1);
});


test('Öffentliche Basisadresse für lokale Bild-URLs ist konfigurierbar und enthält keine Zugangsdaten',()=>{
 assert.equal(parseWebEnvironment({PORT:'3001'}).publicBaseUrl,'http://127.0.0.1:3001');
 assert.equal(parseWebEnvironment({APP_PUBLIC_BASE_URL:'https://exports.example/ct/'}).publicBaseUrl,'https://exports.example/ct');
 for(const value of ['https://user:secret@example.org','https://example.org/?secret=value','ftp://example.org']) assert.throws(()=>parseWebEnvironment({APP_PUBLIC_BASE_URL:value}),code('PUBLIC_URL'));
});


test('Uploadtext nennt Zeitpunkt des zugehörigen Datenabrufs in Berliner Zeit',async()=>{
 const {uploadPage}=await import('../src/web/views.js');
 const html=uploadPage('csrf','rev',true,true,'',0,'admin',undefined,false,'2026-10-27T10:15:30Z');
 assert.match(html,/Datenabruf vom 27\.10\.2026, 11:15:30 \(Europe\/Berlin\)/);
 assert.equal(uploadPage('csrf','rev',true,false).includes('Invalid Date'),false);
});


test('Beschriftung des Kopfbereichs ist optional und wird getrimmt',()=>{
 assert.equal(parseWebEnvironment({}).headerLabel,'');
 assert.equal(parseWebEnvironment({APP_HEADER_LABEL:'   '}).headerLabel,'');
 assert.equal(parseWebEnvironment({APP_HEADER_LABEL:'  Beispielgemeinde  '}).headerLabel,'Beispielgemeinde');
});
