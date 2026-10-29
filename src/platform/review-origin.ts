export function isReviewToken(token:string|null):boolean{
  try{return JSON.parse(atob((token||'').split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).iss==='veli-review';}catch{return false;}
}
export function reviewOrigin():string {
  const value=(import.meta.env?.VITE_REVIEW_API_ORIGIN||'').replace(/\/$/,'');
  if(!value)throw Error('İnceleme servisi henüz yapılandırılmadı.');
  const url=new URL(value);
  if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||['velirandevu.com','www.velirandevu.com'].includes(url.hostname))throw Error('Geçersiz inceleme servisi adresi.');
  return url.origin;
}
