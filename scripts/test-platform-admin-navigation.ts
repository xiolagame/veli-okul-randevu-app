import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const navbar = fs.readFileSync('src/components/Navbar.tsx', 'utf8');
const adminView = fs.readFileSync('src/components/AdminView.tsx', 'utf8');
const schoolManagement = fs.readFileSync('src/components/SchoolManagement.tsx', 'utf8');

assert(app.includes('const showPlatformHome = isPlatformAdmin && !platformContextActive && !currentMembership;'));
assert(app.includes("title={platformSchools.length ? 'Yönetilecek okulu seçin' : 'Henüz okul bulunmuyor'}"));
assert(app.includes("openPlatformManagement(platformSchools.length ? 'overview' : 'schools')"));
assert(app.includes("onOpenAdmin={() => { if (isPlatformAdmin) openPlatformManagement('overview'); else setShowAdminModal(true); }}"));
assert(app.includes('setShowAdminModal(true)}>Yönetim panelini aç</Button>'));
assert(app.includes('{!isPlatformAdmin && !currentUser.role && ('));
assert(app.includes('{!isPlatformAdmin && !currentMembership && !platformContextActive && currentSchool && ('));
assert.match(navbar, /\{isPlatformAdmin && <Button[^>]*className="admin-open"/);
assert(!navbar.includes("(isPlatformAdmin || currentUser?.role === 'admin')"));
assert(!navbar.includes('>Yönetim paneli</span>'));
assert(navbar.includes('mobilePush.openNotificationSettings()'));
assert(navbar.includes('Bildirim ayarlarını aç'));
assert(navbar.includes('Bildirim ayarları açılamadı. Cihaz ayarlarından Veli Randevu bildirimlerini açın.'));
assert(navbar.includes('role="alert"'));
assert(navbar.includes("isPlatformAdmin && !schoolOptions.length"));
assert(navbar.includes("!isPlatformAdmin && onOpenOnboarding"));
assert(schoolManagement.includes("initialSection = 'overview'"));
assert(schoolManagement.includes('useState<PlatformManagementSection>(initialSection)'));
assert(schoolManagement.includes('<main id="main-content" className="page-shell platform-management-page">'));
assert(!schoolManagement.includes('return <Dialog wide title="Platform Yönetimi"'));
assert(app.includes('{canManageSchools && showSchoolManagement'));
assert(!app.includes('{canManageSchools && showSchoolManagement && <SchoolManagement'));
assert(!adminView.includes('aria-label="Yönetim panelini kapat"'));
assert(!adminView.includes('event.key === \'Escape\''));
assert(!app.includes('<AdminView onClose='));
assert(schoolManagement.includes('>Platform alanından çık</Button>'));

console.log('Platform Admin navigation, no-school empty state, CTA routing and normal-user separation tests PASS.');
