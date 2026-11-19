import React,{useLayoutEffect,useState}from'react';
import{createPortal}from'react-dom';import{Moon,Sun}from'lucide-react';import{useTheme}from'./theme';
export function ThemeControl(){
 const{theme,toggleTheme}=useTheme();const[target,setTarget]=useState<Element|null>(null);
 useLayoutEffect(()=>{
  let chosen:Element|null=null;
  const find=()=>{
   const candidate=[...document.querySelectorAll('.dialog-heading,.topbar-actions,.auth-mobile-brand,.public-request-page-header')].filter(e=>getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0);
   const next=candidate.find(e=>e.classList.contains('dialog-heading'))||candidate.find(e=>e.classList.contains('topbar-actions'))||candidate[0]||null;
   if(next!==chosen){chosen=next;setTarget(next);}
  };
  find();const observer=new MutationObserver(find);observer.observe(document.body,{childList:true,subtree:true});window.addEventListener('resize',find);
  return()=>{observer.disconnect();window.removeEventListener('resize',find);};
 },[]);
 const label=theme==='light'?'Koyu modu aç':'Açık modu aç';const Icon=theme==='light'?Moon:Sun;
 const button=<button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={label} title={label} data-theme-action={theme==='light'?'dark':'light'}><Icon size={21} strokeWidth={1.8} aria-hidden="true"/></button>;
 return target?createPortal(button,target):<div className="theme-floating">{button}</div>;
}
