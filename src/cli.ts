import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exportsSchema, legacyExportsSchema, inspectExports } from './contracts.js';

async function readJson(path: string): Promise<unknown> {
  // Pfade und JSON-Inhalte (insbesondere Kontaktdaten) nicht in Fehlerlogs ausgeben.
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new Error('Eine Exportdatei ist nicht lesbar oder enthält ungültiges JSON.');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] === '--help') {
    console.log('Aufruf: npm run validate -- <Verzeichnis mit groups.json und contactPersons.json>');
    if (args[0] !== '--help') process.exitCode = 2;
    return;
  }
  const directory = resolve(args[0]!);
  const [groups, contactPersons] = await Promise.all([
    readJson(resolve(directory, 'groups.json')),
    readJson(resolve(directory, 'contactPersons.json')),
  ]);
  const parsed = legacyExportsSchema.safeParse({ groups, contactPersons });
  if (!parsed.success) {
    // Nur Feldpfade aus dem kontrollierten Vertrag ausgeben, keine Eingangswerte.
    const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
    console.error(JSON.stringify({ status: 'invalid', issues: parsed.error.issues.length, paths }));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    status: 'valid-legacy',
    readyForNewExporter: exportsSchema.safeParse(parsed.data).success,
    ...inspectExports(parsed.data),
  }, null, 2));
}

main().catch(() => {
  console.error(JSON.stringify({ status: 'error', message: 'Exportdateien konnten nicht geprüft werden.' }));
  process.exitCode = 1;
});
