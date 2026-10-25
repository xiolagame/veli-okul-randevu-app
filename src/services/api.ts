import {
  School,
  SchoolMembership,
  User,
  TeacherProfile,
  AvailabilitySlot,
  Appointment,
  SecurityQrVerification,
  NotificationItem,
  AuditLogItem,
  SchoolSettings,
  SchoolRosterRecord,
  Student,
  TenantIsolationTestResult,
} from '../types';
import { applyUnauthorizedSessionPolicy, isAuthenticatedApiEndpoint } from '../platform/api-session-policy';
import { ApiError } from '../platform/api-error';
import { authSession } from '../platform/auth-session';
import { getActiveSchoolId, getPlatformTargetSchoolId } from '../platform/client-preferences';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 20_000;

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const requestToken = await authSession.getToken();
  const authenticatedRequestToken = isAuthenticatedApiEndpoint(endpoint) ? requestToken : null;
  const currentSchoolId = getActiveSchoolId();
  const platformTargetSchoolId = getPlatformTargetSchoolId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (authenticatedRequestToken) {
    headers['Authorization'] = `Bearer ${authenticatedRequestToken}`;
  }

  if (currentSchoolId) {
    headers['X-School-Id'] = currentSchoolId;
  }

  const targetScopedEndpoint = platformTargetSchoolId && endpoint.startsWith('/api/schools/')
    ? `/api/platform-target/${encodeURIComponent(platformTargetSchoolId)}${endpoint.slice(4)}`
    : endpoint;
  const url = `${API_BASE_URL}${targetScopedEndpoint}`;
  const abortController = new AbortController();
  let timedOut = false;
  const handleExternalAbort = () => abortController.abort(options.signal?.reason);
  if (options.signal?.aborted) handleExternalAbort();
  else options.signal?.addEventListener('abort', handleExternalAbort, { once: true });
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers,
      signal: abortController.signal,
    });
  } catch (error) {
    if (timedOut) throw new Error('İstek zaman aşımına uğradı. Lütfen bağlantınızı kontrol edip tekrar deneyin.');
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', handleExternalAbort);
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (await applyUnauthorizedSessionPolicy(res.status, endpoint, authenticatedRequestToken, authSession, data.code)) {
      throw new Error('Oturumunuz sona erdi. Lütfen tekrar giriş yapın.');
    }
    throw new ApiError(res.status, data.error || data.message || `İşlem başarısız (HTTP ${res.status})`);
  }

  return data as T;
}

