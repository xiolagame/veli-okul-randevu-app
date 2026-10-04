import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useApp } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { AuthView } from './components/AuthView';
import { Brand, Button, EmptyState, Skeleton } from './components/ui';
import { Building2, ShieldAlert, QrCode, Shield } from 'lucide-react';
import { HELP_PATH, isHelpPath, LEGACY_HELP_SUPPORT_PATH, PUBLIC_CONTACT_PATH, PUBLIC_REQUEST_PATH } from './utils/public-request-route';
import { api } from './services/api';
import { pendingNavigationIntent } from './platform/navigation-intent';
import { AppointmentNavigationResolver } from './platform/appointment-navigation';
import { authSession } from './platform/auth-session';
import { hasBackHandler, invokeBackHandler } from './platform/back-navigation';
import { subscribeToNativeBackNavigation } from './platform/native-back-navigation';
import { androidPush } from './platform/android-push';

const ParentView = lazy(() => import('./components/ParentView').then((module) => ({ default: module.ParentView })));
const TeacherView = lazy(() => import('./components/TeacherView').then((module) => ({ default: module.TeacherView })));
const SecurityView = lazy(() => import('./components/SecurityView').then((module) => ({ default: module.SecurityView })));
const AdminView = lazy(() => import('./components/AdminView').then((module) => ({ default: module.AdminView })));
const SchoolManagement = lazy(() => import('./components/SchoolManagement').then((module) => ({ default: module.SchoolManagement })));
const NotificationsModal = lazy(() => import('./components/NotificationsModal').then((module) => ({ default: module.NotificationsModal })));
const OnboardingModal = lazy(() => import('./components/OnboardingModal').then((module) => ({ default: module.OnboardingModal })));
const AppointmentEmailReview = lazy(() => import('./components/AppointmentEmailReview').then((module) => ({ default: module.AppointmentEmailReview })));
const PublicRequestPage = lazy(() => import('./components/PublicRequestPage').then((module) => ({ default: module.PublicRequestPage })));
const HelpCenterPage = lazy(() => import('./components/HelpCenterPage').then((module) => ({ default: module.HelpCenterPage })));

