import sdk from '@churchtools/churchtools-client';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
import { validateCtConfig } from './config.js';
import type { CtConfig } from './config.js';
import { apiGroupSchema, apiPersonSchema, identitySchema, masterDataSchema, pageSchema } from './schemas.js';
import type { ApiGroup, ApiPerson } from './schemas.js';
import type { CtSnapshot } from '../export/selection.js';

export type CtErrorCode = 'CT_AUTH' | 'CT_FORBIDDEN' | 'CT_RATE_LIMIT' | 'CT_TIMEOUT' | 'CT_RESPONSE'
  | 'CT_NOT_FOUND' | 'CT_NETWORK' | 'CT_PAGE_LIMIT' | 'CT_HTTP';
const messages: Record<CtErrorCode, string> = {
  CT_NOT_FOUND: 'ChurchTools-Datei nicht gefunden.', CT_AUTH: 'ChurchTools-Anmeldung fehlgeschlagen.', CT_FORBIDDEN: 'ChurchTools-Leserechte fehlen.',
  CT_RATE_LIMIT: 'ChurchTools-Anfragelimit erreicht. Später erneut versuchen.',
  CT_TIMEOUT: 'Das Zeitlimit für ChurchTools wurde erreicht.', CT_RESPONSE: 'Unerwartete Daten von ChurchTools erhalten.',
  CT_NETWORK: 'ChurchTools ist nicht erreichbar.', CT_PAGE_LIMIT: 'Das konfigurierte Seitenlimit wurde überschritten.',
  CT_HTTP: 'ChurchTools hat die Anfrage abgelehnt.',
};
export class CtError extends Error {
  constructor(public readonly code: CtErrorCode) { super(messages[code]); this.name = 'CtError'; }
}
type HttpError = { response?: { status?: number; headers?: Record<string, unknown> }; code?: string };

// Öffentliche SDK-Erweiterung: native Abbruchsignale statt nicht bereinigter SDK-Timer.
class BoundedClient extends sdk.ChurchToolsClient {
  private binaryRequest?: (url: string) => Promise<Buffer>;
  async download(url: string): Promise<Buffer> {
    if (!this.binaryRequest) throw new CtError('CT_NETWORK');
    return this.binaryRequest(url);
  }
  constructor(config: CtConfig, private readonly operationSignal: AbortSignal) {
    super(config.baseUrl);
    this.setRequestTimeout(config.requestTimeoutMs);
    this.requestLimit = config.requestTimeoutMs;
    this.setNeedsAuthentication(true);
    this.setForceSession(true);
    this.setCookieJar((axios) => {
      axios.defaults.maxRedirects = 0;
      axios.defaults.maxContentLength = 10 * 1024 * 1024;
      // SDK nutzt Axios-CJS-Typen, CookieJar-Wrapper Axios-ESM-Typen.
      // Beide referenzieren dieselbe installierte Laufzeitinstanz; wrapper mutiert sie.
      wrapper(axios as unknown as Parameters<typeof wrapper>[0]);
      this.binaryRequest = async (url) => {
        const response = await axios.get(url, { responseType: 'arraybuffer', signal: this.getAbortSignal(), maxRedirects: 0, maxContentLength: 10 * 1024 * 1024 });
        if (response.status !== 200) throw new CtError('CT_HTTP');
        return Buffer.from(response.data as ArrayBuffer);
      };
      return axios;
    }, new CookieJar());
  }
  private readonly requestLimit: number;
  override getAbortSignal(controller?: AbortController, timeout?: number): AbortSignal {
    return AbortSignal.any([this.operationSignal, AbortSignal.timeout(timeout ?? this.requestLimit),
      ...(controller ? [controller.signal] : [])]);
  }
}

export type ConnectionStatus = { status: 'connected' | 'error'; code?: CtErrorCode };
export interface CtConnection { checkConnection(): Promise<void> }

export class ChurchToolsApi implements CtConnection {
  private readonly config: CtConfig;
  constructor(config: CtConfig, options: { allowHttpLoopback?: boolean } = {}) {
    this.config = validateCtConfig(config, options.allowHttpLoopback);
  }

