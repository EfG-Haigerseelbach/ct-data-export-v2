import { wordpressUrlKeys } from '../wordpress/urls.js';
import { WordpressError, WordpressUrlError } from '../wordpress/imports.js';
import type { WordpressImports, ImportId } from '../wordpress/imports.js';
import { wordpressScript } from './wordpress-script.js';
import type { ImageValidator } from '../export/image-validation.js';
import { dataLinksScript } from './data-links-script.js';
import { uploadAllowed, dataHashes } from '../export/image-validation.js';
import { sftpCheckScript } from './sftp-check-script.js';
import { ArchiveError } from '../export/json-archive.js';
import type { JsonArchive } from '../export/json-archive.js';
import { settingsScript } from './settings-script.js';
import { findFieldReference, validateReferenceFields, FieldValidationError } from '../export/field-validation.js';
import type { FieldReference } from '../export/field-validation.js';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Account } from './auth.js';
import { verifyAccount } from './auth.js';
import { withHeaderLabel, dashboardPage, loginPage, settingsPage, warningsPage, dataPage, configurationPage, uploadPage, archivePage, wordpressPage } from './views.js';
import { UploadError } from '../transfer/sftp.js';
import type { EnvironmentInfo } from './config.js';
import { inspectDirectory } from '../report.js';
import type { Report } from '../report.js';
import { CtError } from '../churchtools/client.js';
import type { CtConnection, ConnectionStatus } from '../churchtools/client.js';
import { ExportSettingsError, settingsFromForm, settingsFields } from '../export/settings.js';
import type { ExportSettingsStore } from '../export/settings.js';
import { buildSelection, summarizeSelection, SelectionError, collectContactPersonIds } from '../export/selection.js';
import type { ApiGroup } from '../churchtools/schemas.js';
import type { CtSnapshot, SelectionSummary } from '../export/selection.js';
import { WarningStoreError } from '../export/warnings.js';
import type { WarningStore } from '../export/warnings.js';
import { connectionScript } from './connection-script.js';
import { selectionScript } from './selection-script.js';
import { buildDataPreview } from '../export/data-preview.js';
import type { DataPreview, FetchHistoryEntry } from '../export/data-preview.js';

type Session = { csrf: string; authenticated: boolean; expires: number; report?: Report; ctResult?: ConnectionStatus;
  previewInitialized?: boolean; settingsSaved?: boolean; preview?: { revision: string; summary: SelectionSummary; data: DataPreview } };
type Options = { account: Account; directory: string; headerLabel?: string; secureCookie?: boolean; now?: () => number; environmentInfo?: EnvironmentInfo; autoLoad?: boolean; wordpressImports?: WordpressImports; publicBaseUrl?: string; archive?: JsonArchive; imageValidator?: ImageValidator; uploader?: { upload(data: DataPreview): Promise<string>; checkConnection?(): Promise<void> };
  ct?: CtConnection & { downloadImages?: (urls:string[])=>Promise<Map<string,{body?:Buffer;error?:string}>>; readSnapshot?: (selectContactIds?: (groups: ApiGroup[]) => number[], selectAvatarIds?: (snapshot: CtSnapshot) => number[]) => Promise<CtSnapshot> }; exportSettings: ExportSettingsStore; warningStore: WarningStore };