export const api = {
  registerPushDevice: (data: { installationId: string; platform: 'ANDROID' | 'IOS'; provider: 'FCM'; targetKind: 'REGISTRATION_TOKEN'; providerTarget: string; appId: string; registrationGeneration?: number }) =>
    request<{ success: boolean }>('/api/mobile/push/devices', { method: 'POST', body: JSON.stringify(data) }),
  deactivatePushDevice: (installationId: string, registrationGeneration?: number) =>
    request<{ success: boolean }>(`/api/mobile/push/devices/${encodeURIComponent(installationId)}${registrationGeneration === undefined ? '' : `?registrationGeneration=${registrationGeneration}`}`, { method: 'DELETE' }),
  getSchoolInfo: (schoolId: string) => request<{ school: Pick<School, 'id' | 'name' | 'code'> }>(`/api/schools/${schoolId}/info`),
  importRoster: (schoolId: string, records: import('../utils/roster-import').RosterDraft[], preview: boolean) =>
    request<{ rows: import('../utils/roster-import').RosterPreview[]; addedCount: number; skippedCount: number }>(`/api/schools/${schoolId}/roster/bulk-upload`, { method: 'POST', body: JSON.stringify({ records, preview }) }),
  getPlatformCapabilities: () => request<{ manageSchools: boolean }>('/api/platform/capabilities'),
  getManagedSchools: () => request<{ schools: import('../types/platform').ManagedSchool[] }>('/api/platform/schools'),
  createSchool: (data: { name: string; code: string; licenseCode: string; city: string; district: string }) =>
    request<{ school: import('../types/platform').ManagedSchool }>('/api/platform/schools', { method: 'POST', body: JSON.stringify(data) }),
  createSchoolAdminInvitation: (schoolId: string, data: { fullName: string; phone: string; email: string }) =>
    request<{ success: boolean; emailSent: boolean; message: string }>(`/api/platform/schools/${encodeURIComponent(schoolId)}/admin-invitation`, { method: 'POST', body: JSON.stringify(data) }),
  resendSchoolAdminActivation: (schoolId: string) =>
    request<{ success: boolean; emailSent: boolean; message: string }>(`/api/platform/schools/${encodeURIComponent(schoolId)}/admin-invitation/resend`, { method: 'POST' }),
  setSchoolStatus: (id: string, active: boolean) =>
    request<{ success: boolean }>(`/api/platform/schools/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  deleteSchool: (id: string) =>
    request<{ success: boolean; message: string }>(`/api/platform/schools/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updateSchoolCode: (id: string, code: string) =>
    request<{ success: boolean; code: string }>(`/api/platform/schools/${encodeURIComponent(id)}/code`, { method: 'PATCH', body: JSON.stringify({ code }) }),
  getPlatformSecurity: () => request<{ database: 'connected' | 'unavailable'; authConfiguration: 'ready' | 'incomplete'; codeSigning: 'ready' | 'incomplete' }>('/api/platform/security'),
  getPlatformPhoneBindingStatus: () => request<{ whatsappPhoneBound: boolean; emailConfigured: boolean; passwordReauthAvailable: boolean }>('/api/platform/phone-binding'),
  startPlatformEmailBinding: (email: string, password: string) => request<{ success: boolean; bindingId: string; expiresInSeconds: number; message: string }>('/api/platform/email-binding/start', { method: 'POST', body: JSON.stringify({ email, password }) }),
  completePlatformEmailBinding: (bindingId: string, code: string) => request<{ success: boolean; sessionInvalidated: boolean; message: string }>('/api/platform/email-binding/verify', { method: 'POST', body: JSON.stringify({ bindingId, code }) }),
  startPlatformPhoneBinding: (phone: string) => request<{ success: boolean; bindingId: string; expiresInSeconds: number; message: string }>('/api/platform/phone-binding/start', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyPlatformPhoneBindingEmail: (bindingId: string, code: string) => request<{ success: boolean; expiresInSeconds: number; message: string }>('/api/platform/phone-binding/verify-email', { method: 'POST', body: JSON.stringify({ bindingId, code }) }),
  completePlatformPhoneBinding: (bindingId: string, code: string) => request<{ success: boolean; sessionInvalidated: boolean; message: string }>('/api/platform/phone-binding/verify-whatsapp', { method: 'POST', body: JSON.stringify({ bindingId, code }) }),
  getPlatformAuditLogs: () => request<{ logs: { id: string; schoolName: string; actorName: string; action: string; details: string; timestamp: string }[] }>('/api/platform/audit-logs'),
  clearPlatformAuditLogs: () => request<{ success: boolean; deletedCount: number }>('/api/platform/audit-logs', { method: 'DELETE', body: JSON.stringify({ confirmation: 'TEMİZLE' }) }),
  getPlatformUnseenRequestCount: () => request<{ count: number }>('/api/platform/requests/unseen-count'),
  markPlatformRequestsSeen: () => request<{ count: number }>('/api/platform/requests/mark-seen', { method: 'POST' }),
  createPublicRequest: (data: {
    requestToken: string;
    requestType: import('../types/platform').PlatformRequestType;
    schoolName: string;
    contactName: string;
    email?: string;
    phone?: string;
    teacherCount?: number;
    message?: string;
    companyWebsite?: string;
  }) => request<{ ok: boolean; requestId: string; duplicate: boolean; emailNotificationSent: boolean; requesterEmailSent: boolean }>('/api/public/requests', { method: 'POST', body: JSON.stringify(data) }),
  createSchoolRequest: (schoolId: string, data: {
    requestToken: string;
    requestType: 'YEARLY_LICENSE' | 'SUPPORT';
    subject?: string;
    message: string;
  }) => request<{ ok: boolean; requestId: string; duplicate: boolean; emailNotificationSent: boolean; requesterEmailSent: boolean }>(`/api/schools/${schoolId}/requests`, { method: 'POST', body: JSON.stringify(data) }),
  getSchoolRequests: (schoolId: string) => request<{ requests: import('../types/platform').PlatformRequestItem[] }>(`/api/schools/${schoolId}/requests`),
  getSchoolSupportThread: (schoolId: string, requestId: string) =>
    request<import('../types/platform').SupportThread>(`/api/schools/${schoolId}/requests/${encodeURIComponent(requestId)}/messages`),
  sendSchoolSupportMessage: (schoolId: string, requestId: string, data: { requestToken: string; message: string }) =>
    request<{ request: import('../types/platform').PlatformRequestItem; message: import('../types/platform').SupportMessage; duplicate: boolean; emailNotificationSent: boolean }>(
      `/api/schools/${schoolId}/requests/${encodeURIComponent(requestId)}/messages`, { method: 'POST', body: JSON.stringify(data) }),
  hideSchoolSupportRequest: (schoolId: string, requestId: string) =>
    request<{ success: boolean; request: import('../types/platform').PlatformRequestItem }>(
      `/api/schools/${schoolId}/requests/${encodeURIComponent(requestId)}`, { method: 'DELETE' }),
  getPlatformRequests: (filters?: { status?: string; requestType?: string }) => {
    const query = new URLSearchParams();
    if (filters?.status) query.set('status', filters.status);
    if (filters?.requestType) query.set('requestType', filters.requestType);
    return request<{ requests: import('../types/platform').PlatformRequestItem[] }>(`/api/platform/requests${query.size ? `?${query}` : ''}`);
  },
  getPlatformRequest: (id: string) => request<{ request: import('../types/platform').PlatformRequestItem }>(`/api/platform/requests/${encodeURIComponent(id)}`),
  getPlatformSupportThread: (id: string) => request<import('../types/platform').SupportThread>(`/api/platform/requests/${encodeURIComponent(id)}/messages`),
  sendPlatformSupportMessage: (id: string, data: { requestToken: string; message: string }) =>
    request<{ request: import('../types/platform').PlatformRequestItem; message: import('../types/platform').SupportMessage; duplicate: boolean; emailNotificationSent: boolean }>(
      `/api/platform/requests/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify(data) }),
  hidePlatformSupportRequest: (id: string) =>
    request<{ success: boolean; request: import('../types/platform').PlatformRequestItem }>(
      `/api/platform/requests/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updatePlatformRequestStatus: (id: string, status: import('../types/platform').PlatformRequestStatus) =>
    request<{ request: import('../types/platform').PlatformRequestItem }>(`/api/platform/requests/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  getManagedParents: (schoolId: string) => request<{ parents: import('../types/management').ManagedParent[] }>(`/api/schools/${schoolId}/management/parents`),
  getOperationSummary: (schoolId: string) => request<import('../types/operations').OperationSummary>(`/api/schools/${schoolId}/management/operations`),
  getOperationPage: (schoolId: string, category: import('../types/operations').OperationCategory, page = 0, q = '', status = '') =>
    request<import('../types/operations').OperationPage>(`/api/schools/${schoolId}/management/operations/${category}?${new URLSearchParams({ page: String(page), q, status })}`),
  getManagedStudentRecords: (schoolId: string) => request<{ records: import('../utils/student-records').SchoolStudentRecord[]; classBulkDeleteEnabled: boolean }>(`/api/schools/${schoolId}/management/student-records`),
  removePendingStudent: (schoolId: string, id: string) => request<{ success: boolean }>(`/api/schools/${schoolId}/management/student-records/roster/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  previewClassRemoval: (schoolId: string, className: string) => request<{ className: string; studentCount: number; snapshot: string }>(`/api/schools/${schoolId}/management/student-records/class-removal/preview`, { method: 'POST', body: JSON.stringify({ className }) }),
  requestClassRemovalCode: (schoolId: string, className: string, snapshot: string) => request<{ challengeId: string; expiresInSeconds: number }>(`/api/schools/${schoolId}/management/student-records/class-removal/request-code`, { method: 'POST', body: JSON.stringify({ className, snapshot }) }),
  completeClassRemoval: (schoolId: string, className: string, challengeId: string, code: string, confirmation: string) => request<{ success: boolean; removedCount: number }>(`/api/schools/${schoolId}/management/student-records/class-removal/complete`, { method: 'POST', body: JSON.stringify({ className, challengeId, code, confirmation }) }),
  getManagedSchoolAdmins: (schoolId: string) => request<{ admins: import('../types/management').ManagedSchoolAdmin[] }>(`/api/schools/${schoolId}/management/admins`),
  createManagedSchoolAdmin: (schoolId: string, data: { fullName: string; phone: string; email: string }) =>
    request<{ success: boolean; emailSent: boolean; message: string }>(`/api/schools/${schoolId}/management/admins`, { method: 'POST', body: JSON.stringify(data) }),
  updateManagedSchoolAdmin: (schoolId: string, userId: string, data: { fullName: string; phone: string; email: string }) =>
    request<{ success: boolean; invitationRevoked: boolean; message: string }>(`/api/schools/${schoolId}/management/admins/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  removeManagedSchoolAdmin: (schoolId: string, userId: string) =>
    request<{ success: boolean }>(`/api/schools/${schoolId}/management/admins/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  resendManagedSchoolAdminActivation: (schoolId: string, userId: string) =>
    request<{ success: boolean; emailSent: boolean; message: string }>(`/api/schools/${schoolId}/management/admins/${encodeURIComponent(userId)}/resend`, { method: 'POST' }),
  updateManagedRecord: (schoolId: string, kind: string, id: string, data: Record<string, string>) =>
    request<{ success: boolean }>(`/api/schools/${schoolId}/management/${kind}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  removeManagedRecord: (schoolId: string, kind: string, id: string) =>
    request<{ success: boolean }>(`/api/schools/${schoolId}/management/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  previewStudentRemoval: (schoolId: string, studentId: string) =>
    request<{ studentName: string; siblingAccounts: number; preservedAccounts: number; deletedAccounts: number }>(
      `/api/schools/${schoolId}/management/students/${encodeURIComponent(studentId)}/removal`),
  removeStudent: (schoolId: string, studentId: string) =>
    request<{ success: boolean; deletedAccounts: number; preservedAccounts: number }>(
      `/api/schools/${schoolId}/management/students/${encodeURIComponent(studentId)}/removal`, { method: 'DELETE' }),
  getAppointmentEmailReview: (schoolId: string, token: string) =>
    request<{ appointment: { studentName: string; className: string; parentName: string; date: string;
      startTime: string; endTime: string; teacherName: string; status: string; notes?: string } }>(
      `/api/schools/${encodeURIComponent(schoolId)}/appointments/email-review`,
      { headers: { 'X-School-Id': schoolId, 'X-Appointment-Review-Token': token } }),
  approveAppointmentEmailReview: (schoolId: string, token: string) =>
    request<{ success: boolean; message: string }>(
      `/api/schools/${encodeURIComponent(schoolId)}/appointments/email-review/approve`,
      { method: 'POST', headers: { 'X-School-Id': schoolId, 'X-Appointment-Review-Token': token } }),
  clearAuditLogs: (schoolId: string) =>
    request<{ success: boolean }>(`/api/schools/${schoolId}/management/audit-logs`, { method: 'DELETE' }),
  // Public
  getPublicSchools: () => request<{ schools: School[] }>('/api/public/schools'),
  getSchoolContext: (code: string) =>
    request<{ school: School }>(`/api/public/school-context?code=${encodeURIComponent(code)}`),
  getAuthCapabilities: () =>
    request<{ whatsappAuthEnabled: boolean; unifiedLoginEnabled?: boolean; phoneCentricAuthEnabled?: boolean }>('/api/public/auth-capabilities', { cache: 'no-store' }),

  // Authentication
  resetPasswordWithCode: (schoolId: string, phone: string, code: string, password: string) =>
    request<{ success: boolean; message: string }>('/api/auth/reset-password-with-code', {
      method: 'POST',
      body: JSON.stringify({ schoolId, phone, code, password }),
    }),
  parentRegistrationChallenge: (schoolCode: string, phone: string, code: string) =>
    request<{ success: boolean; schoolId: string; challenge: string }>('/api/auth/parent/registration-challenge', { method: 'POST', body: JSON.stringify({ schoolCode, phone, code }) }),
  parentRegistrationComplete: (schoolId: string, phone: string, challenge: string, password: string) =>
    request<{ success: boolean; message: string }>('/api/auth/parent/registration-complete', { method: 'POST', body: JSON.stringify({ schoolId, phone, challenge, password }) }),
  parentResetChallenge: (schoolCode: string, phone: string, code: string) =>
    request<{ success: boolean; schoolId: string; challenge: string }>('/api/auth/parent/reset-challenge', { method: 'POST', body: JSON.stringify({ schoolCode, phone, code }) }),
  parentResetComplete: (schoolId: string, phone: string, challenge: string, password: string) =>
    request<{ success: boolean; message: string }>('/api/auth/parent/reset-complete', { method: 'POST', body: JSON.stringify({ schoolId, phone, challenge, password }) }),
  verifyStaffActivation: (schoolCode: string, phone: string, code: string) =>
    request<{success:boolean;setupToken:string;schoolId:string;role:'teacher'|'security'}>('/api/auth/staff/activation-verify',{method:'POST',body:JSON.stringify({schoolCode,phone,code})}),
  completeStaffActivation: (schoolId:string,phone:string,setupToken:string,password:string) =>
    request<{success:boolean;message:string}>('/api/auth/staff/activation-complete',{method:'POST',body:JSON.stringify({schoolId,phone,setupToken,password})}),
  requestStaffReset: (schoolCode:string,phone:string) =>
    request<{success:boolean;message:string}>('/api/auth/staff/reset-request',{method:'POST',body:JSON.stringify({schoolCode,phone})}),
  verifyStaffReset: (schoolCode:string,phone:string,code:string) =>
    request<{success:boolean;setupToken:string;schoolId:string}>('/api/auth/staff/reset-verify',{method:'POST',body:JSON.stringify({schoolCode,phone,code})}),
  completeStaffReset: (schoolId:string,phone:string,setupToken:string,password:string) =>
    request<{success:boolean;message:string}>('/api/auth/staff/reset-complete',{method:'POST',body:JSON.stringify({schoolId,phone,setupToken,password})}),
  verifySchoolAdminActivation: (schoolCode:string,phone:string,licenseCode:string,code:string) =>
    request<{success:boolean;setupToken:string;schoolId:string}>('/api/auth/school-admin/activation-verify',{method:'POST',body:JSON.stringify({schoolCode,phone,licenseCode,code})}),
  completeSchoolAdminActivation: (schoolId:string,phone:string,setupToken:string,password:string) =>
    request<{success:boolean;message:string}>('/api/auth/school-admin/activation-complete',{method:'POST',body:JSON.stringify({schoolId,phone,setupToken,password})}),
  requestSchoolAdminReset: (schoolCode:string,phone:string) =>
    request<{success:boolean;message:string}>('/api/auth/school-admin/reset-request',{method:'POST',body:JSON.stringify({schoolCode,phone})}),
  verifySchoolAdminReset: (schoolCode:string,phone:string,code:string) =>
    request<{success:boolean;setupToken:string;schoolId:string}>('/api/auth/school-admin/reset-verify',{method:'POST',body:JSON.stringify({schoolCode,phone,code})}),
  completeSchoolAdminReset: (schoolId:string,phone:string,setupToken:string,password:string) =>
    request<{success:boolean;message:string}>('/api/auth/school-admin/reset-complete',{method:'POST',body:JSON.stringify({schoolId,phone,setupToken,password})}),

  login: (phone: string, password: string, role?: string) =>
    request<{
      success: boolean;
      token: string;
      user: User;
      memberships: SchoolMembership[];
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password, role }),
    }),
  requestWhatsappCode: (data: { purpose: 'login' | 'parent_registration' | 'staff_activation' | 'auto'; phone: string; schoolCode?: string }) =>
    request<{ success: boolean; message: string; challengeId: string; expiresInSeconds: number; resendAfterSeconds: number }>(
      '/api/auth/whatsapp/request-code', { method: 'POST', body: JSON.stringify(data) }),
  verifyWhatsappCode: (data: { challengeId: string; phone: string; code: string }) =>
    request<{ success: boolean; token?: string; user?: User; memberships?: SchoolMembership[]; pendingEmail?: boolean; handle?: string; message?: string }>(
      '/api/auth/whatsapp/verify-code', { method: 'POST', body: JSON.stringify(data) }),

  completeUnifiedAdminEmail: (data: { handle: string; phone: string; emailCode: string }) =>
    request<{ success: boolean; token: string; user: User; memberships: SchoolMembership[] }>(
      '/api/auth/whatsapp/complete-admin-email', { method: 'POST', body: JSON.stringify(data) }),

  requestPhoneCentricCode: (phone: string, registration?: { schoolCode: string }) =>
    request<
      | { success: boolean; message: string; legacyFallbackRequired: true }
      | { success: boolean; message: string; legacyFallbackRequired?: false; attemptId: string; challengeId: string; expiresInSeconds: number; resendAfterSeconds: number }
    >(
      '/api/auth/phone/request-code', {
        method: 'POST',
        body: JSON.stringify(registration ? { phone, flow: 'parent_registration', ...registration } : { phone }),
      }),
  verifyPhoneCentricCode: (data: { attemptId: string; challengeId: string; phone: string; code: string }) =>
    request<{ success: boolean; token?: string; user?: User; memberships?: SchoolMembership[]; pendingEmail?: boolean; attemptId?: string; requiresSchoolCode?: boolean; message?: string }>(
      '/api/auth/phone/verify-code', { method: 'POST', body: JSON.stringify(data) }),
  verifyPhoneCentricEmail: (data: { attemptId: string; phone: string; emailCode: string; schoolCode?: string }) =>
    request<{ success: boolean; token: string; user: User; memberships: SchoolMembership[] }>(
      '/api/auth/phone/verify-email', { method: 'POST', body: JSON.stringify(data) }),

  quickSwitch: (userId: string) =>
    request<{
      success: boolean;
      token: string;
      user: User;
      memberships: SchoolMembership[];
    }>('/api/auth/quick-switch', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),

  getMe: () =>
    request<{
      user: User;
      memberships: (SchoolMembership & {
        schoolName: string;
        schoolCode: string;
        city: string;
        district: string;
      })[];
    }>('/api/user/me'),

  requestAccountDeletionWhatsappCode: () =>
    request<{ success: boolean; message: string; challengeId: string; expiresInSeconds: number; resendAfterSeconds: number }>(
      '/api/user/me/deletion/whatsapp-code', { method: 'POST' }),
  deleteOwnAccount: (data: {
    password?: string;
    whatsappChallengeId?: string;
    whatsappCode?: string;
    confirmation: 'HESABIMI SİL';
    requestId: string;
  }) =>
    request<{
      success: true;
      completed: true;
      completedAt: string;
      alreadyCompleted: boolean;
      notificationSent: boolean;
      message: string;
    }>('/api/user/me/deletion', { method: 'POST', body: JSON.stringify(data) }),

  // Onboarding
  checkRoster: (schoolId: string) =>
    request<{
      hasMatch: boolean;
      school: { id: string; name: string };
      parentName: string;
      students: {
        rosterId: string;
        studentName: string;
        className: string;
        studentNumber?: string;
        isClaimed: boolean;
      }[];
    }>('/api/onboarding/check-roster', {
      method: 'POST',
      body: JSON.stringify({ schoolId }),
    }),

  claimStudents: (schoolId: string, firstName?: string, lastName?: string) =>
    request<{
      success: boolean;
      message: string;
      membership: SchoolMembership;
      students: Student[];
      memberships: SchoolMembership[];
    }>('/api/onboarding/claim-students', {
      method: 'POST',
      body: JSON.stringify({ schoolId, firstName, lastName }),
    }),

  // School-scoped
  getSecurityUsers: (schoolId: string) =>
    request<{ users: User[] }>(`/api/schools/${schoolId}/users?role=security`),

  getTeachers: (schoolId: string) =>
    request<{ teachers: TeacherProfile[] }>(`/api/schools/${schoolId}/teachers`),

  createTeacher: (schoolId: string, data: { fullName: string; branch: string; phone: string }) =>
    request<{ teacher: TeacherProfile }>(`/api/schools/${schoolId}/teachers`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  createStaff: (schoolId: string, data: { fullName: string; role: 'teacher' | 'security'; branch?: string; phone: string; email: string }) =>
    request<{ success: boolean; message: string }>(`/api/schools/${schoolId}/staff`, { method: 'POST', body: JSON.stringify(data) }),
  resendStaffActivation: (schoolId: string, role: 'teacher' | 'security', id: string) =>
    request<{ success: boolean; message: string }>(`/api/schools/${schoolId}/staff/${role}/${encodeURIComponent(id)}/resend-activation`, { method: 'POST' }),

  getStudents: (schoolId: string) =>
    request<{ students: Student[] }>(`/api/schools/${schoolId}/students`),

  getAvailability: (schoolId: string) =>
    request<{ availability: AvailabilitySlot[] }>(`/api/schools/${schoolId}/availability`),

  getOccupiedSlots: (schoolId: string, teacherId: string, date: string) =>
    request<{ occupied: { startTime: string; endTime: string }[] }>(
      `/api/schools/${encodeURIComponent(schoolId)}/teachers/${encodeURIComponent(teacherId)}/occupied-slots?date=${encodeURIComponent(date)}`
    ),

  addAvailabilitySlot: (
    schoolId: string,
    slot: { dayOfWeek: number; startTime: string; endTime: string; slotDurationMinutes: number }
  ) =>
    request<{ success: boolean; slot: AvailabilitySlot }>(`/api/schools/${schoolId}/availability`, {
      method: 'POST',
      body: JSON.stringify(slot),
    }),

  removeAvailabilitySlot: (schoolId: string, slotId: string) =>
    request<{ success: boolean }>(`/api/schools/${schoolId}/availability/${slotId}`, {
      method: 'DELETE',
    }),

  getAppointments: (schoolId: string) =>
    request<{ appointments: Appointment[] }>(`/api/schools/${schoolId}/appointments`),

  clearParentHistory: (schoolId: string) =>
    request<{ success: boolean }>(`/api/schools/${schoolId}/appointments/history/clear`, { method: 'POST' }),

  getParentClasses: (schoolId: string) =>
    request<{ classes: string[] }>(`/api/schools/${schoolId}/classes`),

  claimParentStudent: (schoolId: string, student: { name: string; className: string }) =>
    request<{ student: Student }>(`/api/schools/${schoolId}/students/claim`, { method: 'POST', body: JSON.stringify(student) }),

  bookAppointment: (
    schoolId: string,
    data: {
      teacherId: string;
      studentName: string;
      className: string;
      date: string;
      startTime: string;
      endTime: string;
      notes?: string;
    }
  ) =>
    request<{ success: boolean; appointment: Appointment }>(`/api/schools/${schoolId}/appointments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  approveAppointment: (schoolId: string, id: string) =>
    request<{ success: boolean; appointment: Appointment }>(
      `/api/schools/${schoolId}/appointments/${id}/approve`,
      { method: 'POST' }
    ),

  rejectAppointment: (schoolId: string, id: string, reason?: string) =>
    request<{ success: boolean; appointment: Appointment }>(
      `/api/schools/${schoolId}/appointments/${id}/reject`,
      { method: 'POST', body: JSON.stringify({ reason }) }
    ),

  cancelAppointment: (schoolId: string, id: string) =>
    request<{ success: boolean; appointment: Appointment }>(
      `/api/schools/${schoolId}/appointments/${id}/cancel`,
      { method: 'POST' }
    ),

  verifySecurityQr: (schoolId: string, qrToken: string) =>
    request<SecurityQrVerification>(`/api/schools/${schoolId}/security/qr/verify`, {
      method: 'POST', body: JSON.stringify({ qrToken }),
    }),

  getNotifications: (schoolId: string) =>
    request<{ notifications: NotificationItem[] }>(`/api/schools/${schoolId}/notifications`),

  markNotificationsRead: (schoolId: string) =>
    request<{ success: boolean }>(`/api/schools/${schoolId}/notifications/read`, {
      method: 'POST',
    }),

  clearParentNotifications: (schoolId: string) =>
    request<{ success: boolean }>(`/api/schools/${schoolId}/notifications/clear`, { method: 'POST' }),

  deleteNotification: (schoolId: string, notificationId: string) =>
    request<{ success: boolean }>(`/api/schools/${schoolId}/notifications/${encodeURIComponent(notificationId)}`, { method: 'DELETE' }),

  getAuditLogs: (schoolId: string) =>
    request<{ auditLogs: AuditLogItem[] }>(`/api/schools/${schoolId}/audit-logs`),

  getSettings: (schoolId: string) =>
    request<{ settings: SchoolSettings }>(`/api/schools/${schoolId}/settings`),

  updateSettings: (schoolId: string, settings: Partial<SchoolSettings>) =>
    request<{ success: boolean; settings: SchoolSettings }>(`/api/schools/${schoolId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  getRoster: (schoolId: string) =>
    request<{ roster: SchoolRosterRecord[] }>(`/api/schools/${schoolId}/roster`),

  testIsolation: (schoolId: string) =>
    request<{ results: TenantIsolationTestResult[] }>(
      `/api/schools/${schoolId}/security/test-isolation`
    ),
};
