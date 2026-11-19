import React from 'react';
import {CalendarDays} from 'lucide-react';
import {getRuntimePlatform} from '../platform/runtime-platform';
export function DashboardIntro({school=false}:{school?:boolean}){if(getRuntimePlatform()!=='WEB')return null;return <section className="dashboard-intro"><div><p><CalendarDays size={16} aria-hidden="true"/>{new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',dateStyle:'full'}).format(new Date())}</p><h2>{school?'Her görüşme, güçlü bir bağ.':'Birlikte daha düzenli bir okul günü.'}</h2><span>{school?'Okulunuzun günlük akışı ve öncelikleri burada.':'Okullarınızı, lisansları ve günlük gelişmeleri takip edin.'}</span></div><div className="dashboard-intro-photo" aria-hidden="true"/></section>;}
