import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import http from'node:http';import crypto from'node:crypto';import{pathToFileURL}from'node:url';
const root=process.cwd(),clientRoot=path.join(root,'release/client');
const proof=JSON.parse(fs.readFileSync('release/checks/package-verification.json','utf8')).verified.find(f=>f.name==='api');
assert.equal(crypto.createHash('sha256').update(fs.readFileSync('release/functions/api.zip')).digest('hex'),proof.sha256);
if(process.env.DATABASE_URL)throw Error('REMOTE_DATABASE_FORBIDDEN');
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
process.chdir(proof.extracted);Object.assign(process.env,{NODE_ENV:'test',JWT_SECRET:'synthetic-package-ui-jwt-secret-long-enough',AUTH_CODE_SECRET:'synthetic-package-ui-code-secret-long-enough',WHATSAPP_AUTH_ENABLED:'true',WHATSAPP_UNIFIED_LOGIN_ENABLED:'true',PHONE_CENTRIC_AUTH_ENABLED:'true'});
globalThis.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
const{default:api}=await import(pathToFileURL(path.join(proof.extracted,'netlify/functions/api.mjs')).href);
let failCapabilities=false,writes=0,capabilityCalls=0;
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/')){
  if(req.method!=='GET'){writes++;res.statusCode=405;return res.end();}
  if(u.pathname==='/api/public/auth-capabilities'){capabilityCalls++;if(failCapabilities){res.statusCode=502;return res.end('Synthetic package failure');}}
  try{const out=await api(new Request('http://localhost'+req.url),{requestId:'synthetic-ui'});res.writeHead(out.status,Object.fromEntries(out.headers));return res.end(await out.text());}catch{res.statusCode=500;return res.end('SAFE_PACKAGE_ERROR');}
 }
 let file=path.resolve(clientRoot,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(clientRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(clientRoot,'index.html');
 res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.goto(origin+'/login');await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).waitFor();assert.equal(await page.getByText('Giriş seçenekleri alınamadı.',{exact:false}).count(),0);
 failCapabilities=true;await page.reload();await page.getByText('Giriş seçenekleri alınamadı.',{exact:false}).waitFor();
 failCapabilities=false;await page.getByRole('button',{name:'Tekrar dene',exact:true}).click();await page.getByRole('button',{name:'WhatsApp Kodu Gönder',exact:true}).waitFor();assert.equal(writes,0);assert(capabilityCalls>=3);
 console.log('Production package UI PASS: real built frontend + extracted API ZIP, actual capability HTTP response, 502 error, retry recovery, no OTP requests.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
process.exit(0);
