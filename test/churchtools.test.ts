import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { ChurchToolsApi, CtError } from '../src/churchtools/client.js';
import { readCtConfig, validateCtConfig } from '../src/churchtools/config.js';
import type { CtConfig } from '../src/churchtools/config.js';
import { collectContactPersonIds, buildSelection } from '../src/export/selection.js';
import { defaultExportSettings } from '../src/export/settings.js';

const token = 'synthetic-ct-token-not-a-real-secret';
const json = (res: ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data));
};
const page = (data: unknown[], current = 1, lastPage = 1) => ({ data, meta: { pagination: { current, lastPage } } });
type Handler = (url: URL, req: IncomingMessage, res: ServerResponse) => boolean | void;

async function fake(t: TestContext, handler: Handler = () => {}, overrides: Partial<CtConfig> = {}) {
  let logins = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    assert.equal(req.headers['x-onlyauthenticated'], '1');
    if (handler(url, req, res)) return;
    if (url.pathname === '/api/whoami') {
      if (url.searchParams.has('login_token')) {
        assert.equal(url.searchParams.get('login_token'), token);
        assert.equal(url.searchParams.get('with_session'), 'true');
        logins++;
        res.setHeader('Set-Cookie', 'ct_test=session; Path=/; HttpOnly');
      } else if (!req.headers.cookie?.includes('ct_test=session')) { json(res, {}, 401); return; }
      json(res, { data: { id: 7, firstName: 'Synthetic' } }); return;
    }
    assert.ok(req.headers.cookie?.includes('ct_test=session'));
    assert.equal(url.searchParams.has('login_token'), false);
    if (url.pathname === '/api/groups') json(res, page([{ id: 10, name: 'Test', information: {} }]));
    else if (url.pathname === '/api/persons') json(res, page([{ id: 20, firstName: 'Alex', lastName: 'Test' }]));
    else if (url.pathname.startsWith('/api/files/avatar/')) json(res, { data: { fileUrl: 'https://example.org/?q=public/filedownload&id=1&filename=synthetic-hash' } });
    else if (url.pathname === '/api/person/masterdata') json(res, { data: { groupCategories: [], targetGroups: [] } });
    else json(res, {}, 404);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections();
  }));
  const config = validateCtConfig({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    loginToken: token, requestTimeoutMs: 500, operationTimeoutMs: 2500, ...overrides }, true);
  return { api: new ChurchToolsApi(config, { allowHttpLoopback: true }), config, logins: () => logins };
}
const hasCode = (code: string) => (error: unknown) => error instanceof CtError && error.code === code
  && !JSON.stringify(error).includes(token) && !error.message.includes(token);

test('CT-Konfiguration ist optional, vollständig validiert und erlaubt produktiv nur HTTPS', () => {
  assert.equal(readCtConfig({}), undefined);
  assert.throws(() => readCtConfig({ CT_BASE_URL: 'https://test.church.tools' }));
  for (const baseUrl of ['http://test.church.tools', 'https://user:pass@test.church.tools', 'https://test.church.tools/api', 'https://test.church.tools?token=secret']) {
    assert.throws(() => validateCtConfig({ baseUrl, loginToken: token }));
  }
  const config = readCtConfig({ CT_BASE_URL: 'https://test.church.tools/', CT_API_TOKEN: token });
  assert.equal(config!.baseUrl, 'https://test.church.tools');
  assert.equal(config!.maxRetries, 2);
});

test('Offizieller Client funktioniert unter ESM mit CookieJar und vollständigem Snapshot', async (t) => {
  const f = await fake(t);
  const result = await f.api.readSnapshot();
  assert.equal(result.groups[0]!.id, 10);
  assert.equal(result.persons[0]!.id, 20);
  assert.deepEqual(result.masterData.groupCategories, []);
  assert.equal(f.logins(), 1);
});