const ttl = 60 * 60 * 1000;
const token = () => randomBytes(32).toString('hex');

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') throw new Error('form');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 8192) throw new Error('size');
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function createWebServer(options: Options) {
  const sessions = new Map<string, Session>();
  const attempts = new Map<string, { count: number; expires: number }>();
  const now = options.now ?? Date.now;
  const fetchHistory: FetchHistoryEntry[] = [...(options.archive?.entries ?? [])].slice(0,100);
  let lastSftpCheck: string | undefined;
  let ctCheckRunning = false;
  let fieldReference: FieldReference | undefined;
  let initialPreview: Session['preview'];
  let initialStatus = options.ct?.readSnapshot && options.autoLoad !== false ? 'CT-Daten werden automatisch geladen. Bitte die Seite gleich neu laden.' : '';
  async function loadPreview(source: FetchHistoryEntry['source']): Promise<NonNullable<Session['preview']>> {
    const started = performance.now();
    const elapsedMs = () => performance.now() - started;
    const entry: FetchHistoryEntry = { startedAt: new Date(now()).toISOString(), source, status: 'loading' };
    fetchHistory.unshift(entry);
    fetchHistory.splice(100);
    try {
    const snapshot = options.exportSettings.snapshot();
        const data = await options.ct!.readSnapshot!((groups) => collectContactPersonIds(groups, snapshot.config),
          (data) => buildSelection(data, snapshot.config).persons.map((person) => person.id));
        const selection = buildSelection(data, snapshot.config);
        // Ein während des Abrufs geänderter Konfigurationsstand darf nichts als behoben markieren.
        const checked = options.exportSettings.snapshot().revision === snapshot.revision
          ? selection.groups.map((group) => ({ groupId: group.id, fieldPath: snapshot.config.export.accessPath.contactPersonIds })) : [];
        await options.warningStore.reconcile(selection.warnings, checked);
        if (options.exportSettings.snapshot().revision === snapshot.revision) fieldReference = findFieldReference(data, snapshot.config);
        const preview = buildDataPreview(data, selection, new Date(now()).toISOString(), snapshot.config.export.email.preferredContactLabelId);
        if (options.imageValidator) preview.imageValidation = await options.imageValidator(preview);
        else if (!options.archive) preview.imageValidation = { checkedAt: new Date().toISOString(), uploadAllowed: false, ...dataHashes(preview), errors: [{ code: 'ARCHIVE_UNAVAILABLE' }] };
        if (options.archive) {
          const images = !options.imageValidator ? { personMaxEdge: snapshot.config.export.images.personMaxEdge, publicBaseUrl: options.publicBaseUrl ?? 'http://127.0.0.1:3000', download: (urls:string[]) => options.ct?.downloadImages ? options.ct.downloadImages(urls) : Promise.resolve(new Map<string,{body?:Buffer;error?:string}>()) } : undefined;
          Object.assign(entry, await options.archive.save(preview, entry, snapshot.revision, images, elapsedMs));
        }
        entry.uploadAllowed = uploadAllowed(preview);
        for (const failure of preview.imageValidation?.errors ?? []) console.error('Bilddownload fehlgeschlagen', { ...(failure.personId ? { personId:failure.personId } : {}), ...(failure.groupId ? { groupId:failure.groupId } : {}), code:failure.code });
        entry.status = 'success';
        return { revision: snapshot.revision, summary: summarizeSelection(selection), data: preview };
    } catch (error) { entry.status = 'error'; throw error; }
    finally { entry.finishedAt = new Date(now()).toISOString(); entry.durationMs ??= Math.max(0, Math.round(elapsedMs())); }
  }
  const dashboard = (session: Session) => dashboardPage(session.csrf, options.account.username, session.report,
    { configured: Boolean(options.ct), busy: ctCheckRunning, ...(session.ctResult ? { result: session.ctResult } : {}) }, options.warningStore.openCount());
  const settings = (session: Session, extra: Parameters<typeof settingsPage>[2] = {}) => {
    const snapshot = options.exportSettings.snapshot();
    const currentPreview = session.preview?.revision === snapshot.revision;
    return settingsPage(session.csrf, snapshot, { canPreview: Boolean(options.ct?.readSnapshot), openWarnings: options.warningStore.openCount(),
      username: options.account.username, saved: Boolean(session.settingsSaved),
      ...(session.preview && currentPreview ? { preview: session.preview.summary } : {}),
      stalePreview: Boolean(session.preview && !currentPreview), ...extra });
  };
  function cookie(res: ServerResponse, value: string, maxAge = ttl / 1000) {
    res.setHeader('Set-Cookie', `ct_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${options.secureCookie ? '; Secure' : ''}`);
  }
  function redirect(res: ServerResponse, path: string) { res.writeHead(303, { Location: path }); res.end(); }
  function html(res: ServerResponse, status: number, body: string) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(withHeaderLabel(body, options.headerLabel)); }
  function json(res: ServerResponse, status: number, body: { status: 'connected' | 'preview' | 'saved' | 'wordpress' | 'ct-status' | 'busy' | 'error'; message: string;
    busy?: boolean; wordpress?: ReturnType<WordpressImports['snapshot']>; lastSuccess?: string; resetValues?: Record<string,string>; changed?: boolean; updatedAt?: string | null; fields?: string[]; revision?: string; code?: string; preview?: SelectionSummary; stale?: boolean; openWarnings?: number; dataAvailable?: boolean }) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept' });
    res.end(JSON.stringify(body));
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const path = req.url?.split('?')[0];
    const archiveMatch = /^\/data\/archive\/([a-f0-9-]{36}|[a-f0-9]{64})\/(groups|contactPersons)$/.exec(path ?? '');
    const mediaMatch = /^\/media\/([a-f0-9-]{36}|[a-f0-9]{64})\/([a-f0-9]{64}\.png)$/.exec(path ?? '');
    const wantsJson = (path === '/ct/check' || path === '/settings/preview' || path === '/settings' || path === '/sftp/check' || path === '/wordpress-imports/start' || path === '/wordpress-imports/status') && req.headers.accept?.includes('application/json');
    if (req.method !== 'GET' && req.method !== 'POST') { res.writeHead(405, { Allow: 'GET, POST' }); res.end(); return; }
    if (mediaMatch) {
      if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return; }
      try {
        if (!options.archive) throw new ArchiveError();
        const body = await options.archive.readMedia(mediaMatch[1]!, mediaMatch[2]!);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': body.length, 'Cache-Control': 'public, max-age=86400' }); res.end(body);
      } catch { html(res, 404, 'Bild nicht verfügbar.'); }
      return;
    }
    if (path === '/assets/connection.js' || path === '/assets/selection.js' || path === '/assets/settings.js' || path === '/assets/sftp-check.js' || path === '/assets/data-links.js' || path === '/assets/wordpress.js') {
      if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(path === '/assets/wordpress.js' ? wordpressScript : path === '/assets/data-links.js' ? dataLinksScript : path === '/assets/sftp-check.js' ? sftpCheckScript : path === '/assets/connection.js' ? connectionScript : path === '/assets/settings.js' ? settingsScript : selectionScript); return;
    }
    if (!archiveMatch && !['/', '/login', '/logout', '/validate', '/ct/check', '/ct/status', '/settings', '/settings/preview', '/warnings', '/data', '/configuration', '/upload', '/sftp/check', '/wordpress-imports', '/wordpress-imports/status', '/wordpress-imports/start'].includes(path ?? '')) { html(res, 404, 'Seite nicht gefunden.'); return; }
    for (const [key, session] of sessions) if (session.expires <= now()) sessions.delete(key);
    for (const [key, attempt] of attempts) if (attempt.expires <= now()) attempts.delete(key);
    let sid = /(?:^|;\s*)ct_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
    let session = sid ? sessions.get(sid) : undefined;
    if (!session) {
      if (req.method === 'POST') {
        if (wantsJson) json(res, 401, { status: 'error', code: 'SESSION_EXPIRED', message: 'Sitzung abgelaufen. Bitte erneut anmelden.' });
        else html(res, 403, 'Sitzung abgelaufen. Bitte die Anmeldeseite neu öffnen.');
        return;
      }
      if (sessions.size >= 1000) { html(res, 503, 'Bitte später erneut versuchen.'); return; }
      sid = token(); session = { csrf: token(), authenticated: false, expires: now() + ttl };
      sessions.set(sid, session); cookie(res, sid);
    }
    if (session.authenticated && !session.previewInitialized && initialPreview) {
      session.preview = initialPreview;
      session.previewInitialized = true;
    }
    if (req.method === 'GET') {
      if (path === '/login') {
        if (session.authenticated) redirect(res, '/'); else html(res, 200, loginPage(session.csrf));
      } else if (path === '/') {
        if (!session.authenticated) redirect(res, '/login');
        else html(res, 200, dashboard(session));
      } else if (archiveMatch) {
        if (!session.authenticated) redirect(res, '/login');
        else {
          try {
            if (!options.archive) throw new ArchiveError();
            const file = await options.archive.read(archiveMatch[1]!, archiveMatch[2] as 'groups' | 'contactPersons');
            html(res, 200, archivePage(file.name, file.json, session.csrf, options.account.username, options.warningStore.openCount()));
          } catch { html(res, 404, 'Archivdatei nicht verfügbar.'); }
        }
      } else if (path === '/ct/status') {
        if (!session.authenticated) json(res, 401, { status: 'error', message: 'Bitte erneut anmelden.' });
        else json(res, 200, { status: 'ct-status', busy: ctCheckRunning, message: ctCheckRunning ? 'Eine CT-Prüfung läuft bereits.' : 'CT-Verbindung kann geprüft werden.' });
      } else if (path === '/wordpress-imports' || path === '/wordpress-imports/status') {
        if (!session.authenticated) {
          if (path === '/wordpress-imports/status') json(res, 401, { status: 'error', message: 'Bitte erneut anmelden.' });
          else redirect(res, '/login');
        } else if (path === '/wordpress-imports/status') {
          if (!options.wordpressImports) json(res, 409, { status: 'error', message: 'WordPress-Import ist noch nicht eingerichtet.' });
          else json(res, 200, { status: 'wordpress', message: 'Importstatus geladen.', wordpress: options.wordpressImports.snapshot() });
        } else html(res, 200, wordpressPage(session.csrf, options.account.username, options.wordpressImports?.snapshot(), '', options.warningStore.openCount()));
      } else if (path === '/upload') {
        if (!session.authenticated) redirect(res, '/login');
        else html(res, 200, uploadPage(session.csrf, options.exportSettings.snapshot().revision, Boolean(options.uploader), Boolean(session.preview), '', options.warningStore.openCount(), options.account.username, lastSftpCheck, Boolean(session.preview && !uploadAllowed(session.preview.data)), session.preview?.data.loadedAt));
      } else if (path === '/configuration') {
        if (!session.authenticated) redirect(res, '/login');
        else html(res, 200, configurationPage(options.environmentInfo ?? { baseUrl: undefined, tokenSet: false, tokenNonEmpty: false }, options.warningStore.openCount(), session.csrf, options.account.username));
      } else if (path === '/settings') {
        if (!session.authenticated) redirect(res, '/login');
        else { html(res, 200, settings(session)); session.settingsSaved = false; }
      } else if (path === '/warnings') {
        if (!session.authenticated) redirect(res, '/login');
        else html(res, 200, warningsPage(options.warningStore.snapshot(), session.csrf, options.account.username));
      } else if (path === '/data') {
        if (!session.authenticated) redirect(res, '/login');
        else html(res, 200, dataPage(session.preview?.data,
          Boolean(session.preview && session.preview.revision !== options.exportSettings.snapshot().revision), options.warningStore.openCount(), initialStatus, session.csrf, options.account.username, fetchHistory));
      } else { res.writeHead(405, { Allow: 'POST' }); res.end(); }
      return;
    }
    const form = await readForm(req);
    if (form.get('csrf') !== session.csrf || req.headers['sec-fetch-site'] === 'cross-site') {
      if (wantsJson) json(res, 403, { status: 'error', code: 'CSRF_INVALID', message: 'Ungültige Formularanfrage. Bitte die Seite neu laden.' });
      else html(res, 403, 'Ungültige Formularanfrage. Bitte die Seite neu laden.');
      return;
    }
    if (path === '/login') {
      const address = req.socket.remoteAddress ?? 'unknown';
      const attempt = attempts.get(address) ?? { count: 0, expires: now() + 15 * 60 * 1000 };
      if (attempt.count >= 5 || (!attempts.has(address) && attempts.size >= 1000)) {
        res.setHeader('Retry-After', '900'); html(res, 429, loginPage(session.csrf, 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.')); return;
      }
      // Vor der asynchronen Passwortprüfung zählen, damit parallele Requests das Limit nicht umgehen.
      attempt.count++; attempts.set(address, attempt);
      if (!await verifyAccount(options.account, form.get('username') ?? '', form.get('password') ?? '')) {
        html(res, 401, loginPage(session.csrf, 'Benutzername oder Passwort ist falsch.')); return;
      }
      attempts.delete(address);
      sessions.delete(sid!);
      const fresh = token();
      sessions.set(fresh, { csrf: token(), authenticated: true, expires: now() + ttl });
      cookie(res, fresh); redirect(res, '/'); return;
    }
    if (!session.authenticated) {
      if (wantsJson) json(res, 401, { status: 'error', code: 'LOGIN_REQUIRED', message: 'Bitte erneut anmelden, um die Prüfung auszuführen.' });
      else redirect(res, '/login');
      return;
    }
    if (path === '/settings') {
      let checking = false;
      try {
        const config = settingsFromForm(form);
        const before = options.exportSettings.snapshot();
        if (before.revision !== form.get('revision')) throw new ExportSettingsError('SETTINGS_CONFLICT');
        if (JSON.stringify(config) === JSON.stringify(before.config)) {
          if (wantsJson) json(res, 200, { status: 'saved', changed: false, message: 'Keine Änderungen. Die Konfiguration wurde nicht überschrieben.', revision: before.revision, updatedAt: before.updatedAt });
          else redirect(res, '/settings');
          return;
        }
        const pathsChanged = JSON.stringify([config.export.accessPath,config.export.person]) !== JSON.stringify([before.config.export.accessPath,before.config.export.person]);
        if (pathsChanged) {
        if (!options.ct?.readSnapshot) throw new FieldValidationError('Nicht gespeichert: Für die Attributprüfung muss ChurchTools eingerichtet sein.');
        if (ctCheckRunning) throw new FieldValidationError('Eine CT-Prüfung läuft bereits. Bitte danach erneut speichern.');
        ctCheckRunning = true; checking = true;
        const data = await options.ct.readSnapshot((groups) => collectContactPersonIds(groups, before.config), () => []);
        const reference = fieldReference ?? findFieldReference(data, before.config);
        if (!reference) throw new FieldValidationError('Nicht gespeichert: Keine bekannte freigegebene Referenzgruppe mit allen bisherigen Attributen und einem lesbaren Ansprechpartner mit beiden Personenattributen gefunden. Prüfe die Daten und Leserechte in ChurchTools.');
        validateReferenceFields(data, reference, config);
        fieldReference = reference;
        }
        const wordpressChanged = JSON.stringify(config.export.wordpress) !== JSON.stringify(before.config.export.wordpress);
        if (wordpressChanged) {
          if (!options.wordpressImports) throw new WordpressUrlError('Import-URL-Prüfung ist noch nicht eingerichtet. Alte Werte bleiben aktiv.', [...wordpressUrlKeys]);
          await options.wordpressImports.configure(config.export.wordpress, () => options.exportSettings.save(config, before.revision));
        } else await options.exportSettings.save(config, before.revision);
        if (wantsJson) json(res, 200, { status: 'saved', message: 'Konfiguration OK. Gespeichert und aktiviert.', changed: true, updatedAt: options.exportSettings.snapshot().updatedAt, revision: options.exportSettings.snapshot().revision });
        else { session.settingsSaved = true; redirect(res, '/settings'); }
      } catch (error) {
        const urlFailure = error instanceof WordpressUrlError || error instanceof ExportSettingsError && error.fields.some(key => wordpressUrlKeys.some(urlKey => urlKey === key));
        const resetValues = urlFailure ? { ...options.exportSettings.snapshot().config.export.wordpress } : undefined;
        if (wantsJson) {
          const known = error instanceof WordpressUrlError || error instanceof FieldValidationError || error instanceof CtError || error instanceof SelectionError || error instanceof ExportSettingsError;
          json(res, error instanceof ExportSettingsError && error.code === 'SETTINGS_CONFLICT' ? 409 : known ? 422 : 500, { status: 'error', message: known ? error.message : 'Speichern fehlgeschlagen. Die bisherige Konfiguration bleibt aktiv.',
            ...(resetValues ? { resetValues } : {}), fields: error instanceof WordpressUrlError || error instanceof FieldValidationError || error instanceof ExportSettingsError ? error.fields.filter((key) => key === 'preferredContactLabelId' || key === 'personMaxEdge' || wordpressUrlKeys.some(urlKey => urlKey === key) || settingsFields.some((field) => field.key === key)) : [] });
          return;
        }
        const failure = error instanceof ExportSettingsError ? error : new ExportSettingsError('SETTINGS_WRITE');
        if (error instanceof WordpressUrlError || error instanceof FieldValidationError || error instanceof CtError || error instanceof SelectionError) {
          html(res, 422, settings(session, { error: error.message, values: { ...Object.fromEntries(settingsFields.map((field) => [field.key, form.get(field.key) ?? ''])), preferredContactLabelId: form.get('preferredContactLabelId') ?? '', personMaxEdge: form.get('personMaxEdge') ?? '', ...Object.fromEntries(wordpressUrlKeys.map(key=>[key,form.get(key)??''])), ...resetValues }, revision: form.get('revision') ?? '', saved: false })); return;
        }
        const values = { ...Object.fromEntries(settingsFields.map((field) => [field.key, form.get(field.key) ?? ''])), preferredContactLabelId: form.get('preferredContactLabelId') ?? '', personMaxEdge: form.get('personMaxEdge') ?? '', ...Object.fromEntries(wordpressUrlKeys.map(key=>[key,form.get(key)??''])), ...resetValues };
        html(res, failure.code === 'SETTINGS_CONFLICT' ? 409 : failure.code === 'SETTINGS_INVALID' ? 400 : 500,
          settings(session, { error: failure.message, values, revision: form.get('revision') ?? '', saved: false }));
      } finally { if (checking) ctCheckRunning = false; }
      return;
    }
    if (path === '/settings/preview') {
      if (!options.ct?.readSnapshot) {
        const message = 'ChurchTools ist noch nicht für die Auswahlprüfung eingerichtet.';
        if (wantsJson) json(res, 409, { status: 'error', code: 'CT_CONFIG', message });
        else html(res, 409, settings(session, { error: message }));
        return;
      }
      if (ctCheckRunning) {
        const message = 'Eine CT-Prüfung läuft bereits. Bitte später erneut versuchen.';
        if (wantsJson) json(res, 503, { status: 'error', code: 'CT_BUSY', message });
        else html(res, 503, settings(session, { error: message }));
        return;
      }
      ctCheckRunning = true;
      delete session.preview;
      session.previewInitialized = true;
      try {
        session.preview = await loadPreview('manual');
        if (wantsJson) {
          const stale = options.exportSettings.snapshot().revision !== session.preview.revision;
          json(res, 200, { status: 'preview', stale, openWarnings: options.warningStore.openCount(), dataAvailable: true,
            ...(stale ? {} : { preview: session.preview.summary }),
            message: !uploadAllowed(session.preview.data) ? 'Daten abgerufen. Bilddownload fehlgeschlagen; beide JSON-Dateien sind für SFTP gesperrt.' : stale ? 'Die Konfiguration wurde während der Prüfung geändert. Bitte erneut prüfen.'
              : options.warningStore.openCount() ? 'Auswahlprüfung abgeschlossen. Beachte die zentrale Warnungsliste.' : 'Auswahlprüfung erfolgreich abgeschlossen.' });
        } else redirect(res, '/settings');
      } catch (error) {
        const message = error instanceof CtError ? `${error.message} (${error.code})`
          : error instanceof ArchiveError || error instanceof SelectionError || error instanceof WarningStoreError ? error.message : 'Die CT-Auswahl konnte nicht geprüft werden.';
        if (wantsJson) json(res, 502, { status: 'error', message, openWarnings: options.warningStore.openCount(),
          code: error instanceof CtError || error instanceof SelectionError || error instanceof WarningStoreError ? error.code : 'PREVIEW_ERROR' });
        else html(res, 502, settings(session, { error: message }));
      } finally { ctCheckRunning = false; }
      return;
    }
    if (path === '/wordpress-imports/start') {
      try {
        if (!options.wordpressImports) throw new WordpressError('WordPress-Import ist noch nicht eingerichtet.');
        const id = Number(form.get('importId'));
        if (![5,6].includes(id) || !['start','resume'].includes(form.get('mode') ?? '')) throw new WordpressError('Ungültiger Importauftrag.');
        await options.wordpressImports.start(id as ImportId, form.get('mode') === 'resume');
        if (wantsJson) json(res, 202, { status: 'wordpress', message: 'Verarbeitung gestartet.', wordpress: options.wordpressImports.snapshot() });
        else redirect(res, '/wordpress-imports');
      } catch (error) {
        const message = error instanceof WordpressError ? error.message : 'Import konnte nicht gestartet werden.';
        if (wantsJson) json(res, 409, { status: 'error', message, ...(options.wordpressImports ? { wordpress: options.wordpressImports.snapshot() } : {}) });
        else html(res, 409, wordpressPage(session.csrf, options.account.username, options.wordpressImports?.snapshot(), message, options.warningStore.openCount()));
      }
      return;
    }
    if (path === '/sftp/check') {
      let message = '', status = 200;
      try {
        if (!options.uploader?.checkConnection) { status = 409; throw new UploadError('SFTP ist noch nicht eingerichtet.'); }
        await options.uploader.checkConnection();
        lastSftpCheck = new Date(now()).toISOString();
        message = 'Verbindung und Anmeldung am SFTP-Server erfolgreich. Es wurden keine Daten hochgeladen.';
      } catch (error) { status = status === 409 ? 409 : 502; message = error instanceof UploadError ? error.message : 'SFTP-Verbindungsprüfung fehlgeschlagen.'; }
      if (wantsJson) json(res, status, { status: status === 200 ? 'connected' : 'error', message, ...(lastSftpCheck ? { lastSuccess: lastSftpCheck } : {}) });
      else html(res, status, uploadPage(session.csrf, options.exportSettings.snapshot().revision, Boolean(options.uploader), Boolean(session.preview), message, options.warningStore.openCount(), options.account.username, lastSftpCheck, Boolean(session.preview && !uploadAllowed(session.preview.data)), session.preview?.data.loadedAt));
      return;
    }
    if (path === '/upload') {
      if (session.preview && !uploadAllowed(session.preview.data)) { html(res, 409, uploadPage(session.csrf, options.exportSettings.snapshot().revision, Boolean(options.uploader), false, 'Upload gesperrt: Bilddownloads sind fehlgeschlagen oder fehlen. Beide JSON-Dateien sind gesperrt. Details unter Abgerufene Daten.', options.warningStore.openCount(), options.account.username, lastSftpCheck, Boolean(session.preview && !uploadAllowed(session.preview.data)), session.preview?.data.loadedAt)); return; }
      if (!options.uploader || !session.preview) { html(res, 409, uploadPage(session.csrf, options.exportSettings.snapshot().revision, Boolean(options.uploader), Boolean(session.preview), 'SFTP-Konfiguration oder abgerufene Daten fehlen.', options.warningStore.openCount(), options.account.username, lastSftpCheck, Boolean(session.preview && !uploadAllowed(session.preview.data)), session.preview?.data.loadedAt)); return; }
      if (form.get('revision') !== session.preview.revision || session.preview.revision !== options.exportSettings.snapshot().revision) {
        html(res, 409, uploadPage(session.csrf, options.exportSettings.snapshot().revision, true, false, 'Datenstand veraltet. Bitte die Auswahl erneut prüfen.', options.warningStore.openCount(), options.account.username, lastSftpCheck, Boolean(session.preview && !uploadAllowed(session.preview.data)), session.preview?.data.loadedAt)); return;
      }
      try {
        const target = await options.uploader.upload(session.preview.data);
        html(res, 200, uploadPage(session.csrf, session.preview.revision, true, true, '✅ JSON-Dateien hochgeladen: ' + target, options.warningStore.openCount(), options.account.username, lastSftpCheck, Boolean(session.preview && !uploadAllowed(session.preview.data)), session.preview?.data.loadedAt));
      } catch (error) {
        html(res, 502, uploadPage(session.csrf, session.preview.revision, true, true, error instanceof UploadError ? error.message : 'SFTP-Upload fehlgeschlagen.', options.warningStore.openCount(), options.account.username, lastSftpCheck, Boolean(session.preview && !uploadAllowed(session.preview.data)), session.preview?.data.loadedAt));
      }
      return;
    }
    if (path === '/logout') {
      sessions.delete(sid!); cookie(res, '', 0); redirect(res, '/login'); return;
    }
    if (path === '/validate') {
      session.report = await inspectDirectory(options.directory);
      redirect(res, '/'); return;
    }
    if (path === '/ct/check') {
      if (!options.ct) {
        if (wantsJson) json(res, 409, { status: 'error', code: 'CT_CONFIG', message: 'ChurchTools ist noch nicht eingerichtet.' });
        else html(res, 409, dashboard(session));
        return;
      }
      if (ctCheckRunning) {
        if (wantsJson) json(res, 202, { status: 'busy', busy: true, code: 'CT_BUSY', message: 'Eine CT-Prüfung läuft bereits. Der Button wird nach Abschluss automatisch freigegeben.' });
        else html(res, 200, dashboard(session));
        return;
      }
      ctCheckRunning = true;
      let failure: string | undefined;
      try { await options.ct.checkConnection(); session.ctResult = { status: 'connected' }; }
      catch (error) {
        session.ctResult = { status: 'error', code: error instanceof CtError ? error.code : 'CT_NETWORK' };
        failure = error instanceof CtError ? error.message : 'ChurchTools ist nicht erreichbar.';
      }
      finally { ctCheckRunning = false; }
      if (wantsJson) {
        if (session.ctResult.status === 'connected') json(res, 200, { status: 'connected', message: 'Verbindung und Anmeldung bei ChurchTools erfolgreich.' });
        else json(res, 502, { status: 'error', code: session.ctResult.code ?? 'CT_NETWORK',
          message: `${failure} Fehlercode: ${session.ctResult.code ?? 'CT_NETWORK'}` });
      } else redirect(res, '/');
      return;
    }
    html(res, 404, 'Seite nicht gefunden.');
  }
  const server = createServer((req, res) => { void handle(req, res).catch(() => {
    if (!res.headersSent) {
      if (['/ct/check', '/settings/preview', '/settings', '/sftp/check', '/wordpress-imports/start'].includes(req.url?.split('?')[0] ?? '') && req.headers.accept?.includes('application/json')) {
        json(res, 400, { status: 'error', code: 'REQUEST_INVALID', message: 'Die Anfrage konnte nicht verarbeitet werden.' });
      } else html(res, 400, 'Die Anfrage konnte nicht verarbeitet werden.');
    } else res.end();
  }); });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  let finishInitialLoad!: () => void;
  const initialLoad = new Promise<void>((resolve) => { finishInitialLoad = resolve; });
  server.once('listening', () => {
    if (!options.ct?.readSnapshot || options.autoLoad === false) { finishInitialLoad(); return; }
    ctCheckRunning = true;
    const startup = async (): Promise<NonNullable<Session['preview']>> => {
      const latest = fetchHistory.filter(entry => entry.status === 'success' && entry.archiveId)
        .sort((a,b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (latest && now() - Date.parse(latest.startedAt) <= 30 * 60 * 1000) {
        const restored = await options.archive!.restore(latest.archiveId!);
        const groups = restored.data.technicalGroups;
        const summary: SelectionSummary = { groups: groups.length, persons: restored.data.technicalPersons.length,
          landingGroups: groups.filter(g => g.showOnLandingPage).length, contacts: new Set(groups.flatMap(g => g.contactPersonIds)).size,
          categories: new Set(groups.flatMap(g => g.categories)).size, targetGroups: new Set(groups.flatMap(g => g.targetGroups)).size,
          groupsWithAge: groups.filter(g => g.ageCategory !== '').length, groupsWithRecurrence: groups.filter(g => g.recurrenceDescription !== '').length };
        return {...restored, summary};
      }
      return loadPreview('startup');
    };
    void startup().then((preview) => { initialPreview = preview; initialStatus = ''; })
      .catch((error: unknown) => {
        initialStatus = error instanceof ArchiveError || error instanceof CtError || error instanceof SelectionError || error instanceof WarningStoreError
          ? 'Automatischer CT-Abruf fehlgeschlagen: ' + error.message
          : 'Automatischer CT-Abruf fehlgeschlagen. Bitte die Auswahl unter Exportkonfiguration erneut prüfen.';
      }).finally(() => { ctCheckRunning = false; finishInitialLoad(); });
  });
  return Object.assign(server, { initialLoad });
}
