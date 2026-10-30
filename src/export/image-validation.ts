import { createHash } from 'node:crypto';
import type { DataPreview } from './data-preview.js';
export type ImageFailure = { personId?: number; groupId?: number; code: string; httpStatus?: number };
export type ImageValidation = { mode?: 'authenticated-local'; checkedAt: string; uploadAllowed: boolean; groupsHash: string; personsHash: string; errors: ImageFailure[] };
export function dataHashes(data: DataPreview) {
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 return {groupsHash:hash(data.technicalGroups),personsHash:hash(data.technicalPersons)};
}
export function uploadAllowed(data: DataPreview): boolean {
 const check=data.imageValidation;
 if(!check || check.mode !== 'authenticated-local' || !check.uploadAllowed || check.errors.length) return false;
 const hashes=dataHashes(data);return hashes.groupsHash===check.groupsHash && hashes.personsHash===check.personsHash;
}

export type ImageValidator = (data:DataPreview)=>Promise<ImageValidation>;
