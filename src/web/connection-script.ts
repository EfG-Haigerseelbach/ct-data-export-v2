// Als feste externe Ressource ausgeliefert; enthält keine Kontodaten oder Tokens.
export const connectionScript = String.raw`'use strict';
(() => {
  const form = document.getElementById('ct-check-form');
  const output = document.getElementById('ct-check-result');
  if (!form || !output) return;
  const button = form.querySelector('button');
  if (!button) return;
  let running = false;
  let remoteBusy = button.disabled;
  let polling = false;
  function syncButton() {
    button.disabled = running || remoteBusy;
    button.textContent = running ? 'Verbindung wird geprüft …' : remoteBusy ? '⏳ CT-Prüfung läuft bereits …' : 'CT-Verbindung prüfen';
    output.setAttribute('aria-busy', String(running || remoteBusy));
  }
  async function refreshStatus() {
    if (running || polling) return;
    polling = true;
    try {
      const response = await fetch('/ct/status', { headers: { Accept: 'application/json' }, credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok || result.status !== 'ct-status' || typeof result.busy !== 'boolean') return;
      if (running) return;
      const wasBusy = remoteBusy;
      remoteBusy = result.busy;
      if (remoteBusy) show('loading', 'Eine CT-Prüfung läuft bereits. Bitte warten.');
      else if (wasBusy) show('ready', 'Der CT-Vorgang ist beendet. Sie können die Verbindung jetzt prüfen.');
      syncButton();
    } catch { /* Bei fehlendem Status bleibt die Sperre bis zur nächsten erfolgreichen Abfrage bestehen. */ }
    finally { polling = false; }
  }
  setInterval(() => refreshStatus(), 1500);
  syncButton();
  function show(kind, message) {
    const box = document.createElement('div');
    box.className = 'notice connection-status' + (kind === 'success' ? ' connection-success' : kind === 'error' ? ' connection-error' : '');
    const icon = document.createElement('span');
    icon.className = 'connection-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = kind === 'success' ? '✅' : kind === 'error' ? '❌' : kind === 'ready' ? 'ℹ️' : '⏳';
    const text = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = kind === 'success' ? 'Verbindung erfolgreich' : kind === 'error' ? 'Verbindungsprüfung fehlgeschlagen' : kind === 'ready' ? 'CT-Verbindung prüfen' : 'CT-Prüfung läuft';
    text.append(title, document.createElement('br'), document.createTextNode(message));
    box.append(icon, text);
    output.replaceChildren(box);
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (running || remoteBusy) return;
    running = true;
    button.disabled = true;
    button.textContent = 'Verbindung wird geprüft …';
    output.setAttribute('aria-busy', 'true');
    show('loading', 'Die Anmeldung bei ChurchTools wird geprüft. Bitte warten.');
    try {
      const body = new URLSearchParams();
      for (const [key, value] of new FormData(form)) if (typeof value === 'string') body.append(key, value);
      const response = await fetch(form.action, {
        method: 'POST', headers: { Accept: 'application/json' }, body,
        credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(310000),
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('response');
      const result = await response.json();
      if (typeof result.message !== 'string' || !['connected', 'busy', 'error'].includes(result.status)) throw new Error('response');
      if (result.status === 'busy' || result.code === 'CT_BUSY') { remoteBusy = true; show('loading', result.message); return; }
      remoteBusy = false;
      show(response.ok && result.status === 'connected' ? 'success' : 'error', result.message);
    } catch (error) {
      show('error', error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'Die Anfrage hat das Zeitlimit überschritten. Bitte später erneut prüfen.'
        : 'Die Anfrage konnte nicht abgeschlossen werden. Prüfe die Verbindung zur Anwendung und versuche es erneut.');
    } finally {
      running = false;
      syncButton();
    }
  });
})();`;
