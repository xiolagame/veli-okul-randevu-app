import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import http from 'node:http';

if (process.env.DATABASE_URL) throw Error('Synthetic Functions test must not inherit DATABASE_URL');
process.env.NODE_ENV='production';
process.env.JWT_SECRET='synthetic-cors-function-secret-at-least-32-characters';
process.env.CORS_ORIGIN='https://localhost,https://velirandevu.com';
delete process.env.PLATFORM_ADMIN_USER_IDS;
const origin='https://localhost',root=process.cwd(),audit=path.join(root,'.cache/phase2c');
fs.mkdirSync(audit,{recursive:true});
globalThis.__corsState={initCalls:0,routeCalls:0,failDb:false,version:1};
const originalApi=`import serverless from 'serverless-http';import{withLambda}from'@netlify/aws-lambda-compat';import{createExpressApp}from'../../server/app';const serverlessHandler=serverless(createExpressApp());export default withLambda(async(event,context)=>serverlessHandler(event,context));`;
const fixtures={
 db:`export async function initDatabase(){globalThis.__corsState.initCalls++;if(globalThis.__corsState.failDb)throw Error('synthetic database unavailable');}`,
 platform:`export const platformTargetContextGuard=(_req,_res,next)=>next();`,
 repositories:`const teacher={id:'synthetic-teacher',phone:'+905551234567',firstName:'TEST',lastName:'TEACHER',isPhoneVerified:true};export const userRepository={getById:async id=>['synthetic-teacher','synthetic-parent'].includes(id)?{...teacher,id,authVersion:globalThis.__corsState.version}:null};export const membershipRepository={getActiveMembership:async(userId,schoolId)=>schoolId==='school-a'?{id:'membership',userId,schoolId,status:'active',role:userId==='synthetic-teacher'?'teacher':'parent'}:null,getMembershipsByUserId:async()=>[]};export const schoolRepository={getById:async id=>id==='school-a'?{id}:null};export const schoolLicenseRepository={isAccessAllowed:async()=>true};`,
 api:`import{Router}from'express';import{authMiddleware,tenantGuard,createToken}from${JSON.stringify(path.join(root,'server/auth.ts'))};export const apiRouter=Router();globalThis.__corsMint=createToken;apiRouter.use((_req,_res,next)=>{globalThis.__corsState.routeCalls++;next()});apiRouter.get('/fixture-get',(req,res)=>res.json({ok:true,query:req.query}));apiRouter.post('/fixture-post',(req,res)=>res.status(201).json({ok:true,input:req.body}));apiRouter.get('/fixture-error',(_req,res)=>res.status(503).json({error:'Sentetik servis hatası'}));apiRouter.get('/fixture-empty',(_req,res)=>res.status(204).end());apiRouter.get('/protected/:schoolId',authMiddleware,tenantGuard(['teacher']),(req,res)=>res.json({userId:req.user.id,schoolId:req.membership.schoolId,role:req.membership.role}));apiRouter.post('/protected/:schoolId',authMiddleware,tenantGuard(['teacher']),(_req,res)=>res.json({ok:true}));`
};
async function compile(name,baseline=false){
 const outfile=path.join(audit,`cors-${name}.mjs`);
 await build({stdin:{contents:`export{default}from'./netlify/functions/api';export{applyUnauthorizedSessionPolicy}from'./src/platform/api-session-policy';`,resolveDir:root,loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',target:'node24',plugins:[{name:'synthetic-db-and-routes',setup(b){
  b.onResolve({filter:/^\.\/api$/},args=>args.importer.endsWith('/server/app.ts')||args.importer.endsWith('\\server\\app.ts')?{path:'api',namespace:'fixture'}:undefined);
  b.onResolve({filter:/^\.\/database\/postgres$/},()=>({path:'db',namespace:'fixture'}));
  b.onResolve({filter:/^\.\/platform-management$/},()=>({path:'platform',namespace:'fixture'}));
  b.onResolve({filter:/^\.\/repositories$/},()=>({path:'repositories',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path:p})=>({contents:fixtures[p],loader:'ts',resolveDir:root}));
  if(baseline)b.onLoad({filter:/netlify[\\/]functions[\\/]api\.ts$/},()=>({contents:originalApi,loader:'ts',resolveDir:path.join(root,'netlify/functions')}));
 }}]});
 return import(pathToFileURL(outfile).href+'?run='+Date.now());
}
const old=await compile('original',true),current=await compile('current');
const makeRequest=(method='GET',route='/api/fixture-get',headers={},body)=>new Request('https://velirandevu.com'+route,{method,headers:{Origin:origin,...headers},...(body===undefined?{}:{body})});
const invoke=(module,request)=>module.default(request,{requestId:'synthetic-cors-request'});
const preflight=(method='POST',headers='content-type,authorization,x-school-id',requestedOrigin=origin)=>makeRequest('OPTIONS','/api/protected/school-a',{Origin:requestedOrigin,'Access-Control-Request-Method':method,'Access-Control-Request-Headers':headers});
const list=value=>(value||'').toLowerCase().split(',').map(v=>v.trim());
function browserAllows(response,method,headers){return response.status>=200&&response.status<300&&response.headers.get('access-control-allow-origin')===origin&&response.headers.get('access-control-allow-credentials')==='true'&&list(response.headers.get('access-control-allow-methods')).includes(method.toLowerCase())&&headers.every(h=>list(response.headers.get('access-control-allow-headers')).includes(h.toLowerCase()));}
const results=[];
async function scenario(name,run){try{await run();results.push({name,status:'PASS'});console.log('PASS '+name)}catch(error){results.push({name,status:'FAIL',error:error.message});console.error('FAIL '+name+': '+error.message)}}
await scenario('Original production adapter reproduces the 204 constructor exception',async()=>{
 await assert.rejects(()=>invoke(old,preflight()),/Invalid response status code 204/);
});
await scenario('Allowed Android JSON/Bearer/school preflight is bodyless 204 before DB and auth',async()=>{
 globalThis.__corsState.initCalls=0;globalThis.__corsState.routeCalls=0;
 for(const method of ['GET','POST']){const response=await invoke(current,preflight(method));assert.equal(response.status,204);assert.equal(response.body,null);assert.equal(await response.text(),'');assert(browserAllows(response,method,['content-type','authorization','x-school-id']));assert.notEqual(response.headers.get('access-control-allow-origin'),'*');}
 assert.equal(globalThis.__corsState.initCalls,0);assert.equal(globalThis.__corsState.routeCalls,0);
});
await scenario('Disallowed and lookalike origins get no CORS permission and never reach DB/routes',async()=>{
 globalThis.__corsState.initCalls=0;globalThis.__corsState.routeCalls=0;
 for(const requestedOrigin of ['https://untrusted.invalid','https://localhost.attacker.invalid'])for(const method of ['OPTIONS','GET']){const request=method==='OPTIONS'?preflight('POST','content-type',requestedOrigin):makeRequest('GET','/api/fixture-get',{Origin:requestedOrigin});const response=await invoke(current,request);assert.equal(response.status,500);assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal(response.headers.get('access-control-allow-credentials'),null);assert(!(await response.text()).includes('CORS İhlali'));}
 assert.equal(globalThis.__corsState.initCalls,0);assert.equal(globalThis.__corsState.routeCalls,0);
});
await scenario('Invalid requested method/header is denied by the browser allow-list contract',async()=>{
 const badMethod=await invoke(current,preflight('TRACE'));assert.equal(badMethod.status,204);assert(!browserAllows(badMethod,'TRACE',['content-type']));
 const badHeader=await invoke(current,preflight('POST','content-type,x-untrusted'));assert.equal(badHeader.status,204);assert(!browserAllows(badHeader,'POST',['content-type','x-untrusted']));
});
await scenario('GET/POST JSON contracts and headers are identical to the old adapter',async()=>{
 for(const make of [()=>makeRequest('GET','/api/fixture-get?q=synthetic'),()=>makeRequest('POST','/api/fixture-post',{'Content-Type':'application/json'},JSON.stringify({synthetic:true}))]){const a=await invoke(old,make()),b=await invoke(current,make());assert.equal(b.status,a.status);assert.deepEqual(await b.json(),await a.json());for(const header of ['content-type','access-control-allow-origin','access-control-allow-credentials'])assert.equal(b.headers.get(header),a.headers.get(header));}
});
await scenario('Non-OPTIONS 204 also has null body',async()=>{
 const response=await invoke(current,makeRequest('GET','/api/fixture-empty'));assert.equal(response.status,204);assert.equal(response.body,null);assert.equal(await response.text(),'');
});
await scenario('Real JWT, auth_version, role and school guards still reject unauthorized GET/POST',async()=>{
 const teacher=globalThis.__corsMint({userId:'synthetic-teacher',phone:'+905551234567',auth_version:1});const parent=globalThis.__corsMint({userId:'synthetic-parent',phone:'+905551234567',auth_version:1});
 for(const method of ['GET','POST']){const response=await invoke(current,makeRequest(method,'/api/protected/school-a'));assert.equal(response.status,401);assert.equal(response.headers.get('access-control-allow-origin'),origin);assert((await response.json()).error);}
 assert.equal((await invoke(current,makeRequest('GET','/api/protected/school-a',{Authorization:'Bearer invalid'}))).status,401);
 assert.equal((await invoke(current,makeRequest('GET','/api/protected/school-a',{Authorization:'Bearer '+parent}))).status,403);
 assert.equal((await invoke(current,makeRequest('GET','/api/protected/school-b',{Authorization:'Bearer '+teacher}))).status,403);
 assert.equal((await invoke(current,makeRequest('GET','/api/protected/school-a',{Authorization:'Bearer '+teacher,'X-School-Id':'school-b'}))).status,400);
 const allowed=await invoke(current,makeRequest('GET','/api/protected/school-a',{Authorization:'Bearer '+teacher,'X-School-Id':'school-a'}));assert.equal(allowed.status,200);assert.equal((await allowed.json()).role,'teacher');
 globalThis.__corsState.version=2;assert.equal((await invoke(current,makeRequest('GET','/api/protected/school-a',{Authorization:'Bearer '+teacher}))).status,401);globalThis.__corsState.version=1;
});
await scenario('Error responses preserve CORS and client 401 policy does not clear sessions on 403/503/OTP',async()=>{
 const a=await invoke(old,makeRequest('GET','/api/fixture-error')),b=await invoke(current,makeRequest('GET','/api/fixture-error'));assert.equal(b.status,503);assert.equal(b.headers.get('access-control-allow-origin'),origin);assert.deepEqual(await b.json(),await a.json());
 let invalidations=0;const session={invalidateRejectedToken:async()=>invalidations++};
 for(const status of [400,403,429,503])assert.equal(await current.applyUnauthorizedSessionPolicy(status,'/api/protected/school-a','synthetic-token',session),false);
 assert.equal(await current.applyUnauthorizedSessionPolicy(401,'/api/auth/phone/verify-code','synthetic-token',session),false);assert.equal(invalidations,0);
 assert.equal(await current.applyUnauthorizedSessionPolicy(401,'/api/protected/school-a','synthetic-token',session),true);assert.equal(invalidations,1);
});
await scenario('Database-unavailable 503 is sanitized and keeps allowed-origin CORS headers',async()=>{
 globalThis.__corsState.failDb=true;const fresh=await compile('db-failure');const response=await invoke(fresh,makeRequest());assert.equal(response.status,503);assert.equal(response.headers.get('access-control-allow-origin'),origin);assert(!(await response.text()).includes('synthetic database unavailable'));globalThis.__corsState.failDb=false;
});
if(process.argv.includes('--browser')){
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
 let browser,apiModule;const servers=[];
 const start=async handler=>{const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);return 'http://127.0.0.1:'+server.address().port;};
 try{
  const apiOrigin=await start(async(req,res)=>{
   try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);const request=new Request('https://velirandevu.com'+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{} )});const response=await invoke(apiModule,request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}
   catch{res.writeHead(502);res.end('Synthetic adapter failure');}
  });
  const pageHandler=(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Synthetic CORS test</title>');};
  const allowedPage=await start(pageHandler),deniedPage=await start(pageHandler);
  process.env.CORS_ORIGIN=origin+',https://velirandevu.com,'+allowedPage;
  fixtures.api+=`apiRouter.get('/public/auth-capabilities',(_req,res)=>res.json({whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}));apiRouter.get('/schools/:schoolId/settings',(_req,res)=>res.status(503).json({error:'Sentetik servis hatası'}));`;
  globalThis.__corsState.failDb=false;apiModule=await compile('browser');
  browser=await chromium.launch({channel:'chrome',headless:true});
  // Request interception can bypass browser preflight; these static pages only
  // fetch the three local test origins and contain no external resources.
  const context=await browser.newContext();
  await scenario('Real browser permits JSON/Bearer/school preflight and blocks invalid method/header',async()=>{
   const page=await context.newPage();try{await page.goto(allowedPage);const valid=await page.evaluate(async url=>{const response=await fetch(url+'/api/fixture-post',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-token','X-School-Id':'school-a'},body:JSON.stringify({synthetic:true})});return{status:response.status,body:await response.json()}},apiOrigin);assert.equal(valid.status,201);assert.deepEqual(valid.body.input,{synthetic:true});
    for(const options of [{method:'PROPFIND'},{headers:{'X-Untrusted':'synthetic'}}]){globalThis.__corsState.routeCalls=0;const result=await page.evaluate(async({url,options})=>{try{await fetch(url+'/api/fixture-get',options);return'accepted'}catch(e){return e.name}},{url:apiOrigin,options});assert.equal(result,'TypeError',JSON.stringify(options));assert.equal(globalThis.__corsState.routeCalls,0);}
   }finally{await page.close()}
  });
  await scenario('Real browser hides disallowed-origin response and does not send protected POST',async()=>{
   const page=await context.newPage();try{await page.goto(deniedPage);globalThis.__corsState.routeCalls=0;const result=await page.evaluate(async url=>{try{await fetch(url+'/api/protected/school-a',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'});return'accepted'}catch(e){return e.name}},apiOrigin);assert.equal(result,'TypeError');assert.equal(globalThis.__corsState.routeCalls,0);}finally{await page.close()}
  });
  await scenario('Actual API client reads allowed-origin JSON error without clearing its session',async()=>{
   const client=await build({stdin:{contents:`import{api}from'./src/services/api';window.syntheticApi=api;`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',define:{'import.meta.env':JSON.stringify({VITE_API_BASE_URL:apiOrigin})},plugins:[{name:'synthetic-auth-store',setup(b){b.onResolve({filter:/platform\/auth-session$/},()=>({path:'session',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`window.invalidations=0;export const authSession={getToken:async()=> 'synthetic-session',invalidateRejectedToken:async()=>window.invalidations++};`,loader:'js'}));}}]});
   const page=await context.newPage();try{await page.goto(allowedPage);await page.addScriptTag({content:client.outputFiles[0].text});const result=await page.evaluate(async()=>{const capabilities=await window.syntheticApi.getAuthCapabilities();try{await window.syntheticApi.getSettings('school-a');return{accepted:true}}catch(error){return{capabilities,status:error.status,message:error.message,invalidations:window.invalidations}}});assert.equal(result.status,503);assert.equal(result.message,'Sentetik servis hatası');assert.equal(result.invalidations,0);assert.equal(result.capabilities.phoneCentricAuthEnabled,true);
   }finally{await page.close()}
   const denied=await context.newPage();try{await denied.goto(deniedPage);await denied.addScriptTag({content:client.outputFiles[0].text});const error=await denied.evaluate(async()=>{try{await window.syntheticApi.getAuthCapabilities();return{accepted:true}}catch(e){return{name:e.name,invalidations:window.invalidations}}});assert.equal(error.name,'TypeError');assert.equal(error.invalidations,0);}finally{await denied.close()}
  });
 }finally{await browser?.close();await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));}
}
fs.writeFileSync(path.join(audit,'cors-results.json'),JSON.stringify({node:process.version,scopes:'Actual Function, Express/CORS and auth guards; synthetic DB/routes; browser tests use isolated local origins, not an Android device.',results},null,2));
if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
