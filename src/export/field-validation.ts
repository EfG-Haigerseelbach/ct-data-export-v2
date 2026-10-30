import type { CtSnapshot } from './selection.js';
import { buildSelection } from './selection.js';
import type { ExportSettings } from './settings.js';
import { settingsFields } from './settings.js';
export type FieldReference = { groupId: number; personId: number };
export class FieldValidationError extends Error {
  constructor(message: string, public readonly fields: string[] = []) { super(message); }
}
export function hasField(record: unknown, path: string): boolean {
  let value = record;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return false;
    value = (value as Record<string, unknown>)[key];
  }
  return value !== undefined;
}
export function findFieldReference(data: CtSnapshot, config: ExportSettings): FieldReference | undefined {
  const selection = buildSelection(data, config);
  for (const group of selection.groups) {
    const source = data.groups.find((entry) => entry.id === group.id)!;
    if (!Object.values(config.export.accessPath).every((path) => hasField(source, path))) continue;
    for (const id of group.contactPersonIds) {
      const person = data.persons.find((entry) => entry.id === id);
      if (person && Object.values(config.export.person).every((path) => hasField(person, path))) return { groupId: group.id, personId: id };
    }
  }
  return undefined;
}
export function validateReferenceFields(data: CtSnapshot, reference: FieldReference, candidate: ExportSettings): void {
  const group = data.groups.find((entry) => entry.id === reference.groupId);
  const person = data.persons.find((entry) => entry.id === reference.personId);
  if (!group || !person) throw new FieldValidationError('Referenzgruppe oder Ansprechpartner ist in ChurchTools nicht mehr lesbar. Bitte die Auswahl erneut prüfen. Es wurde nichts gespeichert.');
  const missing = settingsFields.filter((field) => {
    const paths: Record<string, string> = candidate.export[field.section];
    return !hasField(field.section === 'accessPath' ? group : person, paths[field.key]!);
  });
  if (missing.length) throw new FieldValidationError('Nicht gespeichert. Folgende Attribute fehlen: ' + missing.map((field) => {
    const paths: Record<string, string> = candidate.export[field.section];
    return `${field.section === 'accessPath' ? 'Gruppe ' + group.id : 'Person ' + person.id}: ${paths[field.key]}`;
  }).join('; '), missing.map((field) => field.key));
}