test('Freigegebene Gruppen liefern eindeutige Kontakt-IDs; gezielte Antworten behalten Exportattribute', async (t) => {
  const filtered: number[][] = [];
  const f = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/groups') {
      json(res, page([
        { id: 1, name: 'A', information: { website_expose: true, website_contact_person_ids: '20;21;20' } },
        { id: 2, name: 'B', information: { website_expose: true, website_contact_person_ids: '21,20' } },
        { id: 3, name: 'Hidden', information: { website_expose: false, website_contact_person_ids: '500' } },
      ])); return true;
    }
    if (url.pathname === '/api/persons') {
      const ids = url.searchParams.getAll('ids[]').map(Number);
      if (ids.length) {
        filtered.push(ids);
        json(res, page([{ id: 20, firstName: 'Targeted', lastName: 'Person',
          emails: [{ email: 'public@example.org', isDefault: true, contactLabelId: 7 }],
          imageUrl: 'https://example.org/image.jpg', mobile: 'synthetic-mobile', phonePrivate: 'synthetic-private', phoneWork: 'synthetic-work',
          website_responsibilities: 'Leitung', website_person_sort_order: 2,
        }]));
      } else json(res, page([
        { id: 21, firstName: 'Only listed', lastName: 'Unavailable in targeted query' },
        { id: 99, firstName: 'Standalone', lastName: 'Person', website_expose: true },
      ]));
      return true;
    }
  });
  const snapshot = await f.api.readSnapshot((groups) => collectContactPersonIds(groups, defaultExportSettings));
  assert.deepEqual(filtered, [[20, 21]]);
  assert.deepEqual(snapshot.requestedContactIds, [20, 21]);
  assert.deepEqual(snapshot.persons.map((p) => p.id), [20, 99]);
  const selected = buildSelection(snapshot, defaultExportSettings);
  assert.deepEqual(selected.warnings.map((w) => [w.groupId, w.personId]), [[1, 21], [2, 21]]);
  const contact = selected.persons.find((p) => p.id === 20)!;
  assert.equal(contact.emailCandidates[0]!.email, 'public@example.org');
  assert.equal(contact.imageUrl, 'https://example.org/?q=public/filedownload&id=1&filename=synthetic-hash');
  assert.equal(contact.responsibilities, 'Leitung');
  assert.deepEqual(contact.phoneCandidates, { mobile: 'synthetic-mobile', private: 'synthetic-private', work: 'synthetic-work' });
});

test('Mehr als 100 eindeutige Kontakt-IDs werden in disjunkte Batches aufgeteilt', async (t) => {
  const batches: number[][] = [];
  const ids = Array.from({ length: 205 }, (_, index) => index + 1);
  const f = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/persons') {
      const requested = url.searchParams.getAll('ids[]').map(Number);
      if (requested.length) batches.push(requested);
      json(res, page(requested.map((id) => ({ id, firstName: 'Test', lastName: 'Person' })))); return true;
    }
  });
  const snapshot = await f.api.readSnapshot(() => [...ids, 1, 205]);
  assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 5]);
  assert.deepEqual(batches.flat(), ids);
  assert.equal(snapshot.contactPersons.length, 205);
  assert.equal(f.logins(), 1);
});

test('Verbotene Einzelkontakte werden isoliert; andere Ansprechpartner bleiben lesbar', async (t) => {
  const f = await fake(t, (url, _req, res) => {
    if (url.pathname !== '/api/persons') return false;
    const ids = url.searchParams.getAll('ids[]').map(Number);
    if (ids.includes(73)) { json(res, {}, 403); return true; }
    json(res, page(ids.map((id) => ({ id, firstName: 'Test', lastName: 'Person' })))); return true;
  });
  const snapshot = await f.api.readSnapshot(() => [73, 75]);
  assert.deepEqual(snapshot.contactPersons.map((p) => p.id), [75]);
});

test('Leere Kontaktliste ruft keine ungefilterte Ansprechpartnerabfrage auf', async (t) => {
  let personReads = 0;
  const f = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/persons') { personReads++; assert.equal(url.searchParams.has('ids[]'), false); json(res, page([])); return true; }
  });
  const snapshot = await f.api.readSnapshot(() => []);
  assert.equal(personReads, 1); // Nur die bestehende Liste für Personen mit eigener Freigabe.
  assert.deepEqual(snapshot.contactPersons, []);
});

