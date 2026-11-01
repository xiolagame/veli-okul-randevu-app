import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';

// Local static pages + mocked APIs only. Neither server can send a request or email.
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const original=process.env.HELP_REFERENCE_ROOT;
assert(original,'HELP_REFERENCE_ROOT must identify the read-only deployment archive');
const source=process.env.HELP_SOURCE_ROOT;
assert(source,'HELP_SOURCE_ROOT must identify the read-only original source');
const root=process.cwd(),out=path.join(root,'audit/help-recovery');fs.mkdirSync(out,{recursive:true});
assert(fs.readFileSync('src/components/HelpCategoryArt.tsx').equals(fs.readFileSync(path.join(source,'src/components/HelpCategoryArt.tsx'))),'Original SVG helper must be byte-identical');
assert(fs.readFileSync('src/components/help-presentation.css','utf8').includes(fs.readFileSync(path.join(source,'src/components/help-presentation.css'),'utf8').replaceAll('\r\n','\n')),'Original category CSS must remain intact');
function serve(directory){
 const server=http.createServer((req,res)=>{
  const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/,''),file=path.resolve(directory,relative);
  if(!file.startsWith(path.resolve(directory)+path.sep)&&file!==path.resolve(directory)){res.writeHead(403).end();return;}
  const target=fs.existsSync(file)&&fs.statSync(file).isFile()?file:path.join(directory,'index.html');
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.mp4':'video/mp4'})[path.extname(target)]||'text/html');res.end(fs.readFileSync(target));
 });return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,origin:'http://127.0.0.1:'+server.address().port})));
}
const current=await serve(path.join(root,'dist/client')),archive=await serve(original);
const browser=await chromium.launch({channel:'chrome',headless:true});const rows=[],errors=[],submissions=[];
let responseMode='success';
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(![current.origin,archive.origin].includes(url.origin))return route.abort();
  if(url.pathname.startsWith('/api/')){
   if(url.pathname==='/api/public/requests'){
    submissions.push(route.request().postDataJSON());
    return route.fulfill(responseMode==='failure'?{status:503,json:{error:'Sentetik servis hatası'}}:{json:{ok:true,requestId:'synthetic',emailNotificationSent:responseMode==='success'}});
   }
   return route.fulfill({json:{whatsappAuthEnabled:true,unifiedLoginEnabled:true,phoneCentricAuthEnabled:true}});
  }
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const routes=['/yardim','/yardim/veli','/yardim/hesap-silme','/lisans-iletisim','/lisans-iletisim?request=contact'];
 for(const theme of ['light','dark']){
  await page.goto(current.origin+'/yardim');await page.evaluate(theme=>localStorage.setItem('veli.theme',theme),theme);
  for(const route of routes){
   await page.goto(current.origin+route);await page.locator('.help-hero,.help-guide,.public-request-page-card').first().waitFor();
   for(const width of [320,375,390,430,768,820,1024,1180,1440]){
    await page.setViewportSize({width,height:1000});
    const metrics=await page.evaluate(()=>{
     const css=e=>getComputedStyle(e),grid=document.querySelector('.help-category-grid');
     return {theme:document.documentElement.dataset.theme,overflow:document.documentElement.scrollWidth>innerWidth,columns:grid?css(grid).gridTemplateColumns.split(' ').length:null,cards:[...document.querySelectorAll('.help-category')].map(e=>({id:e.dataset.helpTheme,background:css(e).backgroundImage,accent:css(e).getPropertyValue('--help-accent').trim(),art:css(e.querySelector('.help-category-art')).display})),text:[...document.querySelectorAll('.help-category h2,.help-category header p,.help-topic-link strong,.help-topic-link small,.help-guide h1,.help-guide h2,.help-guide p,.help-guide li')].map(e=>({color:css(e).color,background:css(e.closest('.help-category,.help-guide-heading,.help-guide-section')).backgroundColor,gradient:css(e.closest('.help-category,.help-guide-heading,.help-guide-section')).backgroundImage}))};
    });
    assert.equal(metrics.theme,theme);assert(!metrics.overflow,`${route} ${theme} ${width} overflow`);
    if(metrics.columns){assert.equal(metrics.columns,width>=1100?4:width>=768?2:1);assert.equal(metrics.cards.length,4);assert.equal(new Set(metrics.cards.map(c=>c.accent)).size,4);for(const card of metrics.cards){assert(card.background.includes('linear-gradient'));assert.equal(card.art,'block');}}
    for(const t of metrics.text){
     const rgb=s=>s.match(/[\d.]+/g)?.slice(0,3).map(Number),lum=v=>v.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0),fg=rgb(t.color);
     const stops=t.gradient==='none'?[t.background]:(t.gradient.match(/rgba?\([^)]+\)/g)||[]);
     for(const stop of stops){const bg=rgb(stop);if(!bg)continue;const a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert(ratio>=4.5,`${route} ${theme} ${width} text contrast ${ratio.toFixed(2)} ${t.color}/${stop}`);}
    }
    rows.push({route,theme,width,...metrics});
    if([390,820,1440].includes(width))await page.screenshot({path:path.join(out,route.replaceAll('/','-').replaceAll('?','-')+'-'+theme+'-'+width+'.png'),fullPage:true});
   }
  }
 }
 // Every real topic resolves, category theme and decoration follow the route.
 await page.goto(current.origin+'/yardim');const links=await page.locator('.help-topic-link').evaluateAll(es=>es.map(e=>({path:new URL(e.href).pathname+new URL(e.href).search,theme:e.closest('[data-help-theme]').dataset.helpTheme})));
 for(const link of links){await page.goto(current.origin+link.path);if(link.path.startsWith('/yardim/')){await page.locator('.help-guide').waitFor();assert.equal(await page.locator('.help-guide').getAttribute('data-help-theme'),link.theme);assert.equal(await page.locator('.help-guide .help-category-art').count(),1);}else await page.locator('#request-plan').waitFor();}
 // Actual links, keyboard focus, back navigation, persistent single theme control.
 await page.goto(current.origin+'/yardim');await page.locator('.help-topic-link').first().focus();assert(await page.locator('.help-topic-link').first().evaluate(e=>getComputedStyle(e).outlineStyle!=='none'));await page.locator('.help-topic-link').first().click();await page.locator('.help-guide').waitFor();await page.getByRole('button',{name:'Yardım merkezine dön',exact:true}).click();await page.locator('.help-hero').waitFor();
 for(const kind of ['CONTACT','YEARLY_LICENSE'])for(const mode of ['success','partial','failure']){
  await page.goto(current.origin+'/lisans-iletisim'+(kind==='CONTACT'?'?request=contact':''));await page.locator('#request-plan').waitFor();assert.equal(await page.locator('#request-plan').inputValue(),kind);
  const count=submissions.length;await page.getByRole('button',{name:'Talebi Gönder'}).click();await page.getByRole('alert').first().waitFor();assert.equal(submissions.length,count,'Invalid form must not submit');
  for(const [id,value] of Object.entries({'school':'Sentetik Test Okulu','contact':'Sentetik Kişi','email':'review@example.test','phone':'05551234567','message':'Yalnız yerel fixture'}))await page.locator('#request-'+id).fill(value);
  responseMode=mode;await page.getByRole('button',{name:'Talebi Gönder'}).click();await page.getByRole(mode==='failure'?'alert':'status').first().waitFor();assert.equal(submissions.length,count+1);assert.equal(submissions.at(-1).requestType,kind);
  if(mode==='failure')assert(await page.locator('#request-email').isVisible());else {assert.equal(await page.locator('#request-email').count(),0);await page.getByRole('button',{name:'Yeni talep oluştur'}).click();await page.locator('#request-school').waitFor();assert.equal(await page.locator('#request-school').inputValue(),'');}
 }
 const historical=await context.newPage();await historical.goto(archive.origin+'/yardim');await historical.locator('.help-category').first().waitFor();await historical.evaluate(()=>{document.documentElement.dataset.theme='light';localStorage.setItem('veli-randevu.web-theme','light')});
 const comparison={};
 for(const width of [390,820,1440]){
  await historical.setViewportSize({width,height:1000});await historical.screenshot({path:path.join(out,`archive-light-${width}.png`),fullPage:true});
 }
 comparison.archive=await historical.locator('.help-category').evaluateAll(es=>es.map(e=>({theme:e.dataset.helpTheme,background:getComputedStyle(e).backgroundImage,rect:(({x,y,width,height})=>({x,y,width,height}))(e.getBoundingClientRect()),svg:e.querySelector('.help-category-art')?.outerHTML})));
 await page.goto(current.origin+'/yardim');await page.evaluate(()=>localStorage.setItem('veli.theme','light'));await page.reload();await page.locator('.help-category').first().waitFor();comparison.current=await page.locator('.help-category').evaluateAll(es=>es.map(e=>({theme:e.dataset.helpTheme,background:getComputedStyle(e).backgroundImage,rect:(({x,y,width,height})=>({x,y,width,height}))(e.getBoundingClientRect()),svg:e.querySelector('.help-category-art')?.outerHTML})));
 for(let i=0;i<4;i++){assert.equal(comparison.current[i].svg,comparison.archive[i].svg,'Recovered SVG must match shipped archive');for(const axis of ['x','y','width','height'])assert(Math.abs(comparison.current[i].rect[axis]-comparison.archive[i].rect[axis])<=1,'Original desktop card geometry must match: '+axis);}
 assert.deepEqual(errors,[],'Current pages must have no uncaught errors');
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({rows,topics:links.length,formCases:6,comparison,errors},null,2));
 console.log(`Help recovery PASS: ${rows.length} route/theme/width views; ${links.length} real topics; 6 mocked form outcomes; original SVG/CSS parity; text contrast >=4.5; no overflow/errors. Chromium only.`);
}finally{await browser.close();await Promise.all([new Promise(r=>current.server.close(r)),new Promise(r=>archive.server.close(r))]);}