export const AppContent: React.FC = () => {
  const { currentUser, currentSchool, currentMembership, userMemberships, schools, isLoading, isPlatformAdmin, platformContextActive, platformSchools, switchSchool, refreshPlatformSchools, refreshMobileData } = useApp();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [showSchoolManagement, setShowSchoolManagement] = useState(false);
  const [platformManagementSection, setPlatformManagementSection] = useState<'overview' | 'schools'>('overview');
  const [appLocation, setAppLocation] = useState(() => window.location.pathname + window.location.search);
  const [pushAppointmentIntent, setPushAppointmentIntent] = useState<{ id: string; sequence: number } | null>(null);
  const appointmentNavigation = useRef(new AppointmentNavigationResolver());
  const nativeBackUi = useRef({ showNotifications: false, showAdminModal: false, showOnboardingModal: false, showSchoolManagement: false, pathname: '/' });
  const sessionKey = `${currentUser?.id || ''}:${currentSchool?.id || ''}:${currentMembership?.id || ''}`;
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;
  const pathname = appLocation.split('?')[0];
  const canManageSchools = isPlatformAdmin;
  const showPlatformHome = isPlatformAdmin && !platformContextActive && !currentMembership;
  const openPlatformManagement = (section: 'overview' | 'schools' = 'overview') => {
    setPlatformManagementSection(section);
    setShowAdminModal(false);
    setShowSchoolManagement(true);
  };

  useEffect(() => {
    setShowAdminModal(currentUser?.role === 'admin' && (!isPlatformAdmin || platformContextActive || !!currentMembership));
  }, [currentUser?.id, currentUser?.role, currentMembership?.id, isPlatformAdmin, platformContextActive]);

  useEffect(() => { setPushAppointmentIntent(null); }, [currentUser?.id, currentSchool?.id]);

  useEffect(() => {
    if (isLoading || !currentUser || !currentSchool || isPlatformAdmin || !['parent', 'teacher'].includes(currentMembership?.role || '')) return;
    const schoolId = currentSchool.id;
    const resolverSessionKey = sessionKey;
    const accessibleSchoolIds = userMemberships
      .filter((membership) => membership.status === 'active'
        && ['parent', 'teacher'].includes(membership.role)
        && schools.some((school) => school.id === membership.schoolId))
      .map((membership) => membership.schoolId);
    const handleIntent = () => {
      const intent = pendingNavigationIntent.peek();
      if (!intent) return;
      if (intent.type === 'NOTIFICATIONS') {
        pendingNavigationIntent.consume(intent);
        setShowNotifications(true);
      } else if (intent.type === 'APPOINTMENT') {
        void appointmentNavigation.current.resolve({
          store: pendingNavigationIntent,
          currentSchoolId: schoolId,
          accessibleSchoolIds,
          getAppointmentIds: async (candidateSchoolId) => (await api.getAppointments(candidateSchoolId)).appointments.map((appointment) => appointment.id),
          switchSchool,
          isCurrent: () => sessionKeyRef.current === resolverSessionKey,
          navigate: async (appointmentId) => {
            await refreshMobileData();
            setPushAppointmentIntent((previous) => ({ id: appointmentId, sequence: (previous?.sequence || 0) + 1 }));
          },
        }).catch(() => {});
      } else {
        pendingNavigationIntent.consume(intent);
      }
    };
    handleIntent();
    window.addEventListener('veli:navigation-intent', handleIntent);
    return () => window.removeEventListener('veli:navigation-intent', handleIntent);
  }, [isLoading, currentUser?.id, currentSchool?.id, currentMembership?.id, currentMembership?.role,
    isPlatformAdmin, userMemberships, schools]);

  useEffect(() => {
    const syncLocation = () => setAppLocation(window.location.pathname + window.location.search);
    window.addEventListener('popstate', syncLocation);
    return () => window.removeEventListener('popstate', syncLocation);
  }, []);

  useEffect(() => {
    if (pathname !== LEGACY_HELP_SUPPORT_PATH) return;
    window.history.replaceState({ standalonePage: true }, '', PUBLIC_CONTACT_PATH);
    setAppLocation(PUBLIC_CONTACT_PATH);
  }, [pathname]);

  const navigateStandalonePage = (path: string) => {
    const nextPathname = path.split('?')[0];
    window.history.pushState({ standalonePage: true, helpGuidePage: isHelpPath(nextPathname) && nextPathname !== HELP_PATH }, '', path);
    setAppLocation(path);
  };

  const closeStandalonePage = () => {
    window.history.replaceState(null, '', '/');
    setAppLocation('/');
  };

  nativeBackUi.current = { showNotifications, showAdminModal, showOnboardingModal, showSchoolManagement, pathname };

  useEffect(() => {
    void androidPush.startNavigationCapture(() => authSession.getToken()).catch(() => {});
    return () => { void androidPush.stopNavigationCapture(); };
  }, []);

  useEffect(() => subscribeToNativeBackNavigation(
    () => ({
      hasOpenModal: hasBackHandler() || nativeBackUi.current.showNotifications || nativeBackUi.current.showAdminModal || nativeBackUi.current.showOnboardingModal,
      hasOpenDetail: nativeBackUi.current.showSchoolManagement || nativeBackUi.current.pathname !== '/',
      hasSecondaryRoleView: false,
    }),
    (decision) => {
      if (decision === 'CLOSE_MODAL') {
        if (invokeBackHandler()) return;
        if (nativeBackUi.current.showNotifications) setShowNotifications(false);
        else if (nativeBackUi.current.showOnboardingModal) setShowOnboardingModal(false);
        else if (nativeBackUi.current.showAdminModal) setShowAdminModal(false);
      } else if (decision === 'BACK_TO_LIST') {
        if (nativeBackUi.current.showSchoolManagement) setShowSchoolManagement(false);
        else closeStandalonePage();
      }
    },
  ), []);

  const backToHelpCenter = () => {
    if (window.history.state?.helpGuidePage) {
      window.history.back();
      return;
    }
    window.history.replaceState({ standalonePage: true }, '', HELP_PATH);
    setAppLocation(HELP_PATH);
  };

  if (isLoading) {
    return <div className="page-shell"><Brand /><div className="mt-10"><Skeleton rows={4} /></div></div>;
  }

  if (pathname === PUBLIC_REQUEST_PATH) {
    return <Suspense fallback={<div className="page-shell"><Skeleton rows={4} /></div>}><PublicRequestPage onBack={closeStandalonePage} backLabel={currentUser ? 'Uygulamaya dön' : 'Giriş ekranına dön'} /></Suspense>;
  }

  if (pathname === LEGACY_HELP_SUPPORT_PATH) {
    return <div className="page-shell"><Skeleton rows={3} /></div>;
  }

  // If not logged in, show the login/register screen
  if (!currentUser) {
    if (isHelpPath(pathname)) {
      return <Suspense fallback={<div className="page-shell"><Skeleton rows={4} /></div>}><HelpCenterPage pathname={pathname} isAuthenticated={false} onBack={closeStandalonePage} onGuideBack={backToHelpCenter} onNavigate={navigateStandalonePage} /></Suspense>;
    }
    return (
      <>
        <AuthView onOpenOnboarding={() => setShowOnboardingModal(true)} onOpenPublicRequest={() => navigateStandalonePage(PUBLIC_REQUEST_PATH)} onOpenHelp={() => navigateStandalonePage(HELP_PATH)} />
        {showOnboardingModal && <Suspense fallback={<div className="page-shell"><Skeleton rows={2} /></div>}>
          <OnboardingModal
            isOpen={showOnboardingModal}
            onClose={() => setShowOnboardingModal(false)}
          />
        </Suspense>}
      </>
    );
  }

  if (isHelpPath(pathname)) {
    return <Suspense fallback={<div className="page-shell"><Skeleton rows={4} /></div>}><HelpCenterPage pathname={pathname} isAuthenticated isPlatformAdmin={isPlatformAdmin} onBack={closeStandalonePage} onGuideBack={backToHelpCenter} onNavigate={navigateStandalonePage} /></Suspense>;
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
        onManageSchools={canManageSchools ? () => openPlatformManagement('overview') : undefined}
        onOpenNotifications={() => setShowNotifications(true)}
        onOpenAdmin={() => { if (isPlatformAdmin) openPlatformManagement('overview'); else setShowAdminModal(true); }}
        onOpenOnboarding={() => setShowOnboardingModal(true)}
        onOpenHelp={() => navigateStandalonePage(HELP_PATH)}
      />

      {platformContextActive && currentSchool && !showSchoolManagement && <div className="platform-context-banner"><span><strong>Platform Yönetimi</strong><span aria-hidden="true"> › </span>{currentSchool.name}</span><Button variant="quiet" onClick={() => openPlatformManagement('overview')}>Platform alanına dön</Button></div>}

      {/* Warning banner if user has no membership in currentSchool */}
      {!isPlatformAdmin && !currentMembership && !platformContextActive && currentSchool && (
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
        {canManageSchools && showSchoolManagement
          ? <SchoolManagement initialSection={platformManagementSection} onClose={() => setShowSchoolManagement(false)} onChanged={refreshPlatformSchools} onManageSchool={async (schoolId) => { await switchSchool(schoolId); setShowSchoolManagement(false); setShowAdminModal(true); }} />
          : <>
        {showPlatformHome && <main id="main-content" className="page-shell"><div className="surface"><EmptyState icon={Building2} title={platformSchools.length ? 'Yönetilecek okulu seçin' : 'Henüz okul bulunmuyor'} description={platformSchools.length ? 'Okul seçmek veya platform ayarlarını yönetmek için Platform Yönetimi alanını açın.' : 'Platformu kullanmaya başlamak için ilk okul kaydını oluşturun.'} action={<Button onClick={() => openPlatformManagement(platformSchools.length ? 'overview' : 'schools')}>{platformSchools.length ? 'Platform Yönetimi' : 'Yeni Okul Oluştur'}</Button>} /></div></main>}
        {!showPlatformHome && currentUser.role === 'admin' && !showAdminModal && <main id="main-content" className="page-shell"><div className="surface"><EmptyState icon={Shield} title="Okulunuzun yönetim alanı" description="Personeli, veli kayıtlarını ve okul görüşmelerini buradan yönetin." action={<Button onClick={() => setShowAdminModal(true)}>Yönetim panelini aç</Button>} /></div></main>}
        {currentUser.role === 'parent' && <ParentView pushAppointmentIntent={pushAppointmentIntent} />}
        {currentUser.role === 'teacher' && <TeacherView pushAppointmentIntent={pushAppointmentIntent} />}
        {currentUser.role === 'security' && <SecurityView key={currentSchool?.id} />}
        {!isPlatformAdmin && !currentUser.role && (
          <div className="max-w-md mx-auto my-16 p-8 bg-white rounded-2xl shadow-md border border-slate-200 text-center space-y-4">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto">
              <QrCode className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-900">Aktif Okul Erişimi Bulunamadı</h3>
            <p className="text-xs text-slate-500">
              Erişim için okul yönetiminizle iletişime geçin.
            </p>
            <button
              onClick={() => setShowOnboardingModal(true)}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
            >
              Hesap etkinleştirme bilgisi
            </button>
          </div>
        )}</>}
      </div>
      </Suspense>

      <Suspense fallback={<div className="page-shell"><Skeleton rows={2} /></div>}>
      {showNotifications && (
        <NotificationsModal
          onClose={() => setShowNotifications(false)}
        />
      )}

      {showAdminModal && (
        <AdminView onClose={() => setShowAdminModal(false)} onManageSchools={canManageSchools ? () => openPlatformManagement('overview') : undefined} />
      )}

      {showOnboardingModal && (
        <OnboardingModal
          isOpen={showOnboardingModal}
          onClose={() => setShowOnboardingModal(false)}
        />
      )}
      </Suspense>
    </div>
  );
};

export default function App() {
  return <AppContent />;
}