test('Ungefragte Kontakt-IDs werden abgewiesen und fehlerhafte Referenzen behalten ihre Felddiagnose', async (t) => {
  const extra = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/persons') { json(res, page([{ id: 999, firstName: 'Unexpected', lastName: 'Person' }])); return true; }
  });
  await assert.rejects(extra.api.readSnapshot(() => [20]), hasCode('CT_RESPONSE'));
  let reads = 0;
  const invalid = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/groups') {
      json(res, page([{ id: 260, name: 'Test', information: { website_expose: true, website_contact_person_ids: 'not-an-id' } }])); return true;
    }
    if (url.pathname === '/api/persons') reads++;
  });
  await assert.rejects(invalid.api.readSnapshot((groups) => collectContactPersonIds(groups, defaultExportSettings)),
    (error: unknown) => error instanceof Error && error.message.includes('SELECTION_IDS')
      && error.message.includes('information.website_contact_person_ids') && !error.message.includes('not-an-id'));
  assert.equal(reads, 0);
});

test('Gefilterte Personenabfrage liest alle Seiten', async (t) => {
  const pages: number[] = [];
  const f = await fake(t, (url, req, res) => {
    if (url.pathname !== '/api/persons') return false;
    assert.match(url.search, /ids/);
    assert.ok(req.headers.cookie?.includes('ct_test=session'));
    const n = Number(url.searchParams.get('page')); pages.push(n);
    json(res, page([{ id: n, firstName: 'Test', lastName: 'Person' }], n, 2)); return true;
  });
  assert.equal((await f.api.getPersons([1, 2])).length, 2);
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(await f.api.getPersons([]), []);
  await assert.rejects(f.api.getPersons([-1]), hasCode('CT_RESPONSE'));
});

test('Ungültiger Token stoppt den Zugriff vor den Fachabfragen', async (t) => {
  let reads = 0;
  const f = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/whoami') { json(res, { message: token }, 401); return true; }
    reads++; return false;
  });
  await assert.rejects(f.api.getGroups(), hasCode('CT_AUTH'));
  assert.equal(reads, 0);
});

test('Gastantwort trotz HTTP 200 wird nicht als erfolgreiche Anmeldung akzeptiert', async (t) => {
  const f = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/whoami') { json(res, { data: { id: -1 } }); return true; }
  });
  await assert.rejects(f.api.checkConnection(), hasCode('CT_AUTH'));
});

test('Abgelaufene Sitzung wird einmal erneuert', async (t) => {
  let reads = 0;
  const f = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/groups' && ++reads === 1) { json(res, {}, 401); return true; }
  });
  assert.equal((await f.api.getGroups()).length, 1);
  assert.equal(f.logins(), 2);
});

test('Dauerhafte 401 und 403 werden begrenzt und bereinigt weitergegeben', async (t) => {
  for (const [status, code] of [[401, 'CT_AUTH'], [403, 'CT_FORBIDDEN']] as const) {
    let reads = 0;
    const f = await fake(t, (url, _req, res) => {
      if (url.pathname === '/api/groups') { reads++; json(res, { secret: token }, status); return true; }
    });
    await assert.rejects(f.api.getGroups(), hasCode(code));
    assert.equal(reads, status === 401 ? 2 : 1);
  }
});

test('429 respektiert Retry-After und die maximale Wiederholungszahl', async (t) => {
  let reads = 0;
  const f = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/groups') {
      reads++; res.setHeader('Retry-After', '0'); json(res, {}, 429); return true;
    }
  });
  await assert.rejects(f.api.getGroups(), hasCode('CT_RATE_LIMIT'));
  assert.equal(reads, 3);
});

test('Anfrage-Timeout bricht einen offenen Request tatsächlich ab', async (t) => {
  let closed = false;
  const f = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/groups') { res.on('close', () => { closed = true; }); return true; }
  }, { requestTimeoutMs: 100 });
  await assert.rejects(f.api.getGroups(), hasCode('CT_TIMEOUT'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(closed, true);
});

test('Gesamtbudget beendet Retry-After ohne weitere Anfrage', async (t) => {
  let reads = 0;
  const f = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/groups') { reads++; res.setHeader('Retry-After', '30'); json(res, {}, 429); return true; }
  }, { operationTimeoutMs: 150 });
  await assert.rejects(f.api.getGroups(), hasCode('CT_TIMEOUT'));
  assert.equal(reads, 1);
});

