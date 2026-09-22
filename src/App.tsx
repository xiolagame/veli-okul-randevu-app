import React, { useState } from 'react';
import { useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { AuthView } from './components/AuthView';
import { ParentView } from './components/ParentView';
import { TeacherView } from './components/TeacherView';
import { SecurityView } from './components/SecurityView';
import { AdminView } from './components/AdminView';
import { NotificationsModal } from './components/NotificationsModal';
import { OnboardingModal } from './components/OnboardingModal';
import { ShieldAlert, QrCode } from 'lucide-react';

export const AppContent: React.FC = () => {
  const { currentUser, currentSchool, currentMembership } = useApp();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

  // If not logged in, show the login/register screen
  if (!currentUser) {
    return (
      <>
        <AuthView onOpenOnboarding={() => setShowOnboardingModal(true)} />
        {showOnboardingModal && (
          <OnboardingModal
            isOpen={showOnboardingModal}
            onClose={() => setShowOnboardingModal(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <Navbar
        onOpenNotifications={() => setShowNotifications(true)}
        onOpenAdmin={() => setShowAdminModal(true)}
        onOpenOnboarding={() => setShowOnboardingModal(true)}
      />

      {/* Warning banner if user has no membership in currentSchool */}
      {!currentMembership && currentSchool && (
        <div className="bg-amber-500 text-white px-4 py-2.5 text-xs flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2 max-w-2xl">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>
              <strong>{currentSchool.name}</strong> için henüz aktif bir üyeliğiniz bulunmamaktadır (Tenant İzolasyon Koruması).
            </span>
          </div>
          <button
            onClick={() => setShowOnboardingModal(true)}
            className="px-3 py-1 bg-white text-amber-900 font-bold rounded-lg hover:bg-amber-50 transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <QrCode className="w-3.5 h-3.5" />
            Okula Katıl (Onboarding)
          </button>
        </div>
      )}

      <div className="flex-1">
        {currentUser.role === 'parent' && <ParentView />}
        {currentUser.role === 'teacher' && <TeacherView />}
        {currentUser.role === 'security' && <SecurityView />}
        {currentUser.role === 'admin' && (
          <div className="max-w-7xl mx-auto px-4 py-8">
            <AdminView onClose={() => {}} />
          </div>
        )}
        {!currentUser.role && (
          <div className="max-w-md mx-auto my-16 p-8 bg-white rounded-2xl shadow-md border border-slate-200 text-center space-y-4">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto">
              <QrCode className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-900">Bu Okulda Kayıtlı Değilsiniz</h3>
            <p className="text-xs text-slate-500">
              {currentSchool?.name} bünyesinde işlem yapabilmek için okul davet kodu / QR ile kütük eşleştirmesini tamamlamanız gerekmektedir.
            </p>
            <button
              onClick={() => setShowOnboardingModal(true)}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              Kütük Eşleştirmesi ile Okula Katıl
            </button>
          </div>
        )}
      </div>

      {showNotifications && (
        <NotificationsModal
          onClose={() => setShowNotifications(false)}
        />
      )}

      {showAdminModal && (
        <AdminView onClose={() => setShowAdminModal(false)} />
      )}

      {showOnboardingModal && (
        <OnboardingModal
          isOpen={showOnboardingModal}
          onClose={() => setShowOnboardingModal(false)}
        />
      )}
    </div>
  );
};

export default function App() {
  return <AppContent />;
}
