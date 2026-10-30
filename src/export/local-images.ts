import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type { DataPreview } from './data-preview.js';
import { dataHashes } from './image-validation.js';
import type { ImageFailure } from './image-validation.js';
export type ImageDownloader = (urls:string[])=>Promise<Map<string,{body?:Buffer;error?:string}>>;
export const PERSON_IMAGE_MAX_EDGE = 960;
export type LocalMedia = { name:string; body:Buffer };
export async function prepareLocalImages(data:DataPreview, id:string, publicBaseUrl:string, download:ImageDownloader, personMaxEdge = PERSON_IMAGE_MAX_EDGE):Promise<LocalMedia[]> {
 const errors:ImageFailure[]=[], media=new Map<string,LocalMedia>();
 const records=[...data.technicalPersons.map(person=>({record:person,personId:person.id})),...data.technicalGroups.map(group=>({record:group,groupId:group.id}))];
 const urls=records.map(item=>item.record.imageUrl).filter(Boolean);
 let results:Awaited<ReturnType<ImageDownloader>>;
 try{results=await download([...new Set(urls)]);}catch{results=new Map();}
 const decoded=new Map<string,{name:string;body:Buffer}|{error:string}>();
 for(const item of records){
  const original=item.record.imageUrl;
  let error:string|undefined;
  if(!original.trim())error='MISSING_URL';
  else {
   const variant = ('personId' in item ? 'person:' : 'group:') + original;
   let result=decoded.get(variant);
   if(!result){
    const response=results.get(original);
    if(!response?.body)result={error:response?.error ?? 'DOWNLOAD'};
    else try {
     if(response.body.length>10*1024*1024)throw Error('size');
     const decoder=sharp(response.body,{limitInputPixels:20_000_000,failOn:'warning'});
     const metadata=await decoder.metadata();if(metadata.format==='svg')throw Error('format');
     const pipeline=decoder.autoOrient().withIccProfile('srgb');
     if ('personId' in item && personMaxEdge > 0) pipeline.resize({width:personMaxEdge,height:personMaxEdge,fit:'inside',withoutEnlargement:true,kernel:'lanczos3'});
     // Verlustfreies PNG: keine JPEG-Quantisierung, kein Chroma-Subsampling, Transparenz bleibt erhalten.
     const body=await pipeline.png({compressionLevel:9,adaptiveFiltering:true,palette:false}).toBuffer();if(body.length>25*1024*1024)throw Error('size');
     const name=createHash('sha256').update(body).digest('hex')+'.png';result={name,body};media.set(name,result);
    }catch{result={error:'NOT_IMAGE'};}
    decoded.set(variant,result);
   }
   if('error' in result)error=result.error;
   else item.record.imageUrl=publicBaseUrl.replace(/\/$/,'')+'/media/'+id+'/'+result.name;
  }
  if(error){item.record.imageUrl='';errors.push({...('personId' in item?{personId:item.personId}:{groupId:item.groupId}),code:error});}
 }
 for(const person of data.persons){const source=data.technicalPersons.find(item=>item.id===person.id);if(source)person.fields['Bild-URL']=source.imageUrl;}
 for(const group of data.groups){const source=data.technicalGroups.find(item=>item.id===group.id);if(source)group.fields['Bild-URL']=source.imageUrl;}
 data.imageValidation={mode:'authenticated-local',checkedAt:new Date().toISOString(),uploadAllowed:errors.length===0,...dataHashes(data),errors};
 return [...media.values()];
}
