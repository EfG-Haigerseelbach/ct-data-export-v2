export const selectionScript = String.raw`'use strict';
(() => {
  const form = document.getElementById('selection-form');
  const output = document.getElementById('selection-result');
  if (!form || !output) return;
  const button = form.querySelector('button');
  if (!button) return;
  let running = false;
  const labels = {
    groups: 'Ausgewählte Gruppen', persons: 'Ausgewählte Personen', landingGroups: 'Gruppen für die Startseite',
    contacts: 'Verknüpfte Ansprechpartner', categories: 'Verwendete Kategorien', targetGroups: 'Verwendete Zielgruppen',
    groupsWithAge: 'Gruppen mit Altersangabe', groupsWithRecurrence: 'Gruppen mit Turnusbeschreibung',
  };
  function show(kind, message) {
    const box = document.createElement('div');
    box.className = 'notice connection-status' + (kind === 'success' ? ' connection-success' : kind === 'error' ? ' connection-error' : '');
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.className = 'connection-icon';
    icon.textContent = kind === 'success' ? '✅' : kind === 'error' ? '❌' : kind === 'loading' ? '⏳' : '⚠️';
    const text = document.createElement('div'); text.textContent = message;
    box.append(icon, text); output.replaceChildren(box);
  }
  function updateWarnings(count) {
    if (!Number.isSafeInteger(count) || count < 0) return;
    const link = document.getElementById('warnings-link');
    if (link) link.textContent = 'Warnungen' + (count ? ' (' + count + ' offen)' : '');
    const banner = document.getElementById('warning-banner');
    if (banner) {
      banner.hidden = count === 0;
      const details = document.createElement('a'); details.href = '/warnings'; details.textContent = 'Zentrale Warnungsliste öffnen';
      banner.replaceChildren(document.createTextNode(count + ' offene Warnung(en) benötigen eine Prüfung in ChurchTools. Die Verarbeitung kann mit den verfügbaren Ansprechpartnern fortgesetzt werden. '), details);
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (running) return;
    running = true;
    const label = button.textContent;
    button.disabled = true; button.textContent = 'Auswahl wird geprüft …';
    output.setAttribute('aria-busy', 'true');
    show('loading', 'Die CT-Daten werden mit der gespeicherten Konfiguration geprüft. Bitte warten.');
    try {
      const body = new URLSearchParams();
      for (const [key, value] of new FormData(form)) if (typeof value === 'string') body.append(key, value);
      const response = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, body,
        credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(310000) });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('response');
      const result = await response.json();
      if (typeof result.message !== 'string' || !['preview', 'error'].includes(result.status)) throw new Error('response');
      updateWarnings(result.openWarnings);
      if (!response.ok || result.status === 'error') { show('error', result.message); return; }
      if (result.stale) { show('warning', result.message); return; }
      if (!result.preview || !Object.keys(labels).every((key) => Number.isSafeInteger(result.preview[key]) && result.preview[key] >= 0)) throw new Error('response');
      show(result.openWarnings ? 'warning' : 'success', result.message);
      const list = document.createElement('dl');
      for (const [key, label] of Object.entries(labels)) {
        const term = document.createElement('dt'); term.textContent = label;
        const value = document.createElement('dd'); value.textContent = String(result.preview[key]);
        list.append(term, value);
      }
      output.append(list);
      if (result.dataAvailable) {
        const link = document.createElement('a'); link.href = '/data'; link.textContent = 'Abgerufene Daten ansehen';
        output.append(link);
      }
    } catch (error) {
      show('error', error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'Die Auswahlprüfung hat das Zeitlimit überschritten. Bitte später erneut prüfen.'
        : 'Die Auswahlprüfung konnte nicht abgeschlossen werden. Prüfe die Verbindung zur Anwendung und versuche es erneut.');
    } finally {
      running = false; button.disabled = false; button.textContent = label;
      output.setAttribute('aria-busy', 'false');
    }
  });
})();`;
