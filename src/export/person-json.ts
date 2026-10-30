import { personSchema } from '../contracts.js';
import type { PersonExport } from '../contracts.js';
import type { buildSelection } from './selection.js';

// Technische Vorschau im bestehenden Personenformat; kein Dateizugriff.
export function buildPersonJson(selection: ReturnType<typeof buildSelection>, preferredContactLabelId: number | null = null): PersonExport[] {
  const groups = new Map(selection.groups.map((group) => [group.id, group.name]));
  return personSchema.array().parse(selection.persons.map((person) => {
    const emails = person.emailCandidates.filter((candidate) => candidate.email.trim() !== '');
    // Optional konfiguriertes Label, sonst Standardadresse, dann erste nicht leere Adresse.
    const email = emails.find((candidate) => preferredContactLabelId !== null && (candidate.contactLabelId === preferredContactLabelId || candidate.contactLabelId === String(preferredContactLabelId)))
      ?? emails.find((candidate) => candidate.isDefault === true || candidate.isDefault === 1
        || candidate.isDefault === 'true' || candidate.isDefault === '1')
      ?? emails[0];
    return { id: person.id, firstName: person.firstName, lastName: person.lastName,
      email: email?.email ?? '', imageUrl: person.imageUrl, responsibilities: person.responsibilities,
      sortOrder: person.sortOrder,
      groups: person.groups.map((id) => ({ id, name: groups.get(id) })),
    };
  }));
}
