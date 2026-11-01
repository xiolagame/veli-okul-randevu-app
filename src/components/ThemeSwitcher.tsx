import React,{useEffect,useState} from 'react';
import {Sun,Moon} from 'lucide-react';
import {currentTheme,selectTheme} from '../platform/theme';
export function ThemeSwitcher(){
 const [theme,setTheme]=useState(currentTheme);
 useEffect(()=>{const refresh=()=>setTheme(currentTheme());window.addEventListener('veli:theme',refresh);return()=>window.removeEventListener('veli:theme',refresh);},[]);
 const dark=theme==='dark';
 return <div className="theme-switcher">
  <button type="button" aria-label={dark?'Açık mod':'Koyu mod'} title={dark?'Koyu tema etkin · Açık moda geç':'Açık tema etkin · Koyu moda geç'} data-active-theme={theme} onClick={()=>selectTheme(dark?'light':'dark')}>
   {dark?<Moon size={19} aria-hidden="true"/>:<Sun size={19} aria-hidden="true"/>}
  </button>
 </div>;
}
