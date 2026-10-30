import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const warningSchema = z.strictObject({ code: z.literal('SELECTION_CONTACT'), groupId: z.number().int().positive(),
  personId: z.number().int().positive(), fieldPath: z.string().min(1).max(200).regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/) });
export type SelectionWarning = z.infer<typeof warningSchema>;
export type CheckedContacts = { groupId: number; fieldPath: string };
const entrySchema = warningSchema.extend({ id: z.string().regex(/^[a-f0-9]{64}$/), firstSeen: z.iso.datetime(),
  lastSeen: z.iso.datetime(), occurrences: z.number().int().positive(), status: z.enum(['open', 'resolved']),
  resolvedAt: z.iso.datetime().nullable() });
export type WarningEntry = z.infer<typeof entrySchema>;
const fileSchema = z.strictObject({ version: z.literal(1), items: z.array(entrySchema) });
const warningId = (w: SelectionWarning) => createHash('sha256').update(JSON.stringify([w.code, w.groupId, w.fieldPath, w.personId])).digest('hex');

export function warningMessage(w: SelectionWarning): string {
  return `Gruppe ${w.groupId}, Feld ${w.fieldPath}: Ansprechpartner-ID ${w.personId} ist für den CT-Dienstbenutzer nicht verfügbar. Die Verknüpfung wird ausgelassen; die Gruppe wird weiterverarbeitet. Prüfe in ChurchTools die Ansprechpartnerliste oder die erforderlichen Leserechte.`;
}
export class WarningStoreError extends Error {
  constructor(public readonly code: 'WARNINGS_READ' | 'WARNINGS_WRITE') {
    super(code === 'WARNINGS_READ' ? 'Die zentrale Warnungsliste konnte nicht gelesen werden. Prüfe var/warnings.json.'
      : 'Die Warnungen konnten nicht dauerhaft gespeichert werden. Prüfe die Schreibrechte für das Warnungsverzeichnis.');
  }
}

export class WarningStore {
  private queue: Promise<void> = Promise.resolve();
  private constructor(private readonly file: string, private entries: WarningEntry[], private readonly now: () => Date) {}
  static async load(file = resolve('var/warnings.json'), now: () => Date = () => new Date()): Promise<WarningStore> {
    let entries: WarningEntry[] = [];
    try {
      const parsed = fileSchema.parse(JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')));
      const keys = new Set<string>();
      for (const item of parsed.items) {
        if (item.id !== warningId(item) || keys.has(item.id) || (item.status === 'open') !== (item.resolvedAt === null)) throw new Error('invalid');
        keys.add(item.id);
      }
      entries = parsed.items;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new WarningStoreError('WARNINGS_READ');
    }
    return new WarningStore(resolve(file), entries, now);
  }
  snapshot(): WarningEntry[] { return structuredClone(this.entries); }
  openCount(): number { return this.entries.filter((entry) => entry.status === 'open').length; }

  // Nur erfolgreich geprüfte Gruppen/Feldpfade dürfen alte Warnungen auflösen.
  async reconcile(warnings: SelectionWarning[], checked: CheckedContacts[]): Promise<void> {
    const validated = z.array(warningSchema).parse(warnings);
    const work = this.queue.then(async () => {
      const time = this.now().toISOString();
      const next = new Map(this.entries.map((entry) => [entry.id, structuredClone(entry)]));
      const found = new Set<string>();
      for (const warning of validated) {
        const id = warningId(warning);
        if (found.has(id)) continue;
        found.add(id);
        const previous = next.get(id);
        next.set(id, { ...warning, id, firstSeen: previous?.firstSeen ?? time, lastSeen: time,
          occurrences: (previous?.occurrences ?? 0) + 1, status: 'open', resolvedAt: null });
      }
      for (const entry of next.values()) {
        if (entry.status === 'open' && !found.has(entry.id)
          && checked.some((scope) => scope.groupId === entry.groupId && scope.fieldPath === entry.fieldPath)) {
          entry.status = 'resolved'; entry.resolvedAt = time;
        }
      }
      const items = [...next.values()];
      if (JSON.stringify(items) === JSON.stringify(this.entries)) return;
      const temp = `${this.file}.${randomBytes(12).toString('hex')}.tmp`;
      try {
        await mkdir(dirname(this.file), { recursive: true });
        const handle = await open(temp, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify({ version: 1, items }, null, 2) + '\n'); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temp, this.file); this.entries = items;
      } catch { throw new WarningStoreError('WARNINGS_WRITE'); }
      finally { await unlink(temp).catch(() => {}); }
    });
    this.queue = work.catch(() => {});
    await work;
  }
}
