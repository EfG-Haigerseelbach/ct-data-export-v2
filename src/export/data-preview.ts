import type { ImageValidation } from './image-validation.js';
import type { CtSnapshot, buildSelection } from './selection.js';
import { buildPersonJson } from './person-json.js';
import type { PersonExport } from '../contracts.js';

export type DisplayRecord = { id: number; title: string; fields: Record<string, string> };
export type GroupPreview = ReturnType<typeof buildSelection>['groups'][number] & {
  startDate: string; endDate: string; weekday: string; startTime: string; note: string; imageUrl: string;
};
export type DataPreview = { imageValidation?: ImageValidation; loadedAt: string; fetchedGroups: number; fetchedPersons: number;
  groups: DisplayRecord[]; persons: DisplayRecord[]; technicalPersons: PersonExport[]; technicalGroups: GroupPreview[] };
const scalar = (value: unknown): string => ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';

// Explizite Anzeigefelder statt beliebiger Rohantworten. Kein Dateizugriff.
export function buildDataPreview(snapshot: CtSnapshot, selection: ReturnType<typeof buildSelection>, loadedAt: string, preferredContactLabelId: number | null = null): DataPreview {
  const sourceGroups = new Map(snapshot.groups.map((group) => [group.id, group]));
  return { loadedAt, fetchedGroups: snapshot.groups.length, fetchedPersons: snapshot.persons.length,
    technicalPersons: buildPersonJson(selection, preferredContactLabelId),
    technicalGroups: selection.groups.map((group) => {
      const info = sourceGroups.get(group.id)?.information ?? {};
      return { ...group, contactPersonIds: [...group.contactPersonIds], categories: [...group.categories], targetGroups: [...group.targetGroups],
        startDate: scalar(info.dateOfFoundation), endDate: scalar(info.endDate), weekday: scalar(info.weekday),
        startTime: scalar(info.meetingTime), note: scalar(info.note), imageUrl: scalar(info.imageUrl) };
    }),
    groups: selection.groups.map((group) => {
      const info = sourceGroups.get(group.id)?.information ?? {};
      return { id: group.id, title: group.name, fields: {
        'CT-ID': String(group.id), 'Name': group.name,
        'Beginn': scalar(info.dateOfFoundation), 'Ende': scalar(info.endDate),
        'Wochentag (CT-Wert)': scalar(info.weekday), 'Treffzeit': scalar(info.meetingTime),
        'Beschreibung': scalar(info.note), 'Bild-URL': scalar(info.imageUrl),
        'Kategorien': group.categories.join(', '), 'Zielgruppen': group.targetGroups.join(', '),
        'Altersangabe': group.ageCategory, 'Turnus': group.recurrenceDescription,
        'Verfügbare Ansprechpartner-IDs': group.contactPersonIds.join(', '),
        'Auf der Startseite': group.showOnLandingPage ? 'Ja' : 'Nein',
      } };
    }),
    persons: selection.persons.map((person) => ({ id: person.id, title: `${person.firstName} ${person.lastName}`.trim(), fields: {
      'CT-ID': String(person.id), 'Vorname': person.firstName, 'Nachname': person.lastName,
      'E-Mail-Kandidaten': person.emailCandidates.map((email) => [email.email,
        scalar(email.contactLabelId) ? `Label-ID: ${scalar(email.contactLabelId)}` : '',
        email.isDefault === true || email.isDefault === 1 ? 'Standardadresse' : '',
      ].filter(Boolean).join(' · ')).join('\n'),
      'Bild-URL': person.imageUrl, 'Mobilnummer (Kandidat)': person.phoneCandidates.mobile,
      'Privatnummer (Kandidat)': person.phoneCandidates.private, 'Arbeitsnummer (Kandidat)': person.phoneCandidates.work,
      'Zuständigkeit': person.responsibilities, 'Sortierung': String(person.sortOrder), 'Gruppen-IDs': person.groups.join(', '),
    } })),
  };
}

export type FetchHistoryEntry = { startedAt: string; finishedAt?: string; durationMs?: number | undefined; totalBytes?: number; media?: string[]; uploadAllowed?: boolean; archiveId?: string; groupsFile?: string; personsFile?: string; source: 'startup' | 'manual'; status: 'loading' | 'success' | 'error' };
