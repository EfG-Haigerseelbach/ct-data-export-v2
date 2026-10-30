import { emptyImportUrls, wordpressUrlKeys, wordpressUrlsSchema, urlParts } from './urls.js';
import type { ImportUrls, WordpressUrlKey } from './urls.js';
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
export type ImportId = 5 | 6;
export class WordpressError extends Error {}
export class WordpressUrlError extends WordpressError { constructor(message:string,public readonly fields:WordpressUrlKey[]){super(message);} }
const runSchema=z.object({startedAt:z.string().datetime(),finishedAt:z.string().datetime(),successful:z.boolean()});
const stateSchema=z.object({id:z.union([z.literal(5),z.literal(6)]),status:z.enum(['idle','running','success','failed','unknown']),
 startedAt:z.string().datetime().optional(),finishedAt:z.string().datetime().optional(),message:z.string(),lastCompleted:runSchema.optional()});
export type ImportState=z.infer<typeof stateSchema>;
export type WordpressConfig={endpoint:string;key:string;importId?:number;triggerUrl?:string;processingUrl?:string};
export function readWordpressConfig(env:NodeJS.ProcessEnv=process.env):WordpressConfig|undefined{
 if(!env.WP_IMPORT_KEY?.trim())return undefined;
 const endpoint=env.WP_IMPORT_ENDPOINT?.trim();
 if(!endpoint)throw new WordpressError('WP_IMPORT_ENDPOINT fehlt oder ist leer. Bei gesetztem WP_IMPORT_KEY muss die HTTPS-URL zu wp-load.php angegeben werden.');
 try{const url=new URL(endpoint);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error();
  return {endpoint:url.href,key:env.WP_IMPORT_KEY.trim()};
 }catch{throw new WordpressError('WP_IMPORT_ENDPOINT muss eine HTTPS-URL ohne Zugangsdaten, Query oder Fragment sein.');}
}
export type CronReply={status:number;message:string};
export function classifyReply(reply:CronReply,id:number,action:'trigger'|'processing'):'triggered'|'complete'|'progress'|'busy'|'canceled'|'unknown'{
 if(reply.status===200 && action==='trigger' && reply.message===`#${id} Cron job triggered.`)return 'triggered';
 if(reply.status===200 && action==='processing' && reply.message===`Import #${id} complete`)return 'complete';
 if(reply.status===200 && action==='processing' && /^Records Processed \d+\./.test(reply.message))return 'progress';
 if(reply.status===403 && action==='processing' && reply.message===`Import #${id} already processing. Request skipped.`)return 'busy';
 if(reply.status===200 && reply.message===`Import #${id} canceled`)return 'canceled';
 return 'unknown';
}
export async function cronRequest(config:WordpressConfig,id:ImportId,action:'trigger'|'processing',signal:AbortSignal,transport:typeof fetch=fetch):Promise<CronReply>{
 const url=new URL((action==='trigger'?config.triggerUrl:config.processingUrl)??config.endpoint);url.searchParams.set('import_key',config.key);url.searchParams.set('import_id',String(config.importId??id));url.searchParams.set('action',action);url.searchParams.set('rand',randomUUID());
 try{
  const response=await transport(url,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:'application/json','Cache-Control':'no-cache'},signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])});
  if((!response.ok && response.status!==403) || !response.headers.get('content-type')?.includes('application/json'))throw Error();
  const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let size=0;
  while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>65536){await reader.cancel();throw Error();}chunks.push(item.value);}
  return z.object({status:z.number().int(),message:z.string().max(2000)}).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
 }catch{throw new WordpressError('WordPress-Antwort nicht eindeutig verfügbar. Der Import kann auf dem VPS weiterhin laufen.');}
}
type Dependencies={urls?:ImportUrls;request?:typeof cronRequest;pause?:(ms:number,signal:AbortSignal)=>Promise<void>;now?:()=>number;intervalMs?:number;maxSteps?:number};
export class WordpressImports{
 private states:ImportState[]=[{id:5,status:'idle',message:'Noch kein Import über diese Anwendung gestartet.'},{id:6,status:'idle',message:'Noch kein Import über diese Anwendung gestartet.'}];
 private queue:Promise<void>=Promise.resolve();
 private jobs=new Map<ImportId,Promise<void>>();
 private signals=new Map<ImportId,AbortController>();
 private storageError=false;
 private configuring=false;
 private urls:ImportUrls={...emptyImportUrls};
 private constructor(private file:string,private config:WordpressConfig|undefined,private deps:Dependencies){}
 static async load(config?:WordpressConfig,file=resolve('var/wordpress-imports.json'),deps:Dependencies={}):Promise<WordpressImports>{
  const service=new WordpressImports(resolve(file),config,deps);service.urls=structuredClone(deps.urls??emptyImportUrls);
  try{const saved=z.array(stateSchema).length(2).parse(JSON.parse(await readFile(file,'utf8')));if(new Set(saved.map(s=>s.id)).size!==2)throw Error();service.states=saved;}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new WordpressError('WordPress-Importstatus konnte nicht gelesen werden. Prüfe var/wordpress-imports.json.');}
  let interrupted=false;
  for(const state of service.states)if(state.status==='running'){state.status='unknown';state.message='Anwendung wurde während des Imports beendet. Abschluss unklar; nur Verarbeitung fortsetzen, nicht erneut starten.';interrupted=true;}
  if(interrupted)await service.persist();
  return service;
 }
 private configFor(id:ImportId):WordpressConfig|undefined{
  const triggerUrl=id===5?this.urls.contactsTriggerUrl:this.urls.offersTriggerUrl,processingUrl=id===5?this.urls.contactsProcessingUrl:this.urls.offersProcessingUrl;
  if(triggerUrl&&processingUrl){const parts=urlParts(processingUrl,'processing');return {endpoint:parts.url.origin+parts.url.pathname,key:parts.key,importId:parts.importId,triggerUrl,processingUrl};}
  return this.config;
 }
 async configure(urls:ImportUrls,commit:()=>Promise<unknown>):Promise<void>{
  if(!wordpressUrlsSchema.safeParse(urls).success)throw new WordpressUrlError('Ungültige Import-URL-Paare. Alte Werte bleiben aktiv.',[...wordpressUrlKeys]);
  const changed=wordpressUrlKeys.filter(key=>urls[key]!==this.urls[key]);
  if(!changed.length){await commit();return;}
  if(this.configuring||this.states.some(state=>state.status==='running'||state.status==='unknown'))throw new WordpressUrlError('Import-URLs können bei laufendem oder unklarem Import nicht geändert werden.',changed);
  this.configuring=true;
  try{
   for(const [id,triggerKey,processingKey] of [[5,'contactsTriggerUrl','contactsProcessingUrl'],[6,'offersTriggerUrl','offersProcessingUrl']] as const){
    if(!changed.some(key=>key===triggerKey||key===processingKey))continue;
    if(!urls[processingKey])throw new WordpressUrlError('Geänderte Import-URLs müssen als vollständiges, geprüftes URL-Paar vorliegen. Alte URLs bleiben aktiv.',[triggerKey,processingKey]);
    const parts=urlParts(urls[processingKey],'processing');
    const config={endpoint:parts.url.origin+parts.url.pathname,key:parts.key,importId:parts.importId,triggerUrl:urls[triggerKey],processingUrl:urls[processingKey]};
    let reply:CronReply;
    try{reply=await (this.deps.request??cronRequest)(config,id,'processing',AbortSignal.timeout(60000));}
    catch{throw new WordpressUrlError('URL-Prüfung fehlgeschlagen. Erwartet wird die WP-All-Import-Antwort für einen nicht gestarteten Import. Alte URLs bleiben aktiv.',[triggerKey,processingKey]);}
    if(reply.status!==403||reply.message!==`Import #${parts.importId} is not triggered. Request skipped.`)throw new WordpressUrlError('Keine passende WP-All-Import-Bereitschaftsantwort erhalten. Der Import muss für diese Prüfung inaktiv sein. Alte URLs bleiben aktiv.',[triggerKey,processingKey]);
   }
   await commit();this.urls=structuredClone(urls);
  }finally{this.configuring=false;}
 }
 snapshot(){return {available:{5:Boolean(this.configFor(5)),6:Boolean(this.configFor(6))},configured:Boolean(this.configFor(5)||this.configFor(6)),storageError:this.storageError,imports:structuredClone(this.states).map(state=>({...state,remoteId:this.configFor(state.id)?.importId??state.id}))};}
 private timestamp(){return new Date((this.deps.now??Date.now)()).toISOString();}
 private persist():Promise<void>{
  const payload=JSON.stringify(this.states,null,2)+'\n';
  const task=this.queue.then(async()=>{const temp=this.file+'.'+randomUUID()+'.tmp';try{await mkdir(dirname(this.file),{recursive:true});await writeFile(temp,payload,{flag:'wx',mode:0o600});await rename(temp,this.file);}catch{this.storageError=true;throw new WordpressError('Importstatus konnte nicht gespeichert werden. Ein erneuter Start bleibt gesperrt.');}finally{await unlink(temp).catch(()=>{});}});
  this.queue=task.catch(()=>{});return task;
 }
 async start(id:ImportId,resume=false):Promise<void>{
  if(this.configuring)throw new WordpressError('Import-URLs werden gerade geprüft. Bitte danach erneut starten.');
  const config=this.configFor(id);
  if(!config)throw new WordpressError('WordPress-Import ist nicht eingerichtet. Setze WP_IMPORT_KEY auf dem Anwendungsserver.');
  if(this.storageError)throw new WordpressError('Importstatus kann nicht sicher gespeichert werden. Prüfe die Schreibrechte und starte die Anwendung neu.');
  const state=this.states.find(s=>s.id===id)!;
  if(this.jobs.has(id)||state.status==='running')throw new WordpressError('Dieser Import läuft bereits.');
  if(resume ? state.status!=='unknown' : state.status==='unknown')throw new WordpressError('Abschluss unklar. Nur Verarbeitung fortsetzen, keinen neuen Import auslösen.');
  const previous=structuredClone(state);state.status='running';state.message=resume?'Verarbeitung wird erneut geprüft.':'Import wird gestartet.';
  if(!resume || !state.startedAt){state.startedAt=this.timestamp();delete state.finishedAt;}
  // Vor jeder entfernten Aktion den reservierten Lauf dauerhaft speichern.
  try{await this.persist();}catch(error){Object.assign(state,previous);state.status='unknown';throw error;}
  const controller=new AbortController();this.signals.set(id,controller);
  const job=this.run(state,resume,controller.signal,config).finally(()=>{this.jobs.delete(id);this.signals.delete(id);});this.jobs.set(id,job);
 }
 private async run(state:ImportState,resume:boolean,signal:AbortSignal,config:WordpressConfig):Promise<void>{
  const request=this.deps.request??cronRequest;
  const pause=this.deps.pause??(async(ms,abort)=>{await delay(ms,undefined,{signal:abort});});
  try{
   if(!resume){const reply=await request(config,state.id,'trigger',signal);if(classifyReply(reply,config.importId??state.id,'trigger')!=='triggered')throw new WordpressError('Start nicht eindeutig bestätigt. Der Import könnte bereits laufen.');}
   for(let step=0;step<(this.deps.maxSteps??60);step++){
    if(signal.aborted)throw new WordpressError('Überwachung unterbrochen.');
    state.message='Import läuft auf WordPress; Verarbeitung wird fortgesetzt.';await this.persist();
    const result=classifyReply(await request(config,state.id,'processing',signal),config.importId??state.id,'processing');
    if(result==='complete'||result==='canceled'){
     state.status=result==='complete'?'success':'failed';state.finishedAt=this.timestamp();
     state.message=result==='complete'?'Import von WordPress ausdrücklich als abgeschlossen bestätigt.':'Import wurde abgebrochen.';
     state.lastCompleted={startedAt:state.startedAt!,finishedAt:state.finishedAt,successful:result==='complete'};await this.persist();return;
    }
    if(result!=='progress'&&result!=='busy')throw new WordpressError('Kein eindeutiger Abschlussnachweis. Bitte Verarbeitung erneut prüfen oder den Status in WordPress kontrollieren.');
    await pause(this.deps.intervalMs??120000,signal);
   }
   throw new WordpressError('Maximale Überwachungsdauer erreicht. Abschluss unklar; der Import kann auf dem VPS weiterlaufen.');
  }catch(error){state.status='unknown';state.message=error instanceof WordpressError?error.message:'WordPress-Verarbeitung konnte nicht sicher bestätigt werden.';try{await this.persist();}catch{this.storageError=true;state.message='Importstatus konnte nicht dauerhaft gespeichert werden. Abschluss unklar.';}}
 }
 async wait(id:ImportId){await this.jobs.get(id);}
 async stop(){for(const controller of this.signals.values())controller.abort();await Promise.all(this.jobs.values());}
}
