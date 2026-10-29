import React,{useState} from 'react';
import {useApp} from '../context/AppContext';
import {api} from '../services/api';
export function ReviewBanner(){
 const {currentUser}=useApp();
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 if(!currentUser?.id.startsWith('review-'))return null;
 return <div className="review-banner" role="status">Mağaza inceleme ortamı · Yalnız sentetik veriler. WhatsApp, SMS, e-posta ve push gönderilmez; hesap silme simüle edilir.
  <button type="button" className="ui-button ui-button-secondary" disabled={busy} onClick={async()=>{setBusy(true);try{setMessage((await api.refreshReviewScenarios()).message);}catch{setMessage('Demo QR örneği yenilenemedi. Bağlantınızı kontrol edin.');}finally{setBusy(false);}}}>{busy?'Hazırlanıyor…':'Demo QR örneğini yenile'}</button>{message&&<p>{message}</p>}
 </div>;
}
