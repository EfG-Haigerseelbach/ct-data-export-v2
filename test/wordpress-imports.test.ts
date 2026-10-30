import { emptyImportUrls, wordpressUrlsSchema } from '../src/wordpress/urls.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WordpressImports, WordpressError, classifyReply, readWordpressConfig, cronRequest } from '../src/wordpress/imports.js';
const config={endpoint:'https://wordpress.example/wp-load.php',key:'synthetic-private-key'};

test('WordPress-Umgebung verlangt bei gesetztem Key einen expliziten nicht leeren Endpoint',()=>{
 for(const env of [{WP_IMPORT_KEY:config.key},{WP_IMPORT_KEY:config.key,WP_IMPORT_ENDPOINT:''},{WP_IMPORT_KEY:config.key,WP_IMPORT_ENDPOINT:'   '}]) {
  assert.throws(()=>readWordpressConfig(env),(error:unknown)=>{
   assert.ok(error instanceof WordpressError);
   assert.match(error.message,/WP_IMPORT_ENDPOINT fehlt oder ist leer/);
   assert.equal(error.message.includes(config.key),false);
   return true;
  });
 }
 assert.equal(readWordpressConfig({WP_IMPORT_KEY:' ',WP_IMPORT_ENDPOINT:''}),undefined);
 assert.equal(readWordpressConfig({WP_IMPORT_ENDPOINT:config.endpoint}),undefined);
 assert.deepEqual(readWordpressConfig({WP_IMPORT_KEY:' '+config.key+' ',WP_IMPORT_ENDPOINT:' '+config.endpoint+' '}),config);
});
test('Abschlussparser unterscheidet echte ID, JSON-Fehlerstatus, Fortschritt und fehlenden Trigger',()=>{
 assert.equal(classifyReply({status:200,message:'Import #5 complete'},5,'processing'),'complete');
 assert.equal(classifyReply({status:200,message:'Import #6 complete'},5,'processing'),'unknown');
 assert.equal(classifyReply({status:403,message:'Import #5 is not triggered. Request skipped.'},5,'processing'),'unknown');
 assert.equal(classifyReply({status:200,message:'Records Processed 20. Records Count 30.'},5,'processing'),'progress');
 assert.equal(readWordpressConfig({}),undefined);
 assert.throws(()=>readWordpressConfig({WP_IMPORT_KEY:'secret',WP_IMPORT_ENDPOINT:'http://wordpress.example/wp-load.php'}));
});
test('Getrennte Importe starten einmal, sperren Doppelklicks und speichern Zeitpunkt/Ergebnis dauerhaft',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wp-import-'));const file=join(dir,'state.json');
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});const calls:string[]=[];let steps=0;
 const service=await WordpressImports.load(config,file,{pause:async()=>{},request:async(_config,id,action)=>{
  calls.push(id+':'+action);
  if(action==='trigger')return {status:200,message:'#'+id+' Cron job triggered.'};
  if(id===5 && steps++===0){await pending;return {status:200,message:'Records Processed 1. Records Count 2.'};}
  return {status:200,message:'Import #'+id+' complete'};
 }});
 try{
  await service.start(5);await assert.rejects(service.start(5),/läuft bereits/);
  assert.equal(service.snapshot().imports.find(s=>s.id===5)!.status,'running');
  await service.start(6);await service.wait(6);assert.equal(service.snapshot().imports.find(s=>s.id===6)!.status,'success');
  release();await service.wait(5);assert.equal(calls.filter(c=>c==='5:trigger').length,1);
  const stored=await WordpressImports.load(config,file);for(const state of stored.snapshot().imports){assert.equal(state.status,'success');assert.ok(state.startedAt);assert.ok(state.lastCompleted?.successful);assert.ok(state.lastCompleted?.finishedAt);}
  assert.equal((await readFile(file,'utf8')).includes(config.key),false);
 }finally{release();await service.stop();await unlink(file).catch(()=>{});await rmdir(dir);}
});
test('Unklare Antwort und Neustart geben keine falsche Freigabe; Wiederaufnahme sendet keinen Trigger',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wp-unknown-'));const file=join(dir,'state.json');let phase=0;const calls:string[]=[];
 const service=await WordpressImports.load(config,file,{request:async(_config,id,action)=>{calls.push(action);if(phase===0)throw Error('private-secret');return {status:200,message:'Import #'+id+' complete'};}});
 try{
  await service.start(5);await service.wait(5);assert.equal(service.snapshot().imports[0]!.status,'unknown');await assert.rejects(service.start(5),/Abschluss unklar/);
  phase=1;await service.start(5,true);await service.wait(5);assert.deepEqual(calls,['trigger','processing']);assert.equal(service.snapshot().imports[0]!.status,'success');
  const raw=JSON.parse(await readFile(file,'utf8'));raw[1].status='running';raw[1].startedAt=new Date().toISOString();await writeFile(file,JSON.stringify(raw));
  const restarted=await WordpressImports.load(config,file);assert.equal(restarted.snapshot().imports[1]!.status,'unknown');await assert.rejects(restarted.start(6),/Abschluss unklar/);
 }finally{await service.stop();await unlink(file).catch(()=>{});await rmdir(dir);}
});


