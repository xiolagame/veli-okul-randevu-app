// Evaluate in the browser. Measures rendered solid surfaces; photographic backgrounds
// and native system UI still require visual/device checks.
export function auditThemeContrast(){
 const rgba=value=>{const parts=value.match(/[\d.]+/g)?.map(Number)||[];return parts.length>=3?[...parts.slice(0,3),parts[3]??1]:[0,0,0,0];};
 const over=(a,b)=>[a[0]*a[3]+b[0]*(1-a[3]),a[1]*a[3]+b[1]*(1-a[3]),a[2]*a[3]+b[2]*(1-a[3]),1];
 const background=element=>{const stack=[];for(let e=element;e;e=e.parentElement)stack.unshift(rgba(getComputedStyle(e).backgroundColor));return stack.reduce((b,a)=>over(a,b),[255,255,255,1]);};
 const lum=rgb=>rgb.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
 const results=[];
 for(const e of document.querySelectorAll('body *')){
  const rect=e.getBoundingClientRect(),s=getComputedStyle(e);
  if(rect.width===0||rect.height===0||s.visibility==='hidden'||s.opacity==='0'||e.closest('[disabled],[aria-disabled=true],svg,script,style'))continue;
  const text=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ').trim();
  if(!text)continue;
  const bg=background(e),fg=over(rgba(s.color),bg),a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  const large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700),minimum=large?3:4.5;
  if(ratio+.02<minimum)results.push({text:text.slice(0,65),class:e.className,ratio:Number(ratio.toFixed(2)),minimum,color:s.color,background:bg.slice(0,3).map(Math.round)});
 }
 return results;
}
