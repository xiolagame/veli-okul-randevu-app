import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Bell, LogOut, Shield, ChevronDown, Check, Building2, KeyRound, GraduationCap, Users, UserRound, CircleHelp } from 'lucide-react';
import { Brand, Button, Dialog } from './ui';

interface NavbarProps {
  onManageSchools?: () => void;
  onOpenNotifications: () => void;
  onOpenAdmin: () => void;
  onOpenOnboarding?: () => void;
  onOpenHelp: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenNotifications, onOpenAdmin, onOpenOnboarding, onOpenHelp, onManageSchools }) => {
  const { currentUser, currentSchool, schools, platformSchools, isPlatformAdmin, platformContextActive, userMemberships, switchSchool, switchUser, logout, unreadNotificationCount } = useApp();
  const [showSchoolMenu, setShowSchoolMenu] = useState(false);
  const [showPersonaMenu, setShowPersonaMenu] = useState(false);
  const canSwitchSchool = isPlatformAdmin || currentUser?.role === 'parent';
  const ownSchools = schools.filter((school) => userMemberships.some((membership) => membership.schoolId === school.id && membership.status === 'active'));
  const schoolOptions = isPlatformAdmin ? platformSchools : ownSchools;
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!headerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty('--topbar-height', entry.target.getBoundingClientRect().height + 'px');
    });
    observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, []);
  const roleLabel = { parent: 'Veli', teacher: 'Öğretmen', security: 'Güvenlik · Giriş Kontrolü', admin: isPlatformAdmin ? 'Platform Yönetimi' : 'Okul Yönetimi' };
  const RoleIcon = currentUser?.role === 'admin' ? isPlatformAdmin ? Shield : Building2 : currentUser?.role === 'teacher' ? GraduationCap : currentUser?.role === 'security' ? Shield : currentUser?.role === 'parent' ? Users : UserRound;
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
          <button type="button" className="school-trigger" disabled={!canSwitchSchool} onClick={() => setShowSchoolMenu(true)} aria-haspopup={canSwitchSchool ? 'dialog' : undefined} aria-label={canSwitchSchool ? isPlatformAdmin ? 'Platform okullarını yönet' : 'Aktif okulunuzu değiştirin' : 'Okulunuz'}>
            <Building2 size={18} className="text-slate-500" />
            <div><strong>{isPlatformAdmin ? platformContextActive ? `Platform Yönetimi · ${currentSchool?.name || ''}` : 'Platform Yönetimi' : currentSchool?.name || 'Okulunuzu seçin'}</strong><small>{currentUser?.role ? roleLabel[currentUser.role] : 'Okul üyeliği'}</small></div>{canSwitchSchool && <ChevronDown size={15} />}
          </button>
        </div>
        <div className="topbar-actions">
          {(isPlatformAdmin || currentUser?.role === 'admin') && <Button variant="quiet" className="admin-open" onClick={onOpenAdmin} aria-label={isPlatformAdmin ? 'Platform Yönetimini aç' : 'Yönetim panelini aç'}><Shield size={18} /><span>{isPlatformAdmin ? 'Platform Yönetimi' : 'Yönetim paneli'}</span></Button>}
          <button type="button" onClick={onOpenNotifications} className="icon-button" aria-label={`Bildirimler, ${unreadNotificationCount} okunmamış`}><Bell size={21} />{unreadNotificationCount > 0 && <span className="nav-count" style={{ top: 3, right: 3 }}>{unreadNotificationCount}</span>}</button>
          <button type="button" className="profile-trigger" onClick={() => setShowPersonaMenu(true)} aria-haspopup="dialog" aria-label="Hesap menüsü"><span className="avatar"><RoleIcon size={20} aria-hidden="true" /></span><span className="profile-label"><strong>{currentUser?.firstName} {currentUser?.lastName}</strong><small>{currentUser?.role ? roleLabel[currentUser.role] : 'Hesabım'}</small></span></button>
        </div>
      </div>
      {showSchoolMenu && canSwitchSchool && <Dialog title={isPlatformAdmin ? 'Platform Yönetimi · Okullar' : 'Okulunuz'} description={isPlatformAdmin ? 'Yöneteceğiniz aktif okulu seçin.' : 'Üyeliğiniz bulunan okulları görüntüleyin.'} onClose={() => setShowSchoolMenu(false)}>
        <div className="space-y-2">{schoolOptions.map((school) => { const disabled = 'disabledAt' in school && !!school.disabledAt; return <button type="button" key={school.id} disabled={disabled} className="w-full text-left flex gap-3 items-center p-3 rounded-xl hover:bg-slate-50 border border-slate-200" onClick={() => { void switchSchool(school.id); setShowSchoolMenu(false); }}><Building2 size={20} className="text-blue-700" /><span className="flex-1 min-w-0"><strong className="block text-sm break-words">{school.name}</strong><span className="text-xs text-slate-500">{school.city}{disabled ? ' · Devre dışı' : isPlatformAdmin ? ' · Yönetilebilir okul' : ' · Üyeliğiniz bulunan okul'}</span></span>{currentSchool?.id === school.id && <Check size={18} className="text-blue-700" />}</button>; })}</div>
        {isPlatformAdmin && !schoolOptions.length && <p className="text-sm text-slate-500">Henüz okul bulunmuyor. İlk okul kaydını Platform Yönetimi alanından oluşturabilirsiniz.</p>}
        {isPlatformAdmin && onManageSchools && <Button variant="secondary" className="w-full mt-5" onClick={() => { setShowSchoolMenu(false); onManageSchools(); }}><Building2 size={18} />Platform Yönetimi</Button>}
        {!isPlatformAdmin && onOpenOnboarding && <Button variant="secondary" className="w-full mt-5" onClick={() => { setShowSchoolMenu(false); onOpenOnboarding(); }}><KeyRound size={18} />Yeni okula katılma hakkında</Button>}
      </Dialog>}
      {showPersonaMenu && <Dialog title="Hesabım" onClose={() => setShowPersonaMenu(false)}>
        <div className="flex gap-4 items-center mb-6"><span className="avatar"><RoleIcon size={22} aria-hidden="true" /></span><div><h3 className="font-bold">{currentUser?.firstName} {currentUser?.lastName}</h3><p className="text-sm text-slate-500">{currentUser?.role ? roleLabel[currentUser.role] : 'Hesabım'} · {currentUser?.phone}</p></div></div>
        <Button variant="secondary" className="w-full mb-3" onClick={() => { setShowPersonaMenu(false); onOpenHelp(); }}><CircleHelp size={18} />Yardım ve Bilgilendirme</Button>
        <Button variant="secondary" className="w-full" onClick={() => { setShowPersonaMenu(false); logout(); }}><LogOut size={18} />Oturumu kapat</Button>
        {onManageSchools && <Button variant="secondary" className="w-full mt-3" onClick={() => { setShowPersonaMenu(false); onManageSchools(); }}><Building2 size={18} />Platform Yönetimi</Button>}
        {import.meta.env.DEV && <details className="mt-6"><summary className="text-xs text-slate-500 cursor-pointer">Yerel test hesapları</summary><div className="space-y-1 mt-3">{DEMO_PERSONAS.map((persona) => <button type="button" key={persona.id} className="w-full text-left p-2 text-sm hover:bg-slate-50 rounded-lg" onClick={() => { void switchUser(persona.id); setShowPersonaMenu(false); }}>{persona.name}<span className="block text-xs text-slate-500">{persona.desc}</span></button>)}</div></details>}
      </Dialog>}
    </header>
  );
};
