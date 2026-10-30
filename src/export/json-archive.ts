import { prepareLocalImages } from './local-images.js';
import type { ImageDownloader } from './local-images.js';
import { uploadAllowed } from './image-validation.js';
import { mkdir, writeFile, readFile, readdir, rename, unlink, rmdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { DataPreview, FetchHistoryEntry } from './data-preview.js';
import { personSchema } from '../contracts.js';
const cachedGroup = z.object({ id:z.number().int().positive(),name:z.string(),contactPersonIds:z.array(z.number().int().positive()),
 categories:z.array(z.string()),targetGroups:z.array(z.string()),ageCategory:z.string(),recurrenceDescription:z.string(),showOnLandingPage:z.boolean(),
 startDate:z.string(),endDate:z.string(),weekday:z.string(),startTime:z.string(),note:z.string(),imageUrl:z.string() });
const archiveId = z.union([z.string().uuid(),z.string().regex(/^[a-f0-9]{64}$/)]);
const metadata = z.object({ id: archiveId, startedAt: z.string().datetime(), finishedAt: z.string().datetime(), durationMs: z.number().finite().nonnegative().optional(),
 uploadAllowed: z.boolean().default(false), media:z.array(z.string().regex(/^[a-f0-9]{64}\.png$/)).default([]), imageValidation: z.object({ mode:z.literal('authenticated-local').optional(), checkedAt:z.string().datetime(), uploadAllowed:z.boolean(),groupsHash:z.string(),personsHash:z.string(),errors:z.array(z.object({personId:z.number().int().positive().optional(),groupId:z.number().int().positive().optional(),code:z.string(),httpStatus:z.number().optional()})) }).optional(),
 source: z.enum(['startup','manual']), status: z.literal('success'), revision: z.string().regex(/^[a-f0-9]{64}$/),
 groupsFile: z.string().regex(/^\d{4}\.\d{2}\.\d{2}_\d{6}_groups\.json$/),
 personsFile: z.string().regex(/^\d{4}\.\d{2}\.\d{2}_\d{6}_contactPersons\.json$/) });
async function totalFileBytes(directory:string):Promise<number> {
 const entries=await readdir(directory,{withFileTypes:true});
 const sizes=await Promise.all(entries.filter(entry=>entry.isFile()).map(async(entry)=>(await stat(join(directory,entry.name))).size));
 return sizes.reduce((sum,size)=>sum+size,0);
}
export class ArchiveError extends Error { constructor(){super('JSON-Archiv konnte nicht gelesen oder gespeichert werden. Prüfe den Archivordner und seine Schreibrechte.');} }
export class JsonArchive {
 private constructor(private directory: string, public readonly entries: FetchHistoryEntry[]) {}
 static async load(directory = resolve('var/exports')): Promise<JsonArchive> {
  const entries: FetchHistoryEntry[] = [];
  let directoryRead = false;
  try {
   const items = await readdir(directory, { withFileTypes: true });
   directoryRead = true;
   for (const item of items) {
    if (!item.isDirectory() || !archiveId.safeParse(item.name).success) continue;
    const entry = metadata.parse(JSON.parse(await readFile(join(directory,item.name,'manifest.json'),'utf8')));
    if(entry.id !== item.name) throw new ArchiveError();
    entries.push({...entry,totalBytes:await totalFileBytes(join(directory,item.name)),uploadAllowed:entry.imageValidation?.mode === 'authenticated-local' && entry.uploadAllowed,archiveId:entry.id});
   }
  } catch(error){if(directoryRead || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ArchiveError();}
  entries.sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  return new JsonArchive(resolve(directory),entries);
 }
 async save(data: DataPreview, entry: FetchHistoryEntry, revision: string, images?: {download:ImageDownloader;publicBaseUrl:string;personMaxEdge?:number}, elapsedMs?: () => number): Promise<FetchHistoryEntry> {
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(entry.startedAt));
  const part=(type:string)=>parts.find((p)=>p.type===type)!.value;
  const stamp=part('year')+'.'+part('month')+'.'+part('day')+'_'+part('hour')+part('minute')+part('second');
  const id=randomBytes(32).toString('hex'), staging=join(this.directory,'.'+id+'.tmp');
  const media=images ? await prepareLocalImages(data,id,images.publicBaseUrl,images.download,images.personMaxEdge) : [];
  const record={...(elapsedMs ? { durationMs: 0 } : {}),media:media.map(file=>file.name), uploadAllowed:uploadAllowed(data), imageValidation:data.imageValidation, files:{groups:{uploadAllowed:uploadAllowed(data)},contactPersons:{uploadAllowed:uploadAllowed(data)}}, id,startedAt:entry.startedAt,finishedAt:new Date().toISOString(),source:entry.source,status:'success' as const,revision,
   groupsFile:stamp+'_groups.json',personsFile:stamp+'_contactPersons.json'};
  try {
   await mkdir(staging,{recursive:true,mode:0o700});
   for(const file of media)await writeFile(join(staging,file.name),file.body,{flag:'wx',mode:0o600});
   await writeFile(join(staging,record.groupsFile),JSON.stringify(data.technicalGroups,null,2)+'\n',{flag:'wx',mode:0o600});
   await writeFile(join(staging,record.personsFile),JSON.stringify(data.technicalPersons,null,2)+'\n',{flag:'wx',mode:0o600});
   if (elapsedMs) record.durationMs = Math.max(0, Math.round(elapsedMs()));
   await writeFile(join(staging,'manifest.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
   const totalBytes=await totalFileBytes(staging);
   await rename(staging,join(this.directory,id));
   const result={...record,totalBytes,archiveId:id};this.entries.unshift(result);return result;
  }catch{throw new ArchiveError();}
  finally{for(const name of [...media.map(file=>file.name),record.groupsFile,record.personsFile,'manifest.json']) await unlink(join(staging,name)).catch(()=>{});await rmdir(staging).catch(()=>{});}
 }
 async readMedia(id:string,name:string):Promise<Buffer>{
  if(!archiveId.safeParse(id).success || !/^[a-f0-9]{64}\.png$/.test(name))throw new ArchiveError();
  const entry=this.entries.find(item=>item.archiveId===id);
  if(!entry?.media?.includes(name))throw new ArchiveError();
  try{return await readFile(join(this.directory,id,name));}catch{throw new ArchiveError();}
 }
 async restore(id:string):Promise<{revision:string;data:DataPreview}> {
  if(!archiveId.safeParse(id).success) throw new ArchiveError();
  try {
   const record=metadata.parse(JSON.parse(await readFile(join(this.directory,id,'manifest.json'),'utf8')));
   if(record.id!==id) throw new ArchiveError();
   const groups=cachedGroup.array().parse(JSON.parse((await this.read(id,'groups')).json));
   const persons=personSchema.array().parse(JSON.parse((await this.read(id,'contactPersons')).json));
   const data:DataPreview={loadedAt:record.finishedAt,fetchedGroups:groups.length,fetchedPersons:persons.length,
    technicalGroups:groups,technicalPersons:persons,
    groups:groups.map(g=>({id:g.id,title:g.name,fields:{'CT-ID':String(g.id),'Name':g.name,'Beginn':g.startDate,'Ende':g.endDate,
     'Wochentag (CT-Wert)':g.weekday,'Treffzeit':g.startTime,'Beschreibung':g.note,'Bild-URL':g.imageUrl,'Kategorien':g.categories.join(', '),
     'Zielgruppen':g.targetGroups.join(', '),'Altersangabe':g.ageCategory,'Turnus':g.recurrenceDescription,
     'Verfügbare Ansprechpartner-IDs':g.contactPersonIds.join(', '),'Auf der Startseite':g.showOnLandingPage?'Ja':'Nein'}})),
    persons:persons.map(p=>({id:p.id,title:`${p.firstName} ${p.lastName}`.trim(),fields:{'CT-ID':String(p.id),'Vorname':p.firstName,
     'Nachname':p.lastName,'E-Mail':p.email,'Bild-URL':p.imageUrl,'Zuständigkeit':p.responsibilities,'Sortierung':String(p.sortOrder),
     'Gruppen-IDs':p.groups.map(g=>g.id).join(', ')}})),
   };
   if(record.imageValidation) {
    const validation=record.imageValidation;
    data.imageValidation={checkedAt:validation.checkedAt,uploadAllowed:record.uploadAllowed && validation.uploadAllowed,
     groupsHash:validation.groupsHash,personsHash:validation.personsHash,
     ...(validation.mode ? {mode:validation.mode}:{}),
     errors:validation.errors.map(e=>({code:e.code,...(e.personId!==undefined?{personId:e.personId}:{}),
      ...(e.groupId!==undefined?{groupId:e.groupId}:{}),...(e.httpStatus!==undefined?{httpStatus:e.httpStatus}:{})}))};
   }
   return {revision:record.revision,data};
  }catch{throw new ArchiveError();}
 }
 async read(id:string,kind:'groups'|'contactPersons'):Promise<{name:string;json:string}> {
  if(!archiveId.safeParse(id).success) throw new ArchiveError();
  const entry=this.entries.find((entry)=>entry.archiveId===id);if(!entry)throw new ArchiveError();
  const name=kind==='groups'?entry.groupsFile:entry.personsFile;if(!name)throw new ArchiveError();
  try{return {name,json:JSON.stringify(JSON.parse(await readFile(join(this.directory,id,name),'utf8')),null,2)};}catch{throw new ArchiveError();}
 }
}
