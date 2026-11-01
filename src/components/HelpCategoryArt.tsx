import React from 'react';
import { Building2, Users, Network, ShieldCheck, LockKeyhole, Wrench, IdCard, Trash2, FileText, Shield, Layers3, MessagesSquare, type LucideIcon } from 'lucide-react';
export type HelpTheme = 'usage' | 'account' | 'legal' | 'support';
const topicIcons: Record<string, LucideIcon> = {
  'okul-yoneticisi': Building2, ogretmen: Users, veli: Network, guvenlik: ShieldCheck,
  'ilk-giris': LockKeyhole, 'parolami-unuttum': Wrench, 'hesap-guvenligi': IdCard, 'hesap-silme': Trash2,
  'kvkk-aydinlatma': FileText, 'gizlilik-politikasi': Shield, 'kullanim-kosullari': FileText, 'veri-saklama-silme': Layers3,
};
export function HelpTopicIcon({ slug }: { slug?: string }) {
  const Icon = topicIcons[slug || ''] || MessagesSquare;
  return <span className="help-topic-icon" aria-hidden="true"><Icon size={23} strokeWidth={1.8} /></span>;
}
/** Decorative vector artwork, not a navigation target. */
export function HelpCategoryArt({ theme }: { theme: HelpTheme }) {
  return <svg className="help-category-art" viewBox="0 0 160 90" aria-hidden="true" focusable="false">
    <ellipse cx="88" cy="79" rx="59" ry="7" fill="currentColor" opacity=".10" />
    {theme === 'usage' && <>
      <path d="M30 57 102 52 123 63 51 70Z" fill="#b2d7c6" /><path d="m30 57 21 13v10L30 68Z" fill="#69a78e" /><path d="m51 70 72-7v10l-72 7Z" fill="#e7f4ec" />
      <path d="m37 40 68-5 18 13-68 6Z" fill="#83bfa7" /><path d="m37 40 18 14v10L37 50Z" fill="#45997c" /><path d="m55 54 68-6v10l-68 6Z" fill="#f6fcf8" />
      <path d="M117 45V14" stroke="#609e82" strokeWidth="3" /><path d="M117 31C95 28 98 11 112 20Z" fill="#7abd9c" /><path d="M118 25C136 21 141 7 125 12Z" fill="#4b9a78" /><path d="M118 17C105 8 109-2 118 2 127 8 118 17 118 17Z" fill="#a0d0b8" />
      <path d="m103 45 29-2-5 24-19 2Z" fill="#82b69b" />
    </>}
    {theme === 'account' && <>
      <path d="m56 17 67 3-5 47-70-3Z" fill="#91baf0" /><path d="m61 22 57 2-5 36-58-2Z" fill="#e0efff" />
      <path d="m48 64 70 3 20 10-83-1-23-6Z" fill="#7aa6de" /><path d="m59 67 55 2 7 4-58-1Z" fill="#c6ddfa" />
      <rect x="78" y="37" width="23" height="19" rx="4" fill="#fff" /><path d="M83 38v-6a7 7 0 0 1 14 0v6" fill="none" stroke="#78a7e0" strokeWidth="4" /><circle cx="90" cy="44" r="2" fill="#3974c2" /><path d="M90 45v5" stroke="#3974c2" strokeWidth="2" />
    </>}
    {theme === 'legal' && <>
      <path d="m77 17 19-6 34 7-3 53-47 2Z" fill="#f5c45f" /><path d="m88 16 10-2 27 7-3 42-32-2Z" fill="#ffedb4" />
      <path d="m57 27 38-1 17 12-2 39-55-5Z" fill="#f9d889" /><path d="m62 33 37-1-1 30-38-2Z" fill="#fff7df" />
      <path d="m41 49 25-2 9 9 40-2-2 27-66-3Z" fill="#eeb94e" /><path d="m72 46 15-1 8 7 21 1-1 22-39-1Z" fill="#8ea5ad" />
      <path d="m70 40 22 1M70 45l18 1M98 27l18 2" stroke="#f0cf83" strokeWidth="3" />
    </>}
    {theme === 'support' && <>
      <path d="M82 18h53a12 12 0 0 1 12 12v22a12 12 0 0 1-12 12h-12l-17 12 1-12H82a12 12 0 0 1-12-12V30a12 12 0 0 1 12-12" fill="#f6a9a4" />
      <circle cx="92" cy="40" r="3" fill="#d76860" /><circle cx="108" cy="40" r="3" fill="#d76860" /><circle cx="124" cy="40" r="3" fill="#d76860" />
      <path d="M35 36h47a12 12 0 0 1 12 12v15a12 12 0 0 1-12 12H59L43 86V75h-8a12 12 0 0 1-12-12V48a12 12 0 0 1 12-12" fill="#fff0ee" /><path d="M40 55h34m-9-7 9 7-9 7" fill="none" stroke="#edaaa3" strokeWidth="3" />
    </>}
  </svg>;
}
