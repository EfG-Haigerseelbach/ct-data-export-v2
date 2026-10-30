import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { dataLinksScript } from '../src/web/data-links-script.js';
test('ID-Navigation öffnet Ziele, fokussiert sie und funktioniert erneut nach Zuklappen',()=>{
 let click!:(event:unknown)=>void,hashchange!:()=>void;
 let focused=0,scrolled=0;
 const target={tagName:'DETAILS',open:false,querySelector:()=>({focus:()=>{focused++;}}),scrollIntoView:()=>{scrolled++;}};
 const window={location:{hash:'#person-20'},addEventListener:(_event:string,fn:()=>void)=>{hashchange=fn;}};
 runInNewContext(dataLinksScript,{document:{getElementById:(id:string)=>id==='person-20'||id==='group-10'?target:null,addEventListener:(_event:string,fn:typeof click)=>{click=fn;}},window});
 assert.equal(target.open,true);target.open=false;
 const link={getAttribute:()=> '#group-10'};
 click({button:0,target:{closest:()=>link}});assert.equal(target.open,true);
 target.open=false;click({button:0,target:{closest:()=>link}});assert.equal(target.open,true);
 target.open=false;window.location.hash='#person-20';hashchange();assert.equal(target.open,true);
 assert.equal(focused,4);assert.equal(scrolled,4);
 target.open=false;window.location.hash='#technical-json';hashchange();assert.equal(target.open,false);
});
