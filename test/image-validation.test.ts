import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { prepareLocalImages } from '../src/export/local-images.js';
import { uploadAllowed } from '../src/export/image-validation.js';
import { buildDataPreview } from '../src/export/data-preview.js';

test('Personen- und Gruppenbilder werden lokal aufbereitet, dedupliziert und in beiden JSON-Dateien umgeschrieben',async()=>{
 const png=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer();
 const preview=buildDataPreview({groups:[],persons:[],masterData:{groupCategories:[],targetGroups:[]}}, {groups:[],persons:[],warnings:[]},new Date().toISOString());
 preview.technicalPersons=[{id:20,firstName:'Test',lastName:'Person',email:'',imageUrl:'https://ct.example/image',responsibilities:'',sortOrder:1,groups:[]}];
 preview.technicalGroups=[{id:10,name:'Group',categories:[],targetGroups:[],ageCategory:'',recurrenceDescription:'',contactPersonIds:[20],showOnLandingPage:false,startDate:'',endDate:'',weekday:'',startTime:'',note:'',imageUrl:'https://ct.example/image'}];
 let calls=0;
 const files=await prepareLocalImages(preview,'a'.repeat(64),'https://export.example',async(urls)=>{calls++;assert.deepEqual(urls,['https://ct.example/image']);return new Map([[urls[0]!,{body:png}]]);});
 assert.equal(calls,1);assert.equal(files.length,1);assert.match(files[0]!.name,/^[a-f0-9]{64}\.png$/);
 assert.equal(preview.technicalPersons[0]!.imageUrl,preview.technicalGroups[0]!.imageUrl);assert.match(preview.technicalPersons[0]!.imageUrl,/^https:\/\/export.example\/media\/[a-f0-9]{64}\//);
 assert.equal(uploadAllowed(preview),true);
 preview.technicalGroups[0]!.imageUrl='https://ct.example/broken';
 await prepareLocalImages(preview,'b'.repeat(64),'https://export.example',async()=>new Map());
 assert.equal(uploadAllowed(preview),false);assert.ok(preview.imageValidation!.errors.some(error=>error.groupId===10));
 assert.equal(preview.technicalGroups[0]!.imageUrl,'');
});


function personPreview() {
 const preview=buildDataPreview({groups:[],persons:[],masterData:{groupCategories:[],targetGroups:[]}}, {groups:[],persons:[],warnings:[]},new Date().toISOString());
 preview.technicalPersons=[{id:20,firstName:'Test',lastName:'Person',email:'',imageUrl:'https://ct.example/image',responsibilities:'',sortOrder:1,groups:[]}];
 return preview;
}
test('Großes Hochformat wird ohne Beschnitt proportional verkleinert; Gruppenvariante desselben Bildes bleibt groß',async()=>{
 const bottom=await sharp({create:{width:1439,height:1080,channels:3,background:'blue'}}).png().toBuffer();
 const input=await sharp({create:{width:1439,height:2160,channels:3,background:'red'}}).composite([{input:bottom,top:1080,left:0}]).png().toBuffer();
 const preview=personPreview();preview.technicalGroups=[{id:10,name:'G',categories:[],targetGroups:[],ageCategory:'',recurrenceDescription:'',contactPersonIds:[20],showOnLandingPage:false,startDate:'',endDate:'',weekday:'',startTime:'',note:'',imageUrl:'https://ct.example/image'}];
 const files=await prepareLocalImages(preview,'a'.repeat(64),'https://exports.example',async()=>new Map([['https://ct.example/image',{body:input}]]));
 const person=files.find(file=>preview.technicalPersons[0]!.imageUrl.endsWith(file.name))!;
 const group=files.find(file=>preview.technicalGroups[0]!.imageUrl.endsWith(file.name))!;
 assert.notEqual(person.name,group.name);
 const meta=await sharp(person.body).metadata();assert.equal(meta.width,640);assert.equal(meta.height,960);assert.equal(meta.format,'png');
 const groupMeta=await sharp(group.body).metadata();assert.equal(groupMeta.width,1439);assert.equal(groupMeta.height,2160);
 const {data,info}=await sharp(person.body).removeAlpha().raw().toBuffer({resolveWithObject:true});
 assert.deepEqual([...data.subarray(0,3)],[255,0,0]);
 const end=(info.width*info.height-1)*info.channels;assert.deepEqual([...data.subarray(end,end+3)],[0,0,255]);
 assert.ok(person.body.length < group.body.length);
});
test('Kleine Bilder werden nicht vergrößert und PNG-Pixel einschließlich Transparenz bleiben erhalten',async()=>{
 const raw=Buffer.from([255,0,0,255,0,255,0,128,0,0,255,0,80,90,100,255]);
 const input=await sharp(raw,{raw:{width:2,height:2,channels:4}}).png().toBuffer();
 const preview=personPreview();const files=await prepareLocalImages(preview,'a'.repeat(64),'https://exports.example',async()=>new Map([['https://ct.example/image',{body:input}]]));
 const meta=await sharp(files[0]!.body).metadata();assert.equal(meta.width,2);assert.equal(meta.height,2);assert.equal(meta.hasAlpha,true);
 assert.deepEqual(await sharp(files[0]!.body).raw().toBuffer(),raw);
});
test('EXIF-Ausrichtung wird vor dem Speichern angewendet',async()=>{
 const input=await sharp({create:{width:64,height:96,channels:3,background:'red'}}).jpeg({quality:100}).withMetadata({orientation:6}).toBuffer();
 const preview=personPreview();const files=await prepareLocalImages(preview,'a'.repeat(64),'https://exports.example',async()=>new Map([['https://ct.example/image',{body:input}]]));
 const meta=await sharp(files[0]!.body).metadata();assert.equal(meta.width,96);assert.equal(meta.height,64);assert.equal(meta.orientation,undefined);
});
