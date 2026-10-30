export const settingsScript = String.raw`'use strict';
(() => {
  const form = document.getElementById('settings-form');
  const output = document.getElementById('settings-save-result');
  const toast = document.getElementById('settings-toast');
  if (!form || !output || !toast) return;
  const button = form.querySelector('button');
  const inputs = Array.from(form.querySelectorAll('input:not([type="hidden"])'));
  const revision = form.querySelector('input[name="revision"]');
  if (!button || !revision) return;
  let running = false, timer;
  const currentValue = (input) => input.type === 'number' && input.value.trim() !== '' && Number.isFinite(Number(input.value)) ? String(Number(input.value)) : input.value.trim();
  let baseline = inputs.map((input) => input.dataset.savedValue);
  const differs = () => inputs.some((input, index) => currentValue(input) !== baseline[index]);
  const updateButton = () => { button.disabled = running || !differs(); };
  form.addEventListener('input', updateButton);
  form.addEventListener('change', updateButton);
  updateButton();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (running || !differs()) return;
    running = true;
    clearTimeout(timer); toast.hidden = true;
    const label = button.textContent;
    const readonly = inputs.map((input) => input.readOnly);
    inputs.forEach((input) => { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); input.readOnly = true; });
    button.disabled = true; button.textContent = '⏳ Konfiguration wird geprüft …';
    form.setAttribute('aria-busy', 'true');
    output.textContent = 'Prüfung läuft …'; output.className = 'notice'; output.hidden = false;
    try {
      const body = new URLSearchParams();
      for (const [key, value] of new FormData(form)) if (typeof value === 'string') body.append(key, value);
      const response = await fetch(form.action, { method: 'POST', body, headers: { Accept: 'application/json' },
        credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(310000) });
      if (!response.headers.get('content-type')?.includes('application/json')) throw Error('response');
      const result = await response.json();
      if (typeof result.message !== 'string' || !['saved', 'error'].includes(result.status)) throw Error('response');
      if (!response.ok || result.status === 'error') {
        output.textContent = result.message; output.className = 'notice connection-error';
        if (result.resetValues && typeof result.resetValues === 'object') inputs.forEach(input => { if (Object.hasOwn(result.resetValues,input.name) && typeof result.resetValues[input.name] === 'string') input.value = result.resetValues[input.name]; });
        if (Array.isArray(result.fields)) inputs.forEach((input) => {
          if (result.fields.includes(input.name)) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', 'settings-save-result'); }
        });
        return;
      }
      if (typeof result.revision !== 'string' || !/^[a-f0-9]{64}$/.test(result.revision)) throw Error('response');
      const changed = revision.value !== result.revision;
      revision.value = result.revision;
      inputs.forEach((input) => { input.value = currentValue(input); });
      baseline = inputs.map((input) => input.value);
      const timestamp = document.getElementById('settings-updated-at');
      if (timestamp && result.updatedAt) timestamp.textContent = 'Zuletzt geändert: ' + new Date(result.updatedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) + ' (Europe/Berlin)';
      output.hidden = true;
      toast.textContent = '✅ ' + result.message; toast.hidden = false;
      timer = setTimeout(() => { toast.hidden = true; }, 5000);
      const preview = document.getElementById('selection-result');
      if (changed && preview) preview.textContent = 'Die Konfiguration wurde geändert. Bitte die Auswahl erneut prüfen.';
    } catch {
      output.textContent = 'Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen; bei einem Verbindungsabbruch kann bereits gespeichert worden sein. Im Zweifel den gespeicherten Stand neu laden.';
      output.className = 'notice connection-error';
    } finally {
      running = false; updateButton(); button.textContent = label;
      inputs.forEach((input, index) => { input.readOnly = readonly[index]; });
      form.setAttribute('aria-busy', 'false');
    }
  });
})();`;
