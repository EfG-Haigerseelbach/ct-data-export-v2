import { wordpressUrlsSchema, wordpressUrlKeys, emptyImportUrls } from '../wordpress/urls.js';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, open, unlink, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const path = z.string().trim().min(1).max(200).refine((value) => {
  const keys = value.split('.');
  return keys.length <= 10 && keys.every((key) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)
    && !['__proto__', 'prototype', 'constructor'].includes(key));
}, 'Erwartet wird ein Feldpfad wie information.website_expose.');
export const exportSettingsSchema = z.strictObject({ export: z.strictObject({
  accessPath: z.strictObject({ exposureIndicator: path, categoryData: path, targetGroupIds: path,
    agecategory: path, recurrenceDescription: path, contactPersonIds: path, showOnLandingPage: path }),
  person: z.strictObject({ attributeThatIndicatesToExport: path, sortOrder: path }),
  email: z.strictObject({ preferredContactLabelId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable() }).default({ preferredContactLabelId: null }),
  wordpress: wordpressUrlsSchema.default(emptyImportUrls),
  images: z.strictObject({ personMaxEdge: z.number().int().refine(value => value === 0 || (value >= 64 && value <= 4096)) }).default({ personMaxEdge: 960 }),
}) });
export type ExportSettings = z.infer<typeof exportSettingsSchema>;
export const defaultExportSettings: ExportSettings = {
  export: {
    accessPath: { exposureIndicator: 'information.website_expose', categoryData: 'information.website_groupcategory_ids',
      targetGroupIds: 'information.website_targetgroup_ids', agecategory: 'information.website_agecategory',
      recurrenceDescription: 'information.website_recurrence_description', contactPersonIds: 'information.website_contact_person_ids',
      showOnLandingPage: 'information.website_show_on_landing_page' },
    person: { attributeThatIndicatesToExport: 'website_expose', sortOrder: 'website_person_sort_order' },
    email: { preferredContactLabelId: null },
    wordpress: { ...emptyImportUrls },
    images: { personMaxEdge: 960 },
  },
};
export class ExportSettingsError extends Error {
  constructor(public readonly code: 'SETTINGS_INVALID' | 'SETTINGS_CONFLICT' | 'SETTINGS_READ' | 'SETTINGS_WRITE', public readonly fields: string[] = []) {
    super({ SETTINGS_INVALID: 'Ungültige Konfiguration. E-Mail-Label-ID: leer oder eine positive ganze Zahl. Bildgröße: 0 oder eine ganze Zahl zwischen 64 und 4096. Für Feldpfade verwende durch Punkte getrennte Feldnamen ohne Leerzeichen oder Sonderzeichen.',
      SETTINGS_CONFLICT: 'Die Konfiguration wurde inzwischen geändert. Lade die Seite neu und übernimm deine Änderungen erneut.',
      SETTINGS_READ: 'Exportkonfiguration konnte nicht gelesen werden. Prüfe config/export.json.',
      SETTINGS_WRITE: 'Speichern fehlgeschlagen. Die bisherige Konfiguration bleibt aktiv. Prüfe die Schreibrechte für config/.' }[code]);
  }
}
export type SettingsSnapshot = { config: ExportSettings; revision: string; updatedAt: string | null };

