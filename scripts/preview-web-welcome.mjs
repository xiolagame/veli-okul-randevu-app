// Local visual preview only: no database, provider credentials or authentication issuance.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist/client');
if(!fs.existsSync(path.join(root,'index.html')))throw new Error('Run npm run build first.');
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.mp4':'video/mp4','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET'&&url.pathname==='/api/public/auth-capabilities')return res.end(JSON.stringify({whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}));
  res.statusCode=503;return res.end(JSON.stringify({error:'Yerel tasarım önizlemesinde gerçek doğrulama kodu gönderimi kapalı.',code:'LOCAL_VISUAL_PREVIEW_ONLY'}));
 }
 let file;
 try{file=path.resolve(root,'.'+decodeURIComponent(url.pathname));}catch{res.statusCode=400;return res.end()}
 if(file!==root&&!file.startsWith(root+path.sep)){res.statusCode=403;return res.end()}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(root,'index.html');
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
 if(path.extname(file)==='.html')return res.end(fs.readFileSync(file,'utf8').replace('</body>','<div style="position:fixed;bottom:0;right:0;z-index:20000;background:#fff;color:#174335;padding:4px 12px;font:12px sans-serif;border:1px solid #acc8bb">Yerel tasarım önizlemesi · Gerçek kod gönderimi kapalı</div></body>'));
 fs.createReadStream(file).pipe(res);
}).listen(4174,'127.0.0.1',()=>console.log('Local visual preview: http://127.0.0.1:4174 (no real OTP, database or provider calls)'));
