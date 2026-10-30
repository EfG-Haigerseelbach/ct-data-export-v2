import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { selectionScript } from '../src/web/selection-script.js';

class Element {
  textContent = ''; className = ''; disabled = false; hidden = false; href = ''; value = '';
  children: (Element | string)[] = []; attributes = new Map<string, string>();
  append(...children: (Element | string)[]) { this.children.push(...children); }
  replaceChildren(...children: (Element | string)[]) { this.children = children; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
}
const text = (node: Element | string): string => typeof node === 'string' ? node : node.textContent + node.children.map(text).join('');
type Result = { status: string; message: string; preview?: Record<string, number>; stale?: boolean; openWarnings?: number; dataAvailable?: boolean };
const preview = { groups: 2, persons: 3, landingGroups: 1, contacts: 2, categories: 1, targetGroups: 1, groupsWithAge: 1, groupsWithRecurrence: 2 };
function browser(fetcher: (url: string, options: RequestInit) => Promise<{ ok: boolean; result: Result }>) {
  const output = new Element(), button = new Element(), link = new Element(), banner = new Element(), input = new Element();
  button.textContent = 'Auswahl mit ChurchTools prüfen'; input.value = 'information.unsaved';
  let submit!: (event: { preventDefault(): void }) => Promise<void>;
  const form = { action: '/settings/preview', querySelector: () => button,
    addEventListener: (_name: string, listener: typeof submit) => { submit = listener; } };
  const elements: Record<string, unknown> = { 'selection-form': form, 'selection-result': output,
    'warnings-link': link, 'warning-banner': banner, exposureIndicator: input };
  let calls = 0, prevented = 0;
  runInNewContext(selectionScript, {
    document: { getElementById: (id: string) => elements[id] ?? null, createElement: () => new Element(), createTextNode: (s: string) => s },
    FormData: class { *[Symbol.iterator]() { yield ['csrf', 'test-csrf']; } }, URLSearchParams, AbortSignal,
    fetch: async (url: string, options: RequestInit) => {
      calls++; const response = await fetcher(url, options);
      return { ok: response.ok, headers: { get: () => 'application/json' }, json: async () => response.result };
    },
  });
  return { output, button, link, banner, input, calls: () => calls, prevented: () => prevented,
    submit: () => submit({ preventDefault() { prevented++; } }) };
}

test('Asynchrone Auswahl erhält Formulareingaben, sperrt Mehrfachklicks und aktualisiert Vorschau/Warnungen', async () => {
  let complete!: (value: { ok: boolean; result: Result }) => void;
  const pending = new Promise<{ ok: boolean; result: Result }>((resolve) => { complete = resolve; });
  const b = browser(async (url, options) => {
    assert.equal(url, '/settings/preview');
    assert.equal(String(options.body), 'csrf=test-csrf');
    assert.equal(options.credentials, 'same-origin');
    return pending;
  });
  const request = b.submit();
  assert.equal(b.prevented(), 1);
  assert.equal(b.button.disabled, true);
  assert.match(text(b.output), /Bitte warten/);
  await b.submit(); assert.equal(b.calls(), 1);
  complete({ ok: true, result: { status: 'preview', message: 'Prüfung mit Warnungen abgeschlossen.', preview, openWarnings: 1, dataAvailable: true } });
  await request;
  assert.equal(b.button.disabled, false);
  assert.equal(b.input.value, 'information.unsaved');
  assert.match(text(b.output), /Ausgewählte Gruppen2/);
  assert.equal(b.link.textContent, 'Warnungen (1 offen)');
  assert.equal(b.banner.hidden, false);
  assert.match(text(b.output), /Abgerufene Daten ansehen/);
});

test('Behobene Warnungen verschwinden aus dem Banner; veraltete Ergebnisse zeigen keine Zahlen', async () => {
  const b = browser(async () => ({ ok: true, result: { status: 'preview', message: 'Konfiguration geändert.', stale: true, openWarnings: 0 } }));
  await b.submit();
  assert.equal(b.link.textContent, 'Warnungen');
  assert.equal(b.banner.hidden, true);
  assert.match(text(b.output), /Konfiguration geändert/);
  assert.equal(text(b.output).includes('Ausgewählte Gruppen'), false);
});

test('Server- und Netzwerkfehler erscheinen ohne Navigation und geben den Auswahlbutton frei', async () => {
  const b = browser(async () => ({ ok: false, result: { status: 'error', message: 'Sitzung abgelaufen.' } }));
  await b.submit(); assert.match(text(b.output), /Sitzung abgelaufen/); assert.equal(b.button.disabled, false);
  const offline = browser(async () => { throw new Error('private details'); });
  await offline.submit(); assert.match(text(offline.output), /konnte nicht abgeschlossen/);
  assert.equal(text(offline.output).includes('private details'), false);
  assert.equal(offline.button.disabled, false);
});
