import {StatusBar,Style} from '@capacitor/status-bar';
import {getRuntimePlatform} from './runtime-platform';
import {appLifecycle} from './lifecycle';

export type Theme='light'|'dark';
export function currentTheme():Theme{return document.documentElement.dataset.theme==='dark'?'dark':'light';}
export function selectTheme(theme:Theme){
 document.documentElement.dataset.theme=theme;
 document.documentElement.style.colorScheme=theme;
 try{localStorage.setItem('veli.theme',theme);}catch{/* Private mode: current-session choice still works. */}
 window.dispatchEvent(new Event('veli:theme'));
}

// Match the surface actually behind the status bar, including photo login and
// body-portalled modal backdrops. Style.Dark means LIGHT icons in Capacitor.
function iosStatusBarStyle() {
 const rgb=(value:string)=>value.match(/[\d.]+/g)?.map(Number) ?? [];
 const blend=(under:number[],value:string)=>{
  const c=rgb(value);if(c.length<3)return under;
  const alpha=c[3]??1;return under.map((v,i)=>c[i]*alpha+v*(1-alpha));
 };
 const body=getComputedStyle(document.body);
 let surface=blend(currentTheme()==='dark'?[16,28,25]:[246,248,247],body.backgroundColor);
 // This existing mobile photo has two dark overlays, independent of theme.
 // Use their worst-case (white image pixel) composition rather than image data.
 if(body.backgroundImage.includes('04-Mobil.png'))surface=[0,1,2].map(i=>[17,82,59][i]*.7+([42,45,48][i]*.56+255*.44)*.3);
 const topbar=document.querySelector<HTMLElement>('.review-banner,.app-topbar');
 if(topbar && topbar.getBoundingClientRect().height>0 && topbar.getBoundingClientRect().top<=parseFloat(getComputedStyle(document.getElementById('root')!).paddingTop)+1){
  surface=blend(surface,getComputedStyle(topbar).backgroundColor);
 }
 // Transparent overlays compose over the page; do not replace the page image.
 for(const el of [...document.elementsFromPoint(Math.max(1,innerWidth/2),1)].reverse()){
  if(el===topbar||el===document.body||el===document.documentElement)continue;
  const css=getComputedStyle(el);
  surface=blend(surface,css.backgroundColor);
 }
 const luminance=surface.map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 return 1.05/(luminance+.05)>(luminance+.05)/.05?Style.Dark:Style.Light;
}

// iOS alone overlays the WebView. Shared native config stays unchanged for Android.
export function initializeIosThemeChrome():()=>void {
 if(getRuntimePlatform()!=='IOS')return()=>{};
 let pending=Promise.resolve(),disposed=false,frame=0,lastStyle:Style|undefined,force=false;
 const sync=(reapply=false)=>{
  force ||= reapply;
  if(frame||disposed)return;
  frame=requestAnimationFrame(()=>{
   frame=0;
   // Read the latest surface inside the queue, so rapid theme/route changes win.
   pending=pending.then(async()=>{
    if(disposed)return;
    const style=iosStatusBarStyle(),reapply=force;force=false;
    if(style===lastStyle&&!reapply)return;
    await StatusBar.setOverlaysWebView({overlay:true});
    if(disposed)return;
    await StatusBar.setStyle({style});lastStyle=style;
   }).catch(()=>{lastStyle=undefined;/* Native chrome failure must not interrupt authentication. */});
  });
 };
 const refresh=()=>sync(),resume=()=>sync(true),visibility=()=>{if(!document.hidden)resume();};
 const observer=new MutationObserver(refresh);
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});
 const themeObserver=new MutationObserver(refresh);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
 const unsubscribe=appLifecycle.subscribe(state=>{if(state==='ACTIVE')resume();});
 sync(true);window.addEventListener('veli:theme',refresh);window.addEventListener('pageshow',resume);window.addEventListener('resize',refresh);document.addEventListener('visibilitychange',visibility);
 return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();themeObserver.disconnect();unsubscribe();window.removeEventListener('veli:theme',refresh);window.removeEventListener('pageshow',resume);window.removeEventListener('resize',refresh);document.removeEventListener('visibilitychange',visibility);};
}
