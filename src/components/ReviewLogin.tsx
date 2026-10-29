import React,{useState} from 'react';
import {useApp} from '../context/AppContext';
import {reviewOrigin,isReviewToken} from '../platform/review-origin';
import {Alert,Button,Dialog} from './ui';
export function ReviewLogin(){
 const {whatsappLogin}=useApp();
 const [open,setOpen]=useState(false),[identity,setIdentity]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <><button className="auth-help-link" onClick={()=>setOpen(true)}>Mağaza inceleme erişimi</button>{open&&<Dialog title="Mağaza inceleme erişimi" onClose={()=>setOpen(false)} dismissible={!busy}>
  <p>Yalnız Apple ve Google inceleme ekiplerine verilen bilgilerle, sentetik demo okuluna erişim sağlar.</p>
  <form className="form-stack" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{
   const response=await fetch(reviewOrigin()+'/api/review/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identity,password}),signal:AbortSignal.timeout(20000)});
   const result=await response.json();if(!response.ok)throw Error(result.error||'İnceleme girişi başarısız.');
   if(!isReviewToken(result.token)||!result.user?.id?.startsWith('review-')||!Array.isArray(result.memberships)||!result.memberships.length||result.memberships.some((m:{schoolId:string})=>!m.schoolId.startsWith('review-')))throw Error('Geçersiz demo oturumu.');
   const login=await whatsappLogin({challengeId:'',phone:'',code:''},result);if(!login.ok)throw Error('Demo oturumu kurulamadı.');setPassword('');setOpen(false);
  }catch(cause){setError(cause instanceof Error?cause.message:'Giriş tamamlanamadı.');}finally{setBusy(false);}}}>
   {error&&<Alert tone="danger">{error}</Alert>}
   <label className="field">İnceleme kimliği<input value={identity} onChange={e=>setIdentity(e.target.value)} autoComplete="username" required maxLength={80}/></label>
   <label className="field">İnceleme parolası<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required maxLength={128}/></label>
   <Button type="submit" disabled={busy}>{busy?'Doğrulanıyor…':'Demo okuluna gir'}</Button>
  </form></Dialog>}</>;
}
