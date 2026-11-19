import React, {createContext, useContext, useEffect, useLayoutEffect, useState} from 'react';
import {Moon, Sun} from 'lucide-react';
import {getRuntimePlatform} from '../platform/runtime-platform';

export type WebTheme = 'light' | 'dark';
export const WEB_THEME_KEY = 'veli-randevu.web-theme';
const ThemeContext = createContext<{theme:WebTheme; toggle:()=>void;fixedPublic:boolean;setFixedPublic:(value:boolean)=>void}>({theme:'light',toggle:()=>{},fixedPublic:false,setFixedPublic:()=>{}});
export function useFixedPublicAppearance(){const {setFixedPublic}=useContext(ThemeContext);useLayoutEffect(()=>{if(getRuntimePlatform()!=='WEB')return;setFixedPublic(true);return()=>setFixedPublic(false);},[setFixedPublic]);}
export function readWebTheme():WebTheme {try{return localStorage.getItem(WEB_THEME_KEY)==='dark'?'dark':'light';}catch{return 'light';}}
export function applyWebTheme(theme:WebTheme){if(getRuntimePlatform()!=='WEB')return;document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;}
export function ThemeProvider({children}:{children:React.ReactNode}){
 const [theme,setTheme]=useState<WebTheme>(()=>getRuntimePlatform()==='WEB'?readWebTheme():'light');
 const [fixedPublic,setFixedPublic]=useState(false);
 useEffect(()=>{applyWebTheme(theme);},[theme]);
 useEffect(()=>{if(getRuntimePlatform()!=='WEB')return;const change=(event:StorageEvent)=>{if(event.key===WEB_THEME_KEY||event.key===null){const next=readWebTheme();applyWebTheme(next);setTheme(next);}};window.addEventListener('storage',change);return()=>window.removeEventListener('storage',change);},[]);
 function toggle(){if(fixedPublic)return;setTheme(previous=>{const next=previous==='light'?'dark':'light';applyWebTheme(next);try{localStorage.setItem(WEB_THEME_KEY,next);}catch{/* In-memory preference still works. */}return next;});}
 return <ThemeContext.Provider value={{theme,toggle,fixedPublic,setFixedPublic}}>{children}<ThemeToggle floating/></ThemeContext.Provider>;
}
export function ThemeToggle({floating=false}:{floating?:boolean}){const {theme,toggle,fixedPublic}=useContext(ThemeContext);if(getRuntimePlatform()!=='WEB'||fixedPublic)return null;const label=theme==='light'?'Karanlık temaya geç':'Açık temaya geç';const Icon=theme==='light'?Moon:Sun;return <button type="button" className={`icon-button web-theme-toggle${floating?' web-theme-floating':''}`} onClick={toggle} title={label} aria-label={label}><Icon size={20} aria-hidden="true"/></button>;}
