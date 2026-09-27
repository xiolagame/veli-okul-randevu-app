import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { AuthView } from './components/AuthView';
import { Brand, Button, EmptyState, Skeleton } from './components/ui';
import { ShieldAlert, QrCode, Shield } from 'lucide-react';

const ParentView = lazy(() => import('./components/ParentView').then((module) => ({ default: module.ParentView })));
const TeacherView = lazy(() => import('./components/TeacherView').then((module) => ({ default: module.TeacherView })));
const SecurityView = lazy(() => import('./components/SecurityView').then((module) => ({ default: module.SecurityView })));
const AdminView = lazy(() => import('./components/AdminView').then((module) => ({ default: module.AdminView })));
const SchoolManagement = lazy(() => import('./components/SchoolManagement').then((module) => ({ default: module.SchoolManagement })));
const NotificationsModal = lazy(() => import('./components/NotificationsModal').then((module) => ({ default: module.NotificationsModal })));
const OnboardingModal = lazy(() => import('./components/OnboardingModal').then((module) => ({ default: module.OnboardingModal })));
const AppointmentEmailReview = lazy(() => import('./components/AppointmentEmailReview').then((module) => ({ default: module.AppointmentEmailReview })));

export const AppContent: React.FC = () => {
  const { currentUser, currentSchool, currentMembership, isLoading, isPlatformAdmin, platformContextActive, switchSchool, refreshPlatformSchools } = useApp();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [showSchoolManagement, setShowSchoolManagement] = useState(false);
  const canManageSchools = isPlatformAdmin;

  useEffect(() => {
    setShowAdminModal(currentUser?.role === 'admin');
  }, [currentUser?.id, currentUser?.role]);

  if (isLoading) {
    return <div className="page-shell"><Brand /><div className="mt-10"><Skeleton rows={4} /></div></div>;
  }

  // If not logged in, show the login/register screen
  if (!currentUser) {
    return (
      <>
        <AuthView onOpenOnboarding={() => setShowOnboardingModal(true)} />
        {showOnboardingModal && <Suspense fallback={<div className="page-shell"><Skeleton rows={2} /></div>}>
          <OnboardingModal
            isOpen={showOnboardingModal}
            onClose={() => setShowOnboardingModal(false)}
          />
        </Suspense>}
      </>
    );
  }

  const reviewLink = window.location.hash.match(/^#appointment-review=([^.]*)\.([A-Za-z0-9_-]{43})$/);
  let reviewSchoolId: string | null = null;
  try { if (reviewLink) reviewSchoolId = decodeURIComponent(reviewLink[1]); } catch { reviewSchoolId = null; }
  if (reviewLink && reviewSchoolId) {
    return currentUser.role === 'teacher'
      ? <Suspense fallback={<div className="page-shell"><Skeleton rows={3} /></div>}><AppointmentEmailReview schoolId={reviewSchoolId} token={reviewLink[2]} /></Suspense>
      : <main className="page-shell"><Brand /><div className="surface mt-8"><p>Bu bağlantı öğretmen hesabına özeldir.</p><Button onClick={() => { window.location.href = '/'; }}>Uygulamaya Git</Button></div></main>;
  }

  return (
    <div className="min-h-screen flex flex-col font-sans text-slate-900"><a href="#main-content" className="skip-link">İçeriğe geç</a>
      <Navbar
        onManageSchools={canManageSchools ? () => setShowSchoolManagement(true) : undefined}
        onOpenNotifications={() => setShowNotifications(true)}
        onOpenAdmin={() => setShowAdminModal(true)}
        onOpenOnboarding={() => setShowOnboardingModal(true)}
      />

      {platformContextActive && currentSchool && <div className="platform-context-banner"><span><strong>Platform Yönetimi</strong><span aria-hidden="true"> › </span>{currentSchool.name}</span><Button variant="quiet" onClick={() => { setShowAdminModal(false); setShowSchoolManagement(true); }}>Platform alanına dön</Button></div>}

      {/* Warning banner if user has no membership in currentSchool */}
      {!currentMembership && !platformContextActive && currentSchool && (
        <div className="bg-amber-50 text-amber-900 px-4 py-3 text-sm flex flex-wrap gap-3 items-center justify-between border-b border-amber-200">
          <div className="flex items-center gap-2 max-w-2xl">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>
              <strong>{currentSchool.name}</strong> için aktif üyeliğiniz bulunmuyor. Okul yönetiminizden destek alabilirsiniz.
            </span>
          </div>
          <button
            onClick={() => setShowOnboardingModal(true)}
            className="px-3 py-1 bg-white text-amber-900 font-bold rounded-lg hover:bg-amber-50 transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <QrCode className="w-3.5 h-3.5" />
            Okula katılma bilgisi
          </button>
        </div>
      )}

      <Suspense fallback={<div className="page-shell"><Skeleton rows={4} /></div>}>
      <div className="flex-1">
        {currentUser.role === 'admin' && !showAdminModal && <main id="main-content" className="page-shell"><div className="surface"><EmptyState icon={Shield} title="Okulunuzun yönetim alanı" description="Personeli, veli kayıtlarını ve okul görüşmelerini buradan yönetin." action={<Button onClick={() => setShowAdminModal(true)}>Yönetim panelini aç</Button>} /></div></main>}
        {currentUser.role === 'parent' && <ParentView />}
        {currentUser.role === 'teacher' && <TeacherView />}
        {currentUser.role === 'security' && <SecurityView key={currentSchool?.id} />}
        {!currentUser.role && (
          <div className="max-w-md mx-auto my-16 p-8 bg-white rounded-2xl shadow-md border border-slate-200 text-center space-y-4">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto">
              <QrCode className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-900">Bu Okulda Kayıtlı Değilsiniz</h3>
            <p className="text-xs text-slate-500">
              {currentSchool?.name} Erişim almak için okul yönetiminizden aktivasyon kodu isteyin.
            </p>
            <button
              onClick={() => setShowOnboardingModal(true)}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              Hesap etkinleştirme bilgisi
            </button>
          </div>
        )}
      </div>
      </Suspense>

      <Suspense fallback={<div className="page-shell"><Skeleton rows={2} /></div>}>
      {showNotifications && (
        <NotificationsModal
          onClose={() => setShowNotifications(false)}
        />
      )}

      {showAdminModal && (
        <AdminView onClose={() => setShowAdminModal(false)} onManageSchools={canManageSchools ? () => setShowSchoolManagement(true) : undefined} />
      )}

      {showOnboardingModal && (
        <OnboardingModal
          isOpen={showOnboardingModal}
          onClose={() => setShowOnboardingModal(false)}
        />
      )}
      {canManageSchools && showSchoolManagement && <SchoolManagement onClose={() => setShowSchoolManagement(false)} onChanged={refreshPlatformSchools} onManageSchool={async (schoolId) => { await switchSchool(schoolId); setShowSchoolManagement(false); setShowAdminModal(true); }} />}
      </Suspense>
    </div>
  );
};

export default function App() {
  return <AppContent />;
}
