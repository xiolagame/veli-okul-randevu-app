import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx', 'utf8');
const navbar = fs.readFileSync('src/components/Navbar.tsx', 'utf8');
const schoolManagement = fs.readFileSync('src/components/SchoolManagement.tsx', 'utf8');

assert(app.includes('const showPlatformHome = isPlatformAdmin && !platformContextActive && !currentMembership;'));
assert(app.includes("title={platformSchools.length ? 'Yönetilecek okulu seçin' : 'Henüz okul bulunmuyor'}"));
assert(app.includes("openPlatformManagement(platformSchools.length ? 'overview' : 'schools')"));
assert(app.includes("onOpenAdmin={() => { if (isPlatformAdmin) openPlatformManagement('overview'); else setShowAdminModal(true); }}"));
assert(app.includes('{!isPlatformAdmin && !currentUser.role && ('));
assert(app.includes('{!isPlatformAdmin && !currentMembership && !platformContextActive && currentSchool && ('));
assert(navbar.includes("(isPlatformAdmin || currentUser?.role === 'admin')"));
assert(navbar.includes("isPlatformAdmin ? 'Platform Yönetimi' : 'Yönetim paneli'"));
assert(navbar.includes("isPlatformAdmin && !schoolOptions.length"));
assert(navbar.includes("!isPlatformAdmin && onOpenOnboarding"));
assert(schoolManagement.includes("initialSection = 'overview'"));
assert(schoolManagement.includes('useState<PlatformManagementSection>(initialSection)'));

console.log('Platform Admin navigation, no-school empty state, CTA routing and normal-user separation tests PASS.');
