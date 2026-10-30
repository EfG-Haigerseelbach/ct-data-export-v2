import { z } from 'zod';

// Dieser Vertrag beschreibt die tatsächlich vorgefundenen WordPress-Exporte.
// API-Antworten und ein künftiges internes Modell sind davon getrennt zu halten.
const id = z.number().int().positive();
const text = z.string();
const date = text.refine((value) => {
  if (value === '') return true;
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value)) return false;
  const [day, month, year] = value.split('.').map(Number) as [number, number, number];
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}, 'Datum muss leer oder ein gültiges DD.MM.YYYY sein');

export const contactSchema = z.strictObject({
  id, firstName: text, lastName: text, email: text, imageUrl: text, phone: text,
});

export const groupSchema = z.strictObject({
  id,
  name: text.min(1),
  startDate: date,
  endDate: date,
  weekday: z.enum(['', 'Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']),
  startTime: text,
  note: text,
  imageUrl: text,
  export: z.boolean(),
  showOnLandingPage: z.boolean(),
  categories: z.array(text),
  targetGroups: z.array(text),
  ageCategory: text,
  recurrenceDescription: text,
  contactPersons: z.array(contactSchema),
});

export const personSchema = z.strictObject({
  id,
  firstName: text,
  lastName: text,
  email: text,
  imageUrl: text,
  responsibilities: text,
  sortOrder: z.number().int(),
  groups: z.array(z.strictObject({ id, name: text.min(1) })),
});

function checkUniqueIds(
  data: { groups: { id: number }[]; contactPersons: { id: number }[] },
  ctx: z.RefinementCtx,
): void {
  for (const collection of ['groups', 'contactPersons'] as const) {
    const seen = new Set<number>();
    data[collection].forEach((record, index) => {
      if (seen.has(record.id)) {
        ctx.addIssue({ code: 'custom', path: [collection, index, 'id'], message: 'Doppelte ID' });
      }
      seen.add(record.id);
    });
  }
}

export const exportsSchema = z.strictObject({
  groups: z.array(groupSchema),
  contactPersons: z.array(personSchema),
}).superRefine(checkUniqueIds);

// Nur der lesende Bestandsmodus akzeptiert historische, nicht aufgelöste IDs.
export const legacyExportsSchema = z.strictObject({
  groups: z.array(groupSchema.extend({
    contactPersons: z.array(z.union([contactSchema, z.string().regex(/^[1-9]\d*$/)])),
  })),
  contactPersons: z.array(personSchema),
}).superRefine(checkUniqueIds);

export type GroupExport = z.infer<typeof groupSchema>;
export type PersonExport = z.infer<typeof personSchema>;
export type ExportBundle = z.infer<typeof exportsSchema>;

// Fachliche Warnungen sind von Schemafehlern getrennt: Der Altbestand darf
// eingelesen werden, ohne eine neue Freigaberegel stillschweigend anzuwenden.
export function inspectExports(bundle: z.infer<typeof legacyExportsSchema>): Record<string, number> {
  const groups = new Map(bundle.groups.map((group) => [group.id, group]));
  const persons = new Set(bundle.contactPersons.map((person) => person.id));
  return {
    groups: bundle.groups.length,
    contactPersons: bundle.contactPersons.length,
    groupsWithoutImage: bundle.groups.filter((group) => !group.imageUrl.trim()).length,
    personsWithoutImage: bundle.contactPersons.filter((person) => !person.imageUrl.trim()).length,
    groupsWithoutExportFlag: bundle.groups.filter((group) => !group.export).length,
    unresolvedContactIds: bundle.groups.reduce((sum, group) => sum
      + group.contactPersons.filter((person) => typeof person === 'string').length, 0),
    contactsWithoutPersonEntry: bundle.groups.reduce((sum, group) => sum
      + group.contactPersons.filter((person) => !persons.has(typeof person === 'string' ? Number(person) : person.id)).length, 0),
    referencesToMissingGroups: bundle.contactPersons.reduce((sum, person) => sum
      + person.groups.filter((group) => !groups.has(group.id)).length, 0),
  };
}
