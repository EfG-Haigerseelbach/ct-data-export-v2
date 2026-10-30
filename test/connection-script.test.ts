import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { connectionScript } from '../src/web/connection-script.js';

class Element {
  textContent = ''; className = ''; disabled = false; action = '/ct/check';
  attributes = new Map<string, string>(); children: (Element | string)[] = [];
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  append(...children: (Element | string)[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
}
const text = (node: Element | string): string => typeof node === 'string' ? node : node.textContent + node.children.map(text).join('');
type Payload = { status: string; message: string; busy?: boolean; code?: string };
function browser(fetcher: (url: string, options: RequestInit) => Promise<{ ok: boolean; headers: { get: () => string }; json: () => Promise<Payload> }>, initiallyBusy = false) {
  const output = new Element(), button = new Element(); button.textContent = 'CT-Verbindung prüfen'; button.disabled = initiallyBusy;
  let poll!: () => Promise<void>;
  let submit!: (event: { preventDefault(): void }) => Promise<void>;
  const form = { action: '/ct/check', querySelector: () => button,
    addEventListener: (_event: string, listener: typeof submit) => { submit = listener; } };
  runInNewContext(connectionScript, {
    document: { getElementById: (id: string) => id === 'ct-check-form' ? form : output,
      createElement: () => new Element(), createTextNode: (value: string) => value },
    FormData: class { *[Symbol.iterator]() { yield ['csrf', 'test-csrf']; } },
    URLSearchParams, AbortSignal, fetch: fetcher, setInterval: (listener: typeof poll) => { poll = listener; },
  });
  let prevented = 0;
  return { output, button, poll: () => poll(), submit: () => submit({ preventDefault() { prevented++; } }), prevented: () => prevented };
}

test('Browser bleibt auf der Seite, sperrt Doppelklicks und aktualisiert nur das Statuselement', async () => {
  let resolve!: (value: Payload) => void;
  const pending = new Promise<Payload>((done) => { resolve = done; });
  let calls = 0;
  const b = browser(async (url, options) => {
    calls++;
    assert.equal(url, '/ct/check');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(String(options.body), 'csrf=test-csrf');
    return { ok: true, headers: { get: () => 'application/json' }, json: () => pending };
  });
  const request = b.submit();
  assert.equal(b.prevented(), 1);
  assert.equal(b.button.disabled, true);
  assert.match(text(b.output), /wird geprüft/);
  await b.submit();
  assert.equal(calls, 1);
  resolve({ status: 'connected', message: 'Verbindung erfolgreich.' });
  await request;
  assert.equal(b.button.disabled, false);
  assert.equal(b.button.textContent, 'CT-Verbindung prüfen');
  assert.equal(b.output.attributes.get('aria-busy'), 'false');
  assert.match(b.output.children[0] instanceof Element ? b.output.children[0].className : '', /connection-success/);
});

test('Server- und Netzwerkfehler werden im Block angezeigt und geben den Button frei', async () => {
  const b = browser(async () => ({ ok: false, headers: { get: () => 'application/json' },
    json: async () => ({ status: 'error', message: 'Sitzung abgelaufen. Bitte erneut anmelden.' }) }));
  await b.submit();
  assert.match(text(b.output), /Sitzung abgelaufen/);
  assert.equal(b.button.disabled, false);
  const offline = browser(async () => { throw new Error('private network details'); });
  await offline.submit();
  assert.match(text(offline.output), /Anfrage konnte nicht abgeschlossen/);
  assert.equal(text(offline.output).includes('private network details'), false);
  assert.equal(offline.button.disabled, false);
});


test('Laufender Startabruf sperrt Button und Statuspolling gibt ihn ohne Neuladen frei',async()=>{
 let busy=true,calls=0;
 const b=browser(async(url)=>{calls++;assert.equal(url,'/ct/status');return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({status:'ct-status',message:'Status',busy})};},true);
 assert.equal(b.button.disabled,true);assert.match(b.button.textContent,/läuft bereits/);
 await b.submit();assert.equal(calls,0);
 await b.poll();assert.equal(b.button.disabled,true);assert.equal(text(b.output).includes('fehlgeschlagen'),false);
 busy=false;await b.poll();assert.equal(b.button.disabled,false);assert.equal(b.button.textContent,'CT-Verbindung prüfen');assert.match(text(b.output),/CT-Vorgang ist beendet/);
});
test('Zeitgleicher fremder CT-Vorgang wird als laufend statt als Fehler dargestellt',async()=>{
 const b=browser(async(url)=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>url==='/ct/status'?{status:'ct-status',message:'Bereit',busy:false}:{status:'busy',code:'CT_BUSY',message:'Eine CT-Prüfung läuft bereits.'}}));
 await b.submit();assert.equal(b.button.disabled,true);assert.equal(text(b.output).includes('fehlgeschlagen'),false);
 await b.poll();assert.equal(b.button.disabled,false);
});
