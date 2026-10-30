import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportsSchema, legacyExportsSchema, inspectExports } from '../src/contracts.js';

function fixture() {
  return {
    groups: [{
      id: 10, name: 'Beispielangebot', startDate: '29.02.2024', endDate: '',
      weekday: 'Sonntag', startTime: '10:00', note: '<p>Beispiel</p>', imageUrl: '',
      export: true, showOnLandingPage: false, categories: ['Beispiele'], targetGroups: [],
      ageCategory: '', recurrenceDescription: 'Wöchentlich',
      contactPersons: [{ id: 20, firstName: 'Alex', lastName: 'Beispiel', email: '', imageUrl: '', phone: '' }],
    }],
    contactPersons: [{
      id: 20, firstName: 'Alex', lastName: 'Beispiel', email: '', imageUrl: '',
      responsibilities: 'Kontakt', sortOrder: 1, groups: [{ id: 10, name: 'Beispielangebot' }],
    }],
  };
}

test('Legacy-Vertrag akzeptiert vollständige Exporte mit leeren optionalen Textwerten', () => {
  assert.equal(exportsSchema.safeParse(fixture()).success, true);
});

test('Doppelte CT-IDs werden abgewiesen, bevor sie WordPress erreichen', () => {
  const data = fixture();
  data.groups.push(data.groups[0]!);
  assert.equal(exportsSchema.safeParse(data).success, false);
});

test('Unbekannte Felder verhindern versehentlichen Export zusätzlicher Personendaten', () => {
  const data = fixture();
  Object.assign(data.contactPersons[0]!, { privateNotes: 'Nicht für die Website' });
  assert.equal(exportsSchema.safeParse(data).success, false);
});

test('Schaltjahre und ungültige Tageswerte werden geprüft', () => {
  const data = fixture();
  data.groups[0]!.startDate = '29.02.2023';
  assert.equal(exportsSchema.safeParse(data).success, false);
  data.groups[0]!.startDate = '31.04.2024';
  assert.equal(exportsSchema.safeParse(data).success, false);
});

test('Unaufgelöste Ansprechpartner-IDs verletzen den Exportvertrag', () => {
  const data = fixture();
  Object.assign(data.groups[0]!, { contactPersons: [20] });
  assert.equal(exportsSchema.safeParse(data).success, false);
});

test('Historische String-IDs werden nur im Bestandsmodus akzeptiert und gemeldet', () => {
  const data = fixture();
  Object.assign(data.groups[0]!, { contactPersons: ['20'] });
  const legacy = legacyExportsSchema.parse(data);
  assert.equal(inspectExports(legacy).unresolvedContactIds, 1);
  assert.equal(inspectExports(legacy).contactsWithoutPersonEntry, 0);
  assert.equal(exportsSchema.safeParse(legacy).success, false);
});

test('Fehlende Beziehungen und Bilder werden ohne Personendaten zusammengefasst', () => {
  const data = fixture();
  data.contactPersons[0]!.groups.push({ id: 99, name: 'Fehlend' });
  data.contactPersons = [];
  const report = inspectExports(exportsSchema.parse(data));
  assert.equal(report.contactsWithoutPersonEntry, 1);
  assert.equal(report.groupsWithoutImage, 1);
  assert.ok(Object.values(report).every((value) => typeof value === 'number'));
});

test('Personenverweise auf nicht exportierte Gruppen werden erkannt', () => {
  const data = fixture();
  data.contactPersons[0]!.groups.push({ id: 99, name: 'Fehlend' });
  assert.equal(inspectExports(exportsSchema.parse(data)).referencesToMissingGroups, 1);
});
