import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exportsSchema, inspectExports, legacyExportsSchema } from './contracts.js';

export type Report = { status: 'valid-legacy'; readyForNewExporter: boolean; counts: Record<string, number> }
  | { status: 'invalid'; issues: number }
  | { status: 'error' };

export async function inspectDirectory(directory: string): Promise<Report> {
  try {
    const [groups, contactPersons] = await Promise.all(['groups.json', 'contactPersons.json'].map(async (file) =>
      JSON.parse(await readFile(resolve(directory, file), 'utf8')) as unknown));
    const parsed = legacyExportsSchema.safeParse({ groups, contactPersons });
    if (!parsed.success) return { status: 'invalid', issues: parsed.error.issues.length };
    return { status: 'valid-legacy', readyForNewExporter: exportsSchema.safeParse(parsed.data).success,
      counts: inspectExports(parsed.data) };
  } catch {
    return { status: 'error' };
  }
}
