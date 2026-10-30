import { dataHashes } from '../src/export/image-validation.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, unlink, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonArchive } from '../src/export/json-archive.js';
import { buildDataPreview } from '../src/export/data-preview.js';
import { archivePage, dataPage } from '../src/web/views.js';
test('JSON-Dateipaar folgt Berliner Dateinamensformat, bleibt nach Neustart lesbar und kollidiert nicht',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ct-archive-'));
 try {
  const archive=await JsonArchive.load(dir);
  const preview=buildDataPreview({groups:[],persons:[],masterData:{groupCategories:[],targetGroups:[]}}, {groups:[],persons:[],warnings:[]}, '2026-10-27T10:15:30Z');
  preview.imageValidation={checkedAt:new Date().toISOString(),uploadAllowed:false,...dataHashes(preview),errors:[{personId:73,code:'HTTP',httpStatus:403}]};
  const first=await archive.save(preview,{startedAt:'2026-10-27T10:15:30Z',source:'manual',status:'loading'},'a'.repeat(64),undefined,()=>12345);
  const second=await archive.save(preview,{startedAt:'2026-10-27T10:15:30Z',source:'startup',status:'loading'},'a'.repeat(64));
  assert.equal(first.groupsFile,'2026.10.27_111530_groups.json');
  assert.equal(first.personsFile,'2026.10.27_111530_contactPersons.json');
  const manifest=JSON.parse(await readFile(join(dir,first.archiveId!,'manifest.json'),'utf8'));
  assert.equal(manifest.durationMs,12345);
  assert.equal(manifest.uploadAllowed,false);assert.equal(manifest.files.groups.uploadAllowed,false);assert.equal(manifest.files.contactPersons.uploadAllowed,false);
  assert.deepEqual(manifest.imageValidation.errors,[{personId:73,code:'HTTP',httpStatus:403}]);
  assert.notEqual(first.archiveId,second.archiveId);
  assert.deepEqual(JSON.parse(await readFile(join(dir,first.archiveId!,first.groupsFile!),'utf8')),[]);
  const fileSizes=await Promise.all((await readdir(join(dir,first.archiveId!))).map(async(name)=>(await stat(join(dir,first.archiveId!,name))).size));
  const total=fileSizes.reduce((sum,size)=>sum+size,0);assert.equal(first.totalBytes,total);
  const loaded=await JsonArchive.load(dir);assert.equal(loaded.entries.length,2);
  assert.equal(loaded.entries.find(entry=>entry.archiveId===first.archiveId)!.durationMs,12345);
  assert.equal(loaded.entries.find(entry=>entry.archiveId===second.archiveId)!.durationMs,undefined);
  const historyHtml=dataPage(undefined,false,0,'',undefined,undefined,loaded.entries);
  assert.match(historyHtml,/<th>Dauer<\/th>/);
  assert.match(historyHtml,/12,3 s/);
  assert.match(historyHtml,/>-<\/td>/);
  assert.equal(loaded.entries.find(entry=>entry.archiveId===first.archiveId)!.totalBytes,total);
  assert.equal((await loaded.read(first.archiveId!,'contactPersons')).json,'[]');
  await assert.rejects(loaded.read('../secret','groups'));
  assert.match(dataPage(undefined,false,0,'',undefined,undefined,loaded.entries),/\/data\/archive\//);
  assert.equal(archivePage('test.json','["<script>attack()</script>"]','csrf','admin').includes('<script>attack()'),false);
 }finally{
  for(const folder of await readdir(dir)){for(const file of await readdir(join(dir,folder)))await unlink(join(dir,folder,file));await rmdir(join(dir,folder));}await rmdir(dir);
 }
});
