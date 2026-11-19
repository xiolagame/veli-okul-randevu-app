import {useSyncExternalStore}from'react';
import {Capacitor,registerPlugin}from'@capacitor/core';
export type Theme='light'|'dark';
export const THEME_KEY='veli.theme.v1';
const NativeTheme=registerPlugin<{apply(options:{theme:Theme;manual:boolean}):Promise<void>}>('NativeTheme');
const listeners=new Set<()=>void>();
let manual=false;
try{manual=['light','dark'].includes(localStorage.getItem(THEME_KEY)||'');}catch{}
let active:Theme=document.documentElement.dataset.theme==='dark'?'dark':'light';
let media:MediaQueryList|undefined;
try{media=matchMedia('(prefers-color-scheme: dark)');}catch{}
function apply(theme:Theme){
 active=theme;const root=document.documentElement;
 root.dataset.theme=theme;root.style.colorScheme=theme;
 root.style.backgroundColor=theme==='dark'?'#0b1712':'#f6f8f7';
 const meta=document.querySelector<HTMLMetaElement>('meta[name=theme-color]');if(meta)meta.content=root.style.backgroundColor;
 if(Capacitor.getPlatform()==='android')void NativeTheme.apply({theme,manual}).catch(()=>{/* Theme must never block authentication or session restore. */});
 listeners.forEach(fn=>fn());
}
media?.addEventListener('change',e=>{if(!manual)apply(e.matches?'dark':'light');});
window.addEventListener('storage',e=>{if(e.key!==THEME_KEY)return;manual=e.newValue==='light'||e.newValue==='dark';apply(manual?e.newValue as Theme:media?.matches?'dark':'light');});
export function setTheme(theme:Theme){manual=true;try{localStorage.setItem(THEME_KEY,theme);}catch{}apply(theme);}
export function useTheme(){const theme=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>active,()=>active);return{theme,toggleTheme:()=>setTheme(theme==='light'?'dark':'light')};}
apply(active);