export class ExportSettingsStore {
  private current: ExportSettings;
  private queue: Promise<void> = Promise.resolve();
  private constructor(private readonly file: string, config: ExportSettings, private updatedAt: string | null) { this.current = config; }
  static async load(file = resolve('config/export.json')): Promise<ExportSettingsStore> {
    let config: ExportSettings;
    let updatedAt: string | null = null;
    try {
      const data: unknown = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
      const result = exportSettingsSchema.safeParse(data);
      if (!result.success) throw new ExportSettingsError('SETTINGS_INVALID');
      config = result.data;
      updatedAt = (await stat(file)).mtime.toISOString();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') config = structuredClone(defaultExportSettings);
      else if (error instanceof ExportSettingsError) throw error;
      else throw new ExportSettingsError('SETTINGS_READ');
    }
    return new ExportSettingsStore(resolve(file), config, updatedAt);
  }
  snapshot(): SettingsSnapshot {
    return { updatedAt: this.updatedAt, config: structuredClone(this.current), revision: createHash('sha256').update(JSON.stringify(this.current)).digest('hex') };
  }
  async save(input: unknown, expectedRevision: string): Promise<boolean> {
    const parsed = exportSettingsSchema.safeParse(input);
    if (!parsed.success) throw new ExportSettingsError('SETTINGS_INVALID');
    const work = this.queue.then(async () => {
      if (this.snapshot().revision !== expectedRevision) throw new ExportSettingsError('SETTINGS_CONFLICT');
      if (JSON.stringify(parsed.data) === JSON.stringify(this.current)) return false;
      const temp = `${this.file}.${randomBytes(12).toString('hex')}.tmp`;
      try {
        await mkdir(dirname(this.file), { recursive: true });
        const handle = await open(temp, 'wx', 0o600);
        let modified: string;
        try { await handle.writeFile(JSON.stringify(parsed.data, null, 2) + '\n'); await handle.sync(); modified = (await handle.stat()).mtime.toISOString(); }
        finally { await handle.close(); }
        await rename(temp, this.file);
        // Erst nach erfolgreichem Dateiaustausch die laufende Anwendung umstellen.
        this.current = parsed.data; this.updatedAt = modified;
        return true;
      } catch { throw new ExportSettingsError('SETTINGS_WRITE'); }
      finally { await unlink(temp).catch(() => {}); }
    });
    this.queue = work.then(() => {}, () => {});
    return await work;
  }
}

export const settingsFields = [
  { key: 'exposureIndicator', section: 'accessPath', label: 'Gruppen für die Website freigeben' },
  { key: 'categoryData', section: 'accessPath', label: 'Kategorien' },
  { key: 'targetGroupIds', section: 'accessPath', label: 'Zielgruppen' },
  { key: 'agecategory', section: 'accessPath', label: 'Altersangabe' },
  { key: 'recurrenceDescription', section: 'accessPath', label: 'Turnusbeschreibung' },
  { key: 'contactPersonIds', section: 'accessPath', label: 'Ansprechpartner-IDs der Gruppe' },
  { key: 'showOnLandingPage', section: 'accessPath', label: 'Auf der Startseite anzeigen' },
  { key: 'attributeThatIndicatesToExport', section: 'person', label: 'Personen für die Website freigeben' },
  { key: 'sortOrder', section: 'person', label: 'Sortierung der Personen' },
] as const;

export function settingsFromForm(form: URLSearchParams): ExportSettings {
  const accessPath: Record<string, string> = {}, person: Record<string, string> = {};
  const allowed: Set<string> = new Set(['csrf', 'revision', 'preferredContactLabelId', 'personMaxEdge', ...wordpressUrlKeys, ...settingsFields.map((field) => field.key)]);
  for (const key of form.keys()) if (!allowed.has(key) || form.getAll(key).length !== 1) throw new ExportSettingsError('SETTINGS_INVALID');
  for (const field of settingsFields) (field.section === 'person' ? person : accessPath)[field.key] = form.get(field.key) ?? '';
  const edge = form.get('personMaxEdge');
  const personMaxEdge = edge === null ? 960 : edge.trim() === '' ? NaN : Number(edge);
  const label = form.get('preferredContactLabelId')?.trim();
  const preferredContactLabelId = label ? (/^[1-9]\d*$/.test(label) ? Number(label) : NaN) : null;
  const parsed = exportSettingsSchema.safeParse({ export: { accessPath, person, email: { preferredContactLabelId }, images: { personMaxEdge }, wordpress: Object.fromEntries(wordpressUrlKeys.map(key=>[key,form.get(key)??''])) } });
  if (!parsed.success) throw new ExportSettingsError('SETTINGS_INVALID', parsed.error.issues.map((issue) => String(issue.path.at(-1))));
  return parsed.data;
}