  private async operation<T>(work: (get: (path: string, params?: Record<string, unknown>) => Promise<unknown>) => Promise<T>): Promise<T> {
    const signal = AbortSignal.timeout(this.config.operationTimeoutMs);
    const client = new BoundedClient(this.config, signal);
    // Kein globaler SDK-Singleton, kein SDK-Logging, keine unbeschränkten SDK-Retries.
    const mapError = (error: unknown): CtError => {
      if (error instanceof CtError) return error;
      const e = error as HttpError;
      if (signal.aborted || e?.code === 'ERR_CANCELED' || e?.code === 'ECONNABORTED') return new CtError('CT_TIMEOUT');
      const status = e?.response?.status;
      if (status === 401) return new CtError('CT_AUTH');
      if (status === 404) return new CtError('CT_NOT_FOUND');
      if (status === 403) return new CtError('CT_FORBIDDEN');
      if (status === 429) return new CtError('CT_RATE_LIMIT');
      return new CtError(status ? 'CT_HTTP' : 'CT_NETWORK');
    };
    let authenticated = false;
    const login = async () => {
      try {
        await client.loginWithToken(this.config.loginToken);
        const who = await client.get<unknown>('/whoami', {}, { callDeferred: false });
        if (!identitySchema.safeParse(who).success) throw new CtError('CT_AUTH');
        authenticated = true;
      } catch (error) { throw mapError(error); }
    };
    const get = async (path: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      if (!['/groups', '/persons', '/person/masterdata'].includes(path) && !/^\/files\/avatar\/[1-9]\d*$/.test(path)) throw new CtError('CT_HTTP');
      let relogged = false;
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        try {
          return await client.get<unknown>(path, { ...params }, { rawResponse: true, callDeferred: false });
        } catch (error) {
          const e = error as HttpError;
          if (e?.response?.status === 401 && authenticated && !relogged) {
            relogged = true; await login(); attempt--; continue;
          }
          const status = e?.response?.status;
          if (attempt >= this.config.maxRetries || (status !== 429 && status !== 502 && status !== 503 && status !== 504)) throw mapError(error);
          const retryAfter = e.response?.headers?.['retry-after'];
          const seconds = typeof retryAfter === 'string' && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
          const date = typeof retryAfter === 'string' ? Date.parse(retryAfter) : NaN;
          const wait = seconds !== undefined ? seconds * 1000 : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 250 * 2 ** attempt;
          // Abbruch während Retry-After respektieren; keine weitere Anfrage nach Ablauf.
          await delay(Math.min(wait, 300_000), undefined, { signal });
        }
      }
    };
    await login();
    try {
      return await work(async (path, params) => {
        try { return await get(path, params); }
        catch (error) { throw mapError(error); }
      });
    } catch (error) {
      if (signal.aborted) throw new CtError('CT_TIMEOUT');
      // Fachliche Planungsfehler aus dem Aufrufer nicht als Netzwerkfehler umdeuten.
      throw error;
    }
  }

  async downloadImages(urls: string[]): Promise<Map<string, { body?: Buffer; error?: string }>> {
    const unique = [...new Set(urls)];
    const results = new Map<string, { body?: Buffer; error?: string }>();
    if (!unique.length) return results;
    const signal = AbortSignal.timeout(120_000);
    const client = new BoundedClient(this.config, signal);
    try {
      await client.loginWithToken(this.config.loginToken);
      const who = await client.get<unknown>('/whoami', {}, { callDeferred: false });
      if (!identitySchema.safeParse(who).success) throw new CtError('CT_AUTH');
    } catch { for (const url of unique) results.set(url, { error: 'CT_AUTH' }); return results; }
    for (const value of unique) {
      try {
        const url = new URL(value), base = new URL(this.config.baseUrl);
        // Keine CT-Cookies an fremde Hosts und keine Login-Token aus Bild-URLs versenden.
        if (url.origin !== base.origin || url.username || url.password || url.searchParams.has('login_token')) throw new CtError('CT_RESPONSE');
        results.set(value, { body: await client.download(url.href) });
      } catch (error) {
        const status = (error as HttpError)?.response?.status;
        results.set(value, { error: error instanceof CtError ? error.code : status ? 'HTTP_' + status : signal.aborted ? 'TIMEOUT' : 'DOWNLOAD' });
      }
    }
    return results;
  }

  async checkConnection(): Promise<void> { await this.operation(async () => undefined); }

  private async pages<T>(get: (path: string, params?: Record<string, unknown>) => Promise<unknown>, path: string, item: z.ZodType<T>, ids?: number[]): Promise<T[]> {
    const result: T[] = [];
    const seen = new Set<number>();
    for (let page = 1; page <= this.config.maxPages; page++) {
      const raw = await get(path, { page, limit: this.config.pageSize, ...(ids ? { ids } : {}) });
      const response = z.object({ data: pageSchema }).safeParse(raw);
      if (!response.success) throw new CtError('CT_RESPONSE');
      const body = response.data.data;
      if ((body.meta.pagination.current !== undefined && body.meta.pagination.current !== page)
        || body.meta.pagination.lastPage > this.config.maxPages
        || (body.meta.pagination.lastPage === 0 && body.data.length > 0)) throw new CtError('CT_PAGE_LIMIT');
      for (const row of body.data) {
        const parsed = item.safeParse(row);
        if (!parsed.success) throw new CtError('CT_RESPONSE');
        const id = (parsed.data as { id: number }).id;
        if (seen.has(id) || (ids && !ids.includes(id))) throw new CtError('CT_RESPONSE');
        seen.add(id); result.push(parsed.data);
      }
      if (body.meta.pagination.lastPage <= page) return result;
    }
    throw new CtError('CT_PAGE_LIMIT');
  }

  private async resolveAvatars(get: (path: string) => Promise<unknown>, persons: ApiPerson[], selectedIds = persons.map((person) => person.id)) {
    const selected = new Set(selectedIds);
    for (const person of persons) {
      // Geschützte Personenbild-URLs niemals als Fallback weiterreichen.
      person.imageUrl = '';
      if (!selected.has(person.id)) continue;
      let raw: unknown;
      try { raw = await get('/files/avatar/' + person.id); }
      catch (error) {
        if (error instanceof CtError && error.code === 'CT_NOT_FOUND') continue;
        throw error;
      }
      const response = z.object({ data: z.object({ data: z.unknown() }) }).safeParse(raw);
      if (!response.success) throw new CtError('CT_RESPONSE');
      const value = response.data.data.data;
      const entries = value == null ? [] : Array.isArray(value) ? value : [value];
      if (entries.length === 0) continue;
      const avatar = z.object({ fileUrl: z.string().nullish() }).safeParse(entries[0]);
      if (!avatar.success) throw new CtError('CT_RESPONSE');
      if (!avatar.data.fileUrl) continue;
      let url: URL;
      try { url = new URL(avatar.data.fileUrl); } catch { throw new CtError('CT_RESPONSE'); }
      if (url.protocol !== 'https:' || url.username || url.password
        || url.searchParams.get('q') !== 'public/filedownload'
        || !url.searchParams.get('id') || !url.searchParams.get('filename')) throw new CtError('CT_RESPONSE');
      person.imageUrl = avatar.data.fileUrl;
    }
  }

  async getGroups() { return this.operation((get) => this.pages(get, '/groups', apiGroupSchema)); }
  async getPersons(ids?: number[]) {
    if (ids && (!ids.every((id) => Number.isSafeInteger(id) && id > 0) || ids.length > 100)) throw new CtError('CT_RESPONSE');
    if (ids?.length === 0) return [];
    return this.operation(async (get) => {
      const persons = await this.pages(get, '/persons', apiPersonSchema, ids);
      await this.resolveAvatars(get, persons);
      return persons;
    });
  }
  async getMasterData() {
    return this.operation(async (get) => {
      const raw = await get('/person/masterdata');
      const parsed = z.object({ data: z.object({ data: masterDataSchema }) }).safeParse(raw);
      if (!parsed.success) throw new CtError('CT_RESPONSE');
      return parsed.data.data.data;
    });
  }
  async readSnapshot(selectContactIds?: (groups: ApiGroup[]) => number[], selectAvatarIds?: (snapshot: CtSnapshot) => number[]) {
    return this.operation(async (get) => {
      const groups = await this.pages(get, '/groups', apiGroupSchema);
      const requestedContactIds = selectContactIds ? [...new Set(selectContactIds(groups))].sort((a, b) => a - b) : [];
      if (!requestedContactIds.every((id) => Number.isSafeInteger(id) && id > 0)) throw new CtError('CT_RESPONSE');
      const contacts: ApiPerson[] = [];
      const readContacts = (ids: number[]) => this.pages(get, '/persons', apiPersonSchema, ids);
      // Jede eindeutige ID nur in einem Batch; Pagination gilt auch für diese gefilterten Abfragen.
      for (let start = 0; start < requestedContactIds.length; start += 100) {
        const batch = requestedContactIds.slice(start, start + 100);
        try { contacts.push(...await readContacts(batch)); }
        catch (error) {
          if (!(error instanceof CtError) || error.code !== 'CT_FORBIDDEN') throw error;
          // Manche APIs lehnen einen ganzen Batch bei einer nicht lesbaren Person ab.
          // Einzeln isolieren; nur diese Referenzen fehlen später und erzeugen Warnungen.
          if (batch.length > 1) for (const id of batch) {
            try { contacts.push(...await readContacts([id])); }
            catch (singleError) {
              if (!(singleError instanceof CtError) || singleError.code !== 'CT_FORBIDDEN') throw singleError;
            }
          }
        }
      }
      // Eigene freigegebene Personen ohne Gruppenzuordnung weiterhin berücksichtigen.
      const listed = await this.pages(get, '/persons', apiPersonSchema);
      const persons = selectContactIds
        ? [...listed.filter((person) => !requestedContactIds.includes(person.id)), ...contacts].sort((a, b) => a.id - b.id)
        : listed;
      const parsed = z.object({ data: z.object({ data: masterDataSchema }) }).safeParse(await get('/person/masterdata'));
      if (!parsed.success) throw new CtError('CT_RESPONSE');
      const snapshot = { groups, persons, masterData: parsed.data.data.data };
      await this.resolveAvatars(get, persons, selectAvatarIds?.(snapshot));
      return { ...snapshot, contactPersons: contacts, requestedContactIds };
    });
  }
}
