import type { ApiGroup, ApiPerson, MasterData } from '../churchtools/schemas.js';
import type { ExportSettings } from './settings.js';
import type { SelectionWarning } from './warnings.js';

export type CtSnapshot = { groups: ApiGroup[]; persons: ApiPerson[]; masterData: MasterData };
type Context = { recordType: 'group' | 'person'; recordId: number; fieldPath: string };
export type SelectionErrorCode = 'SELECTION_FLAG' | 'SELECTION_TEXT' | 'SELECTION_IDS'
  | 'SELECTION_MASTERDATA';
export class SelectionError extends Error {
  constructor(public readonly code: SelectionErrorCode, public readonly context: Context,
    public readonly detail: { receivedType?: string; relatedId?: number } = {}) {
    const location = `${context.recordType === 'group' ? 'Gruppe' : 'Person'} ${context.recordId}, Feld ${context.fieldPath}`;
    const reason = {
      SELECTION_FLAG: `Freigabewert hat ein nicht unterstütztes Format (Typ: ${detail.receivedType ?? 'unbekannt'}). Erwartet: true/false oder 1/0.`,
      SELECTION_TEXT: `Text erwartet, aber Typ ${detail.receivedType ?? 'unbekannt'} erhalten.`,
      SELECTION_IDS: `Ungültiges ID-Format (Typ: ${detail.receivedType ?? 'unbekannt'}). Erwartet: positive IDs, getrennt durch Leerzeichen, Komma oder Semikolon, oder eine ID-Liste.`,
      SELECTION_MASTERDATA: `Kategorie-/Zielgruppen-ID ${detail.relatedId} fehlt in den Stammdaten oder hat keinen lesbaren Namen. Prüfe die Zuordnung und CT-Leserechte.`,
    }[code];
    super(`${location}: ${reason} (${code})`);
    this.name = 'SelectionError';
  }
}
const typeOf = (value: unknown): string => value === null ? 'null' : Array.isArray(value) ? 'Liste' : typeof value;
function at(value: unknown, path: string): unknown {
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
function flag(value: unknown, context: Context): boolean {
  if (typeof value === 'string') value = value.trim().toLowerCase();
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value == null || value === false || value === 0 || value === '' || value === '0' || value === 'false') return false;
  throw new SelectionError('SELECTION_FLAG', context, { receivedType: typeOf(value) });
}
function text(value: unknown, context: Context): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new SelectionError('SELECTION_TEXT', context, { receivedType: typeOf(value) });
  return value;
}
function ids(value: unknown, context: Context): number[] {
  if (value == null || value === '') return [];
  let list: unknown[];
  if (typeof value === 'string') list = value.split(/[\s,;]+/).filter(Boolean);
  else if (typeof value === 'number') list = [value];
  else if (Array.isArray(value)) list = value;
  else if (typeof value === 'object') list = Object.entries(value).filter(([, v]) => v !== false && v != null)
    .map(([key, v]) => v === true ? key : v);
  else throw new SelectionError('SELECTION_IDS', context, { receivedType: typeOf(value) });
  const result = list.map((v) => {
    if (typeof v === 'string') v = v.trim();
    if ((typeof v !== 'string' && typeof v !== 'number') || !/^\d+$/.test(String(v))) throw new SelectionError('SELECTION_IDS', context, { receivedType: typeOf(v) });
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 1) throw new SelectionError('SELECTION_IDS', context, { receivedType: typeOf(v) });
    return n;
  });
  return [...new Set(result)];
}

// Derselbe Feldpfad und dieselben Freigaberegeln wie bei der späteren Auswahl.
export function collectContactPersonIds(groups: ApiGroup[], settings: ExportSettings): number[] {
  const paths = settings.export.accessPath;
  const collected = groups.filter((group) => flag(at(group, paths.exposureIndicator),
    { recordType: 'group', recordId: group.id, fieldPath: paths.exposureIndicator }))
    .flatMap((group) => ids(at(group, paths.contactPersonIds),
      { recordType: 'group', recordId: group.id, fieldPath: paths.contactPersonIds }));
  return [...new Set(collected)].sort((a, b) => a - b);
}

