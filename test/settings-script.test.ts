import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { settingsScript } from '../src/web/settings-script.js';
class Element {
 textContent = ''; className = ''; disabled = false; hidden = false; readOnly = false; value = 'a'.repeat(64); name = 'sortOrder';
 dataset = { savedValue: 'a'.repeat(64) };
 attributes = new Map<string,string>();
 setAttribute(key:string,value:string){this.attributes.set(key,value);}
 removeAttribute(key:string){this.attributes.delete(key);}
}
function browser(fetcher: () => Promise<unknown>) {
 const button=new Element(), input=new Element(), revision=new Element(), output=new Element(), toast=new Element(), preview=new Element();
 button.textContent='Speichern und verwenden';
 let submit!: (e:{preventDefault():void})=>Promise<void>;
 let editListener!: (e:{preventDefault():void})=>Promise<void>;
 const form={action:'/settings',querySelector:(s:string)=>s==='button'?button:revision,querySelectorAll:()=>[input],setAttribute:()=>{},addEventListener:(event:string,fn:typeof submit)=>{if(event==='submit')submit=fn;else editListener=fn;}};
 runInNewContext(settingsScript,{document:{getElementById:(id:string)=>({'settings-form':form,'settings-save-result':output,'settings-toast':toast,'selection-result':preview}[id])},
 FormData:class{*[Symbol.iterator](){yield ['csrf','test'];}},URLSearchParams,AbortSignal,fetch:fetcher,clearTimeout:()=>{},setTimeout:()=>1});
 return {button,input,revision,output,toast,preview,edit:(value:string)=>{input.value=value;void editListener({preventDefault(){}});},submit:()=>submit({preventDefault(){}})};
}
const response=(payload:unknown,ok=true)=>({ok,headers:{get:()=> 'application/json'},json:async()=>payload});
test('Speichern sperrt Doppelklicks und zeigt Ladeicon, Erfolgstoast und neue Revision ohne Navigation',async()=>{
 let done!:(value:unknown)=>void,calls=0;
 const b=browser(()=>{calls++;return new Promise((resolve)=>{done=resolve;});});
 assert.equal(b.button.disabled,true);
 b.edit('changed');assert.equal(b.button.disabled,false);
 b.edit('a'.repeat(64));assert.equal(b.button.disabled,true);
 b.edit('changed');
 const pending=b.submit();
 assert.equal(b.button.disabled,true); assert.match(b.button.textContent,/⏳/); assert.equal(b.input.readOnly,true);
 await b.submit();assert.equal(calls,1);
 done(response({status:'saved',message:'Konfiguration OK.',revision:'b'.repeat(64)}));await pending;
 assert.equal(b.button.disabled,true);assert.equal(b.button.textContent,'Speichern und verwenden');
 assert.equal(b.input.readOnly,false);assert.equal(b.toast.hidden,false);assert.match(b.toast.textContent,/Konfiguration OK/);
 assert.equal(b.revision.value,'b'.repeat(64));assert.match(b.preview.textContent,/erneut prüfen/);
});
test('Feldfehler markieren das betroffene Eingabefeld; Netzwerkfehler geben Button frei',async()=>{
 const b=browser(async()=>response({status:'error',message:'Attribut fehlt',fields:['sortOrder']},false));
 b.edit('changed');await b.submit();assert.equal(b.input.attributes.get('aria-invalid'),'true');assert.equal(b.button.disabled,false);assert.match(b.output.textContent,/Attribut fehlt/);
 const offline=browser(async()=>{throw Error('secret');});offline.edit('changed');await offline.submit();assert.equal(offline.button.disabled,false);assert.equal(offline.output.textContent.includes('secret'),false);
});


test('Abgelehnte Import-URL wird asynchron auf den gespeicherten Wert zurückgesetzt',async()=>{
 const original='a'.repeat(64);
 const b=browser(async()=>response({status:'error',message:'URL-Prüfung fehlgeschlagen',fields:['contactsProcessingUrl'],resetValues:{contactsProcessingUrl:original}},false));
 b.input.name='contactsProcessingUrl';b.edit('https://bad.example/wp-load.php');await b.submit();
 assert.equal(b.input.value,original);assert.equal(b.button.disabled,true);assert.equal(b.input.attributes.get('aria-invalid'),'true');
});
