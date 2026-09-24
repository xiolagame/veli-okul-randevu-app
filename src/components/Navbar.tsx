import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Bell, LogOut, Shield, ChevronDown, Check, Building2, KeyRound } from 'lucide-react';
import { Brand, Button, Dialog } from './ui';

interface NavbarProps {
  onOpenNotifications: () => void;
  onOpenAdmin: () => void;
  onOpenOnboarding?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenNotifications, onOpenAdmin, onOpenOnboarding }) => {
  const { currentUser, currentSchool, schools, userMemberships, switchSchool, switchUser, logout, unreadNotificationCount } = useApp();
  const [showSchoolMenu, setShowSchoolMenu] = useState(false);
  const [showPersonaMenu, setShowPersonaMenu] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!headerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty('--topbar-height', entry.target.getBoundingClientRect().height + 'px');
    });
    observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, []);
  const roleLabel = { parent: 'Veli', teacher: 'Öğretmen', security: 'Güvenlik', admin: 'Okul yöneticisi' };
  const DEMO_PERSONAS = [
    { id: 'u-parent-1', name: 'Ahmet Yılmaz', desc: 'Okul A & Okul C Velisi (3 Öğrenci)', role: 'parent' },
    { id: 'u-parent-2', name: 'Fatma Kaya', desc: 'Okul A Velisi (1 Öğrenci)', role: 'parent' },
    { id: 'u-teacher-1', name: 'Mehmet Demir', desc: 'Okul A Matematik Öğretmeni', role: 'teacher' },
    { id: 'u-teacher-b1', name: 'Zeki Bulut', desc: 'Okul B Fizik Öğretmeni', role: 'teacher' },
    { id: 'u-security-1', name: 'Hasan Güvenç', desc: 'Okul A Güvenlik Görevlisi', role: 'security' },
    { id: 'u-security-b1', name: 'Osman Kaya', desc: 'Okul B Güvenlik Görevlisi', role: 'security' },
    { id: 'u-admin-1', name: 'Okul Yönetimi', desc: 'Okul A Yöneticisi', role: 'admin' },
    { id: 'u-admin-b1', name: 'Atatürk Lisesi Müd.', desc: 'Okul B Yöneticisi', role: 'admin' },
  ];

  return (
    <header ref={headerRef} className="app-topbar">
      <div className="topbar-inner">
        <Brand />
        <div className="school-switch">
          <button type="button" className="school-trigger" onClick={() => setShowSchoolMenu(true)} aria-haspopup="dialog" aria-label="Aktif okulunuzu değiştirin">
            <Building2 size={18} className="text-slate-500" />
            <div><strong>{currentSchool?.name || 'Okulunuzu seçin'}</strong><small>{currentSchool?.city} · {currentUser?.role ? roleLabel[currentUser.role] : 'Okul üyeliği'}</small></div><ChevronDown size={15} />
          </button>
        </div>
        <div className="topbar-actions">
          {currentUser?.role === 'admin' && <Button variant="quiet" className="admin-open" onClick={onOpenAdmin} aria-label="Yönetim panelini aç"><Shield size={18} /><span>Yönetim paneli</span></Button>}
          <button type="button" onClick={onOpenNotifications} className="icon-button" aria-label={`Bildirimler, ${unreadNotificationCount} okunmamış`}><Bell size={21} />{unreadNotificationCount > 0 && <span className="nav-count" style={{ top: 3, right: 3 }}>{unreadNotificationCount}</span>}</button>
          <button type="button" className="profile-trigger" onClick={() => setShowPersonaMenu(true)} aria-haspopup="dialog" aria-label="Hesap menüsü"><span className="avatar">{currentUser?.firstName[0]}{currentUser?.lastName[0]}</span><span className="profile-label"><strong>{currentUser?.firstName} {currentUser?.lastName}</strong><small>{currentUser?.role ? roleLabel[currentUser.role] : 'Hesabım'}</small></span></button>
        </div>
      </div>
      {showSchoolMenu && <Dialog title="Okulunuz" description="Görüntülemek istediğiniz okulu seçin." onClose={() => setShowSchoolMenu(false)}>
        <div className="space-y-2">{schools.map((school) => <button type="button" key={school.id} className="w-full text-left flex gap-3 items-center p-3 rounded-xl hover:bg-slate-50 border border-slate-200" onClick={() => { void switchSchool(school.id); setShowSchoolMenu(false); }}><Building2 size={20} className="text-blue-700" /><span className="flex-1"><strong className="block text-sm">{school.name}</strong><span className="text-xs text-slate-500">{school.city} · {userMemberships.some((membership) => membership.schoolId === school.id) ? 'Kayıtlı olduğunuz okul' : 'Üyeliğiniz bulunmuyor'}</span></span>{currentSchool?.id === school.id && <Check size={18} className="text-blue-700" />}</button>)}</div>
        {onOpenOnboarding && <Button variant="secondary" className="w-full mt-5" onClick={() => { setShowSchoolMenu(false); onOpenOnboarding(); }}><KeyRound size={18} />Yeni okula katılma hakkında</Button>}
      </Dialog>}
      {showPersonaMenu && <Dialog title="Hesabım" onClose={() => setShowPersonaMenu(false)}>
        <div className="flex gap-4 items-center mb-6"><span className="avatar">{currentUser?.firstName[0]}{currentUser?.lastName[0]}</span><div><h3 className="font-bold">{currentUser?.firstName} {currentUser?.lastName}</h3><p className="text-sm text-slate-500">{currentUser?.phone}</p></div></div>
        <Button variant="secondary" className="w-full" onClick={() => { setShowPersonaMenu(false); logout(); }}><LogOut size={18} />Oturumu kapat</Button>
        {import.meta.env.DEV && <details className="mt-6"><summary className="text-xs text-slate-500 cursor-pointer">Yerel test hesapları</summary><div className="space-y-1 mt-3">{DEMO_PERSONAS.map((persona) => <button type="button" key={persona.id} className="w-full text-left p-2 text-sm hover:bg-slate-50 rounded-lg" onClick={() => { void switchUser(persona.id); setShowPersonaMenu(false); }}>{persona.name}<span className="block text-xs text-slate-500">{persona.desc}</span></button>)}</div></details>}
      </Dialog>}
    </header>
  );
};
