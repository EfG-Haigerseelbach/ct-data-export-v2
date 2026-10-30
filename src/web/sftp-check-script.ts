export const sftpCheckScript = String.raw`'use strict';
(() => {
 const form=document.getElementById('sftp-check-form'), output=document.getElementById('sftp-check-result'), last=document.getElementById('sftp-last-success');
 if(!form || !output || !last) return;
 const button=form.querySelector('button'); if(!button)return;
 form.addEventListener('submit',async(event)=>{
  event.preventDefault();if(button.disabled)return;
  const label=button.textContent;button.disabled=true;button.textContent='⏳ Verbindung wird geprüft …';output.textContent='Prüfung läuft …';
  try {
   const response=await fetch(form.action,{method:'POST',headers:{Accept:'application/json'},body:new URLSearchParams(new FormData(form)),credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(40000)});
   if(!response.headers.get('content-type')?.includes('application/json'))throw Error('response');
   const result=await response.json();if(typeof result.message!=='string')throw Error('response');
   output.textContent=(response.ok?'✅ ':'❌ ')+result.message;output.className='notice '+(response.ok?'connection-success':'connection-error');
   if(result.lastSuccess)last.textContent=new Date(result.lastSuccess).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})+' (Europe/Berlin)';
  }catch{output.textContent='❌ Die Verbindungsprüfung konnte nicht abgeschlossen werden.';output.className='notice connection-error';}
  finally{button.disabled=false;button.textContent=label;}
 });
})();`;
