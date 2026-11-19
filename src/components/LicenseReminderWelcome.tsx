import React,{useEffect,useState} from 'react';
import {api} from '../services/api';
import {Dialog,Button} from './ui';
import {LicenseWhatsAppPreference} from './LicenseWhatsAppPreference';
import {getRuntimePlatform} from '../platform/runtime-platform';
export const LICENSE_ONBOARDING_KEY='veli-randevu.license-onboarding';
// This marker only controls an optional card. The server remains the sole consent authority.
export function LicenseReminderWelcome({userId,schoolId}:{userId:string;schoolId:string}){const[open,setOpen]=useState(false);useEffect(()=>{if(getRuntimePlatform()!=='WEB')return;let active=true;try{if(sessionStorage.getItem(LICENSE_ONBOARDING_KEY)!==userId)return;}catch{return;}void api.getLicenseWhatsAppPreference(schoolId).then(value=>{if(active&&value.consentStatus==='MISSING')setOpen(true);}).catch(()=>{});return()=>{active=false;};},[userId,schoolId]);function close(){setOpen(false);try{sessionStorage.removeItem(LICENSE_ONBOARDING_KEY);}catch{}}return open?<Dialog title="Lisans bildirim tercihiniz" description="Hesabınız hazır. Bu isteğe bağlı tercihi şimdi veya Hesabım alanından düzenleyebilirsiniz." onClose={close}><LicenseWhatsAppPreference schoolId={schoolId}/><Button variant="quiet" onClick={close}>Devam et</Button></Dialog>:null;}
