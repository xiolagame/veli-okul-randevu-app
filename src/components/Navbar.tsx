import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Bell,
  LogOut,
  Shield,
  ChevronDown,
  Check,
  Building2,
  PlusCircle,
  QrCode,
  UserCheck,
} from 'lucide-react';

interface NavbarProps {
  onOpenNotifications: () => void;
  onOpenAdmin: () => void;
  onOpenOnboarding?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenNotifications, onOpenAdmin, onOpenOnboarding }) => {
  const {
    currentUser,
    currentSchool,
    schools,
    userMemberships,
    switchSchool,
    switchUser,
    logout,
    unreadNotificationCount,
  } = useApp();

  const [showSchoolMenu, setShowSchoolMenu] = useState(false);
  const [showPersonaMenu, setShowPersonaMenu] = useState(false);

  const getRoleBadge = (role?: string) => {
    switch (role) {
      case 'parent':
        return <span className="bg-emerald-100 text-emerald-800 text-xs font-semibold px-2 py-0.5 rounded-full">Veli</span>;
      case 'teacher':
        return <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded-full">Öğretmen</span>;
      case 'security':
        return <span className="bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-0.5 rounded-full">Güvenlik</span>;
      case 'admin':
        return <span className="bg-purple-100 text-purple-800 text-xs font-semibold px-2 py-0.5 rounded-full">Yönetici</span>;
      default:
        return null;
    }
  };

  // Test personas list for multi-tenant evaluation
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
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand & Active School Switcher */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-700 to-indigo-800 flex items-center justify-center text-white font-black text-xl shadow-xs">
              V
            </div>

            {/* School Selector Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowSchoolMenu(!showSchoolMenu)}
                className="flex items-center gap-2 text-left p-1.5 -ml-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer group"
                title="Aktif Okulu Değiştir"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-slate-900 tracking-tight text-sm sm:text-base">
                      {currentSchool?.name || 'Okul Seçiniz'}
                    </span>
                    <span className="text-[10px] font-mono bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                      {currentSchool?.code}
                    </span>
                    <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition-colors" />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{currentSchool?.city} / {currentSchool?.district}</span>
                    <span>•</span>
                    <span className="flex items-center gap-1 font-medium text-slate-700">
                      Rol: {getRoleBadge(currentUser?.role)}
                    </span>
                  </div>
                </div>
              </button>

              {showSchoolMenu && (
                <div
                  className="absolute left-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-slate-200 py-2 z-50 animate-in fade-in"
                  onClick={() => setShowSchoolMenu(false)}
                >
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100 flex items-center justify-between">
                    <span>Okul Değiştir</span>
                    <span className="text-emerald-600 font-medium lowercase">multi-tenant</span>
                  </div>

                  <div className="max-h-64 overflow-y-auto py-1">
                    {schools.map((sch) => {
                      const userHasMembership = userMemberships.some((m) => m.schoolId === sch.id);
                      const isSelected = currentSchool?.id === sch.id;

                      return (
                        <button
                          key={sch.id}
                          onClick={() => switchSchool(sch.id)}
                          className={`w-full text-left px-3 py-2.5 text-xs flex items-center justify-between hover:bg-slate-50 transition-colors ${
                            isSelected ? 'bg-blue-50/80 font-semibold border-l-4 border-blue-600' : ''
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <Building2 className={`w-4 h-4 mt-0.5 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`} />
                            <div>
                              <div className="text-slate-900 font-medium flex items-center gap-1.5">
                                {sch.name}
                              </div>
                              <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                                <span className="font-mono bg-slate-100 px-1 rounded">{sch.code}</span>
                                <span>{sch.city}, {sch.district}</span>
                              </div>
                            </div>
                          </div>
                          {isSelected ? (
                            <Check className="w-4 h-4 text-blue-600" />
                          ) : userHasMembership ? (
                            <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">
                              Kayıtlı
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                              Harici
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {onOpenOnboarding && (
                    <div className="border-t border-slate-100 mt-1 pt-1.5 px-2">
                      <button
                        onClick={onOpenOnboarding}
                        className="w-full py-2 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        <QrCode className="w-4 h-4" />
                        Yeni Okula Katıl (QR / Davet Kodu)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Multi-tenant Persona Switcher */}
            <div className="relative">
              <button
                onClick={() => setShowPersonaMenu(!showPersonaMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition-colors border border-slate-200 cursor-pointer"
                title="Test Kullanıcısı Değiştir"
              >
                <UserCheck className="w-3.5 h-3.5 text-blue-600" />
                <span className="hidden lg:inline text-slate-500">Kullanıcı:</span>
                <span className="font-semibold text-slate-900 max-w-[120px] sm:max-w-[150px] truncate">
                  {currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : 'Giriş Yap'}
                </span>
                <ChevronDown className="w-3 h-3 text-slate-500" />
              </button>

              {showPersonaMenu && (
                <div
                  className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 z-50 animate-in fade-in"
                  onClick={() => setShowPersonaMenu(false)}
                >
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    Test Kullanıcıları (Tenant Rolleri)
                  </div>
                  <div className="max-h-80 overflow-y-auto py-1">
                    {DEMO_PERSONAS.map((p) => {
                      const isCurrent = currentUser?.id === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => switchUser(p.id)}
                          className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 transition-colors ${
                            isCurrent ? 'bg-blue-50/70 font-semibold' : ''
                          }`}
                        >
                          <div>
                            <div className="text-slate-900 font-medium flex items-center gap-1.5">
                              {p.name}
                              {getRoleBadge(p.role)}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {p.desc}
                            </div>
                          </div>
                          {isCurrent && <Check className="w-4 h-4 text-blue-700" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Notifications Bell */}
            <button
              onClick={onOpenNotifications}
              className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="Bildirimler"
            >
              <Bell className="w-5 h-5" />
              {unreadNotificationCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-red-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {unreadNotificationCount}
                </span>
              )}
            </button>

            {/* Admin shortcut button if admin */}
            {currentUser?.role === 'admin' && (
              <button
                onClick={onOpenAdmin}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-100 text-purple-800 text-xs font-semibold rounded-lg hover:bg-purple-200 transition-colors cursor-pointer"
              >
                <Shield className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Yönetim Paneli</span>
              </button>
            )}

            {/* Logout */}
            <button
              onClick={logout}
              className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
              title="Oturumu Kapat"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
