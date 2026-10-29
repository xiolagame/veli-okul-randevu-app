import {StatusBar,Style} from '@capacitor/status-bar';
import {getRuntimePlatform} from './runtime-platform';

export type Theme='light'|'dark';
export function currentTheme():Theme{return document.documentElement.dataset.theme==='dark'?'dark':'light';}
export function selectTheme(theme:Theme){
 document.documentElement.dataset.theme=theme;
 document.documentElement.style.colorScheme=theme;
 try{localStorage.setItem('veli.theme',theme);}catch{/* Private mode: current-session choice still works. */}
 window.dispatchEvent(new Event('veli:theme'));
}

// Native chrome follows the already resolved CSS theme. Android/web stay unchanged.
export function initializeIosThemeChrome():()=>void {
 if(getRuntimePlatform()!=='IOS')return()=>{};
 let pending=Promise.resolve();
 const sync=()=>{
  const theme=currentTheme();
  const color=getComputedStyle(document.documentElement).getPropertyValue('--theme-bg').trim();
  // Serialize rapid toggles so an older native call cannot win over the latest choice.
  pending=pending.then(async()=>{
   await StatusBar.setStyle({style:theme==='dark'?Style.Dark:Style.Light});
   await StatusBar.setBackgroundColor({color});
  }).catch(()=>{/* Native chrome failure must not interrupt authentication. */});
 };
 sync();window.addEventListener('veli:theme',sync);window.addEventListener('pageshow',sync);
 return()=>{window.removeEventListener('veli:theme',sync);window.removeEventListener('pageshow',sync);};
}
