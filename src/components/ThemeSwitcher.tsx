import React,{useEffect,useState} from 'react';
import {Sun,Moon} from 'lucide-react';
import {currentTheme,selectTheme} from '../platform/theme';
export function ThemeSwitcher(){
 const [theme,setTheme]=useState(currentTheme);
 useEffect(()=>{const refresh=()=>setTheme(currentTheme());window.addEventListener('veli:theme',refresh);return()=>window.removeEventListener('veli:theme',refresh);},[]);
 return <div className="theme-switcher" role="group" aria-label="Görünüm">
  <button aria-label="Açık mod" aria-pressed={theme==='light'} onClick={()=>selectTheme('light')}><Sun size={19} aria-hidden="true"/></button>
  <button aria-label="Koyu mod" aria-pressed={theme==='dark'} onClick={()=>selectTheme('dark')}><Moon size={19} aria-hidden="true"/></button>
 </div>;
}