export function buildSelection(snapshot: CtSnapshot, settings: ExportSettings) {
  const paths = settings.export.accessPath;
  const groupContext = (group: ApiGroup, fieldPath: string): Context => ({ recordType: 'group', recordId: group.id, fieldPath });
  const names = (value: unknown, entries: MasterData['groupCategories'], context: Context) => ids(value, context).map((id) => {
    const entry = entries.find((candidate) => candidate.id === id);
    const name = entry?.nameTranslated ?? entry?.name;
    if (typeof name !== 'string') throw new SelectionError('SELECTION_MASTERDATA', context, { relatedId: id });
    return name;
  });
  const groups = snapshot.groups.filter((group) => flag(at(group, paths.exposureIndicator), groupContext(group, paths.exposureIndicator))).map((group) => ({
    id: group.id, name: group.name,
    categories: names(at(group, paths.categoryData), snapshot.masterData.groupCategories, groupContext(group, paths.categoryData)),
    targetGroups: names(at(group, paths.targetGroupIds), snapshot.masterData.targetGroups, groupContext(group, paths.targetGroupIds)),
    ageCategory: text(at(group, paths.agecategory), groupContext(group, paths.agecategory)),
    recurrenceDescription: text(at(group, paths.recurrenceDescription), groupContext(group, paths.recurrenceDescription)),
    contactPersonIds: ids(at(group, paths.contactPersonIds), groupContext(group, paths.contactPersonIds)),
    showOnLandingPage: flag(at(group, paths.showOnLandingPage), groupContext(group, paths.showOnLandingPage)),
  })).sort((a, b) => a.id - b.id);
  const available = new Set(snapshot.persons.map((person) => person.id));
  const warnings: SelectionWarning[] = [];
  for (const group of groups) {
    group.contactPersonIds = group.contactPersonIds.filter((id) => {
      if (available.has(id)) return true;
      warnings.push({ code: 'SELECTION_CONTACT', groupId: group.id, fieldPath: paths.contactPersonIds, personId: id });
      return false;
    });
  }
  const contactIds = new Set(groups.flatMap((group) => group.contactPersonIds));
  // Bestehendes Auswahlverhalten: eigene Freigabe ODER Kontakt einer gewählten Gruppe.
  const persons = snapshot.persons.filter((person) => contactIds.has(person.id)
    || flag(at(person, settings.export.person.attributeThatIndicatesToExport),
      { recordType: 'person', recordId: person.id, fieldPath: settings.export.person.attributeThatIndicatesToExport })).map((person) => {
    const order = at(person, settings.export.person.sortOrder);
    return { id: person.id, firstName: person.firstName, lastName: person.lastName,
      emailCandidates: person.emails ?? [], imageUrl: person.imageUrl ?? '',
      responsibilities: person.website_responsibilities ?? '',
      phoneCandidates: { mobile: person.mobile ?? '', private: person.phonePrivate ?? '', work: person.phoneWork ?? '' },
      order: typeof order === 'number' && Number.isInteger(order) ? order : 99,
      groups: groups.filter((group) => group.contactPersonIds.includes(person.id)).map((group) => group.id) };
  }).sort((a, b) => a.order - b.order || (a.firstName < b.firstName ? -1 : a.firstName > b.firstName ? 1 : a.id - b.id))
    .map(({ order: _order, ...person }, index) => ({ ...person, sortOrder: index + 1 }));
  return { groups, persons, warnings };
}

export type SelectionSummary = { groups: number; persons: number; landingGroups: number; contacts: number;
  categories: number; targetGroups: number; groupsWithAge: number; groupsWithRecurrence: number };
export function summarizeSelection(result: ReturnType<typeof buildSelection>): SelectionSummary {
  return { groups: result.groups.length, persons: result.persons.length,
    landingGroups: result.groups.filter((g) => g.showOnLandingPage).length,
    contacts: new Set(result.groups.flatMap((g) => g.contactPersonIds)).size,
    categories: new Set(result.groups.flatMap((g) => g.categories)).size,
    targetGroups: new Set(result.groups.flatMap((g) => g.targetGroups)).size,
    groupsWithAge: result.groups.filter((g) => g.ageCategory !== '').length,
    groupsWithRecurrence: result.groups.filter((g) => g.recurrenceDescription !== '').length };
}