test('Seitenlimit, doppelte IDs und ungültige Antwortobjekte liefern keine Teildaten', async (t) => {
  const f = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/groups') { json(res, page([], 1, 999)); return true; }
  }, { maxPages: 2 });
  await assert.rejects(f.api.getGroups(), hasCode('CT_PAGE_LIMIT'));
  const duplicate = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/groups') { json(res, page([{ id: 1, name: 'Test', information: {} }, { id: 1, name: 'Test', information: {} }])); return true; }
  });
  await assert.rejects(duplicate.api.getGroups(), hasCode('CT_RESPONSE'));
  const malformed = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/persons') { json(res, page([{ email: token }])); return true; }
  });
  await assert.rejects(malformed.api.getPersons(), hasCode('CT_RESPONSE'));
});

test('Redirects werden nicht mit Zugangsdaten verfolgt', async (t) => {
  const f = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/whoami') { res.writeHead(302, { Location: 'https://example.org/' }); res.end(); return true; }
  });
  await assert.rejects(f.api.checkConnection(), hasCode('CT_HTTP'));
});


test('Avatar-Dateiendpunkt ersetzt geschützte URLs nur für ausgewählte Personen', async (t) => {
  const called: string[] = [];
  const publicUrl = 'https://example.church.tools/?q=public/filedownload&id=7&filename=hash';
  const f = await fake(t, (url, _req, res) => {
    if (url.pathname === '/api/persons') { json(res, page([
      { id: 20, firstName: 'A', lastName: 'Test', imageUrl: 'https://example.org/private' },
      { id: 21, firstName: 'B', lastName: 'Test', imageUrl: 'https://example.org/private' }
    ])); return true; }
    if (url.pathname.startsWith('/api/files/avatar/')) {
      called.push(url.pathname); json(res, { data: [{ fileUrl: publicUrl }] }); return true;
    }
  });
  const result = await f.api.readSnapshot(undefined, () => [20]);
  assert.deepEqual(called, ['/api/files/avatar/20']);
  assert.equal(result.persons[0]!.imageUrl, publicUrl);
  assert.equal(result.persons[1]!.imageUrl, '');
});

test('Kein Avatar bleibt leer; Rechte- und Antwortfehler werden sichtbar', async (t) => {
  for (const [status, body, expected] of [
    [404, {}, undefined], [200, { data: [] }, undefined], [200, { data: { fileUrl: null } }, undefined],
    [403, {}, 'CT_FORBIDDEN'], [200, { data: { fileUrl: 'https://example.org/private' } }, 'CT_RESPONSE'],
    [200, { data: { unexpected: true } }, undefined]
  ] as const) {
    const f = await fake(t, (url, _req, res) => {
      if (url.pathname.startsWith('/api/files/avatar/')) { json(res, body, status); return true; }
    });
    if (expected) await assert.rejects(f.api.getPersons(), hasCode(expected));
    else assert.equal((await f.api.getPersons())[0]!.imageUrl, '');
  }
});


test('Bilddownloads verwenden CT-Sitzung, sperren fremde Hosts und folgen keinen Redirects',async(t)=>{
 let downloads=0;
 const f=await fake(t,(url,req,res)=>{
  if(url.pathname==='/protected-image'){
   assert.ok(req.headers.cookie?.includes('ct_test=session'));assert.equal(url.searchParams.has('login_token'),false);
   downloads++;res.writeHead(200,{'Content-Type':'image/png'});res.end(Buffer.from('synthetic-binary'));return true;
  }
  if(url.pathname==='/redirect-image'){assert.ok(req.headers.cookie?.includes('ct_test=session'));res.writeHead(302,{Location:'/protected-image'});res.end();return true;}
 });
 const image=f.config.baseUrl+'/protected-image';const redirect=f.config.baseUrl+'/redirect-image';
 const result=await f.api.downloadImages([image,image,redirect,'https://other.example/image']);
 assert.equal(result.get(image)!.body!.toString(),'synthetic-binary');assert.equal(downloads,1);
 assert.equal(result.get(redirect)!.error,'HTTP_302');assert.equal(result.get('https://other.example/image')!.error,'CT_RESPONSE');
 assert.equal(f.logins(),1);
});
