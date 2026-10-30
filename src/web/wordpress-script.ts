export const wordpressScript=String.raw`'use strict';
(()=>{
 const output=document.getElementById('wordpress-result');if(!output)return;
 const forms=Array.from(document.querySelectorAll('.wordpress-start'));
 const pending=new Set();let polling=false;
 const labels={idle:'Noch nicht gestartet',running:'⏳ Läuft',success:'✅ Abgeschlossen',failed:'❌ Abgebrochen',unknown:'⚠️ Abschluss unklar'};
 const date=value=>value?new Date(value).toLocaleString('de-DE',{timeZone:'Europe/Berlin'}):'Noch nicht durchgeführt';
 function render(snapshot){
  if(!snapshot || !Array.isArray(snapshot.imports))throw Error('response');
  for(const state of snapshot.imports){
   if(![5,6].includes(state.id)||!Object.hasOwn(labels,state.status))throw Error('response');
   const card=document.getElementById('wordpress-import-'+state.id);if(!card)continue;
   const set=(key,value)=>{const element=card.querySelector('[data-field="'+key+'"]');if(element)element.textContent=value;};
   set('status',labels[state.status]);set('startedAt',date(state.startedAt));set('completedAt',date(state.lastCompleted?.finishedAt));
   set('previousResult',state.lastCompleted?(state.lastCompleted.successful?'✅ Erfolgreich abgeschlossen':'❌ Abgebrochen'):'Noch kein bestätigtes Ergebnis');
   set('message',state.message);
   const button=card.querySelector('button'),mode=card.querySelector('input[name="mode"]');
   if(button){button.disabled=!snapshot.configured||!snapshot.available[state.id]||snapshot.storageError||state.status==='running'||pending.has(state.id);button.textContent=state.status==='running'?'⏳ Import läuft …':state.status==='unknown'?'Verarbeitung erneut prüfen':'Import starten';}
   if(mode)mode.value=state.status==='unknown'?'resume':'start';
  }
 }
 async function poll(){
  if(polling||pending.size)return;polling=true;
  try{const response=await fetch('/wordpress-imports/status',{headers:{Accept:'application/json'},credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(10000)});const result=await response.json();if(!response.ok)throw Error('response');render(result.wordpress);}
  catch{output.textContent='Status konnte nicht aktualisiert werden. Laufende Importe nicht erneut starten; gegebenenfalls erneut anmelden.';}
  finally{polling=false;}
 }
 for(const form of forms)form.addEventListener('submit',async(event)=>{
  event.preventDefault();const button=form.querySelector('button');const id=Number(form.querySelector('input[name="importId"]').value);
  if(!button||button.disabled||pending.has(id))return;
  pending.add(id);button.disabled=true;button.textContent='⏳ Wird gestartet …';
  try{const response=await fetch(form.action,{method:'POST',body:new URLSearchParams(new FormData(form)),headers:{Accept:'application/json'},credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(20000)});const result=await response.json();output.textContent=result.message||'Antwort unklar.';pending.delete(id);if(result.wordpress)render(result.wordpress);}
  catch{output.textContent='Startantwort unklar. Der Import könnte bereits laufen; Status wird erneut geprüft.';}
  finally{pending.delete(id);void poll();}
 });
 setInterval(()=>{if(!document.hidden)void poll();},3000);
 void poll();
})();`;
