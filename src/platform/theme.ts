export type Theme='light'|'dark';
export function currentTheme():Theme{return document.documentElement.dataset.theme==='dark'?'dark':'light';}
export function selectTheme(theme:Theme){
 document.documentElement.dataset.theme=theme;
 document.documentElement.style.colorScheme=theme;
 try{localStorage.setItem('veli.theme',theme);}catch{/* Private mode: current-session choice still works. */}
 window.dispatchEvent(new Event('veli:theme'));
}
