import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findFieldReference, validateReferenceFields, hasField, FieldValidationError } from '../src/export/field-validation.js';
import { defaultExportSettings } from '../src/export/settings.js';
import type { CtSnapshot } from '../src/export/selection.js';
const data: CtSnapshot = { groups: [{ id: 10, name: 'Reference', information: { website_expose: true,
 website_groupcategory_ids: '', website_targetgroup_ids: '', website_agecategory: null, website_recurrence_description: '',
 website_contact_person_ids: '20', website_show_on_landing_page: false, alternative: '' } }],
 persons: [{ id: 20, firstName: 'A', lastName: 'B', website_expose: false, website_person_sort_order: 0 },
 { id: 30, firstName: 'Other', lastName: 'Person', website_expose: true, website_person_sort_order: 1 }], masterData: { groupCategories: [], targetGroups: [] } };
test('Referenz ist eine freigegebene vollständige Gruppe mit ihrem Ansprechpartner', () => {
 assert.deepEqual(findFieldReference(data, defaultExportSettings), { groupId: 10, personId: 20 });
 const missing = structuredClone(data); delete missing.persons[0]!.website_person_sort_order;
 assert.equal(findFieldReference(missing, defaultExportSettings), undefined);
});
test('Feldprüfung unterscheidet vorhandene leere Werte von fehlenden Pfaden', () => {
 for (const value of [null, false, 0, '']) assert.equal(hasField({ field: value }, 'field'), true);
 assert.equal(hasField({}, 'field'), false);
 assert.equal(hasField(Object.create({ field: true }), 'field'), false);
 const candidate = structuredClone(defaultExportSettings); candidate.export.accessPath.agecategory = 'information.alternative';
 validateReferenceFields(data, { groupId: 10, personId: 20 }, candidate);
 candidate.export.person.sortOrder = 'missing_sort'; candidate.export.accessPath.categoryData = 'information.missing_category';
 assert.throws(() => validateReferenceFields(data, { groupId: 10, personId: 20 }, candidate), (error: unknown) =>
 error instanceof FieldValidationError && error.message.includes('Gruppe 10: information.missing_category') && error.message.includes('Person 20: missing_sort'));
 assert.throws(() => validateReferenceFields(data, { groupId: 10, personId: 99 }, defaultExportSettings), FieldValidationError);
});