test('Import-URL-Paare müssen action, ID, Schlüssel und Endpunkt konsistent enthalten',()=>{
 const trigger='https://wp.example/wp-load.php?import_key=secret&import_id=17&action=trigger';
 const processing=trigger.replace('trigger','processing');
 assert.equal(wordpressUrlsSchema.safeParse({...emptyImportUrls,contactsTriggerUrl:trigger,contactsProcessingUrl:processing}).success,true);
 for(const broken of [processing.replace('17','18'),processing.replace('secret','other'),processing.replace('https:','http:'),processing+'&action=processing']) assert.equal(wordpressUrlsSchema.safeParse({...emptyImportUrls,contactsTriggerUrl:trigger,contactsProcessingUrl:broken}).success,false);
});
test('Nur eindeutige not-triggered-Antwort übernimmt URL-Paar; nächste Verarbeitung verwendet neue Ziel-ID',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wp-url-'));const file=join(dir,'state.json');const calls:{id:number;action:string;endpoint:string}[]=[];let phase='probe',commits=0;
 const service=await WordpressImports.load(undefined,file,{request:async(c,id,action)=>{calls.push({id:c.importId??id,action,endpoint:c.processingUrl??c.endpoint});return phase==='probe'?{status:403,message:'Import #17 is not triggered. Request skipped.'}:action==='trigger'?{status:200,message:'#17 Cron job triggered.'}:{status:200,message:'Import #17 complete'};}});
 try{
  const urls={...emptyImportUrls,contactsTriggerUrl:'https://wp.example/wp-load.php?import_key=secret&import_id=17&action=trigger',contactsProcessingUrl:'https://wp.example/wp-load.php?import_key=secret&import_id=17&action=processing'};
  await service.configure(urls,async()=>{commits++;});assert.equal(commits,1);assert.equal(service.snapshot().available[5],true);assert.equal(service.snapshot().available[6],false);assert.equal(calls[0]!.action,'processing');
  phase='run';await service.start(5);await service.wait(5);assert.equal(service.snapshot().imports[0]!.status,'success');assert.deepEqual(calls.map(c=>[c.id,c.action]),[[17,'processing'],[17,'trigger'],[17,'processing']]);
 }finally{await service.stop();await unlink(file).catch(()=>{});await rmdir(dir);}
});
test('Falsche Probeantwort speichert nichts und lässt bisherige Zielkonfiguration aktiv',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wp-invalid-url-'));const file=join(dir,'state.json');let committed=false;
 const service=await WordpressImports.load(config,file,{request:async()=>({status:200,message:'Import #5 complete'})});
 try{
  const urls={...emptyImportUrls,contactsTriggerUrl:'https://other.example/wp-load.php?import_key=secret&import_id=5&action=trigger',contactsProcessingUrl:'https://other.example/wp-load.php?import_key=secret&import_id=5&action=processing'};
  await assert.rejects(service.configure(urls,async()=>{committed=true;}),/Bereitschaftsantwort/);assert.equal(committed,false);assert.equal(service.snapshot().available[6],true);
 }finally{await service.stop();await unlink(file).catch(()=>{});await rmdir(dir);}
});


test('Bereitschaftsprobe liest JSON-status 403 sowohl unter HTTP 200 als auch HTTP 403',async()=>{
 for(const httpStatus of [200,403]){
  const transport:typeof fetch=async(input,options)=>{
   const url=new URL(String(input));assert.equal(url.searchParams.get('action'),'processing');assert.equal(options?.redirect,'error');assert.equal(options?.credentials,'omit');
   return new Response(JSON.stringify({status:403,message:'Import #5 is not triggered. Request skipped.'}),{status:httpStatus,headers:{'Content-Type':'application/json'}});
  };
  const result=await cronRequest(config,5,'processing',AbortSignal.timeout(1000),transport);assert.equal(result.status,403);
 }
});
