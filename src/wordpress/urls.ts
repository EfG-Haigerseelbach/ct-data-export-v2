import { z } from 'zod';
export const wordpressUrlKeys=['contactsTriggerUrl','contactsProcessingUrl','offersTriggerUrl','offersProcessingUrl'] as const;
export type WordpressUrlKey=typeof wordpressUrlKeys[number];
export type ImportUrls=Record<WordpressUrlKey,string>;
export const emptyImportUrls:ImportUrls={contactsTriggerUrl:'',contactsProcessingUrl:'',offersTriggerUrl:'',offersProcessingUrl:''};
export function urlParts(value:string,action:'trigger'|'processing'){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('url');
 for(const key of ['action','import_id','import_key'])if(url.searchParams.getAll(key).length!==1)throw Error('parameters');
 if(url.searchParams.get('action')!==action || !/^[1-9]\d*$/.test(url.searchParams.get('import_id')??'') || !Number.isSafeInteger(Number(url.searchParams.get('import_id'))) || !url.searchParams.get('import_key')?.trim())throw Error('parameters');
 return {url,importId:Number(url.searchParams.get('import_id')),key:url.searchParams.get('import_key')!};
}
const field=(action:'trigger'|'processing')=>z.string().trim().max(4096).refine(value=>{if(value==='')return true;try{urlParts(value,action);return true;}catch{return false;}});
export const wordpressUrlsSchema=z.strictObject({contactsTriggerUrl:field('trigger'),contactsProcessingUrl:field('processing'),offersTriggerUrl:field('trigger'),offersProcessingUrl:field('processing')}).superRefine((urls,ctx)=>{
 for(const [trigger,processing] of [['contactsTriggerUrl','contactsProcessingUrl'],['offersTriggerUrl','offersProcessingUrl']] as const){
  if(!urls[trigger]&&!urls[processing])continue;
  try{const a=urlParts(urls[trigger],'trigger'),b=urlParts(urls[processing],'processing');
   if(a.importId!==b.importId||a.key!==b.key||a.url.origin!==b.url.origin||a.url.pathname!==b.url.pathname)throw Error();
  }catch{for(const key of [trigger,processing])ctx.addIssue({code:'custom',path:[key],message:'Zusammengehörige HTTPS-URLs mit gleichem Import, Schlüssel und Endpunkt erforderlich.'});}
 }
});
