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

let authToken: string | null = localStorage.getItem('veli_auth_token');
let currentSchoolId: string | null = localStorage.getItem('veli_active_school_id');
let platformTargetSchoolId: string | null = localStorage.getItem('veli_platform_target_school_id');

export const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) {
    localStorage.setItem('veli_auth_token', token);
  } else {
    localStorage.removeItem('veli_auth_token');
  }
};

export const getAuthToken = () => authToken;

export const setActiveSchoolId = (schoolId: string | null) => {
  currentSchoolId = schoolId;
  if (schoolId) {
    localStorage.setItem('veli_active_school_id', schoolId);
  } else {
    localStorage.removeItem('veli_active_school_id');
  }
};

export const getActiveSchoolId = () => currentSchoolId;
export const setPlatformTargetSchoolId = (schoolId: string | null) => {
  platformTargetSchoolId = schoolId;
  if (schoolId) localStorage.setItem('veli_platform_target_school_id', schoolId);
  else localStorage.removeItem('veli_platform_target_school_id');
};
export const getPlatformTargetSchoolId = () => platformTargetSchoolId;

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  if (currentSchoolId) {
    headers['X-School-Id'] = currentSchoolId;
  }

  const targetScopedEndpoint = platformTargetSchoolId && endpoint.startsWith('/api/schools/')
    ? `/api/platform-target/${encodeURIComponent(platformTargetSchoolId)}${endpoint.slice(4)}`
    : endpoint;
  const url = `${API_BASE_URL}${targetScopedEndpoint}`;
  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && endpoint !== '/api/auth/login') {
      throw new Error('Oturumunuz sona erdi. Lütfen tekrar giriş yapın.');
    }
    throw new Error(data.error || data.message || `İşlem başarısız (HTTP ${res.status})`);
  }

  return data as T;
}

export const api = {
  getSchoolInfo: (schoolId: string) => request<{ school: Pick<School, 'id' | 'name' | 'code'> }>(`/api/schools/${schoolId}/info`),
  importRoster: (schoolId: string, className: string, records: import('../utils/roster-import').RosterDraft[], preview: boolean) =>
    request<{ rows: import('../utils/roster-import').RosterPreview[]; addedCount: number; skippedCount: number }>(`/api/schools/${schoolId}/roster/bulk-upload`, { method: 'POST', body: JSON.stringify({ className, records, preview }) }),
  getPlatformCapabilities: () => request<{ manageSchools: boolean }>('/api/platform/capabilities'),
  getManagedSchools: () => request<{ schools: import('../types/platform').ManagedSchool[] }>('/api/platform/schools'),
  createSchool: (data: { name: string; code: string; city: string; district: string }) =>
    request<{ school: import('../types/platform').ManagedSchool }>('/api/platform/schools', { method: 'POST', body: JSON.stringify(data) }),
  createSchoolAdminInvitation: (schoolId: string, data: { fullName: string; phone: string; email: string }) =>
    request<{ success: boolean; emailSent: boolean; message: string }>(`/api/platform/schools/${encodeURIComponent(schoolId)}/admin-invitation`, { method: 'POST', body: JSON.stringify(data) }),
  resendSchoolAdminActivation: (schoolId: string) =>
    request<{ success: boolean; emailSent: boolean; message: string }>(`/api/platform/schools/${encodeURIComponent(schoolId)}/admin-invitation/resend`, { method: 'POST' }),
  setSchoolStatus: (id: string, active: boolean) =>
    request<{ success: boolean }>(`/api/platform/schools/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  updateSchoolCode: (id: string, code: string) =>
    request<{ success: boolean; code: string }>(`/api/platform/schools/${encodeURIComponent(id)}/code`, { method: 'PATCH', body: JSON.stringify({ code }) }),
  getPlatformSecurity: () => request<{ database: 'connected' | 'unavailable'; authConfiguration: 'ready' | 'incomplete'; codeSigning: 'ready' | 'incomplete' }>('/api/platform/security'),
  getPlatformAuditLogs: () => request<{ logs: { id: string; schoolName: string; actorName: string; action: string; details: string; timestamp: string }[] }>('/api/platform/audit-logs'),
  getManagedParents: (schoolId: string) => request<{ parents: import('../types/management').ManagedParent[] }>(`/api/schools/${schoolId}/management/parents`),
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
      startTime: string; endTime: string; teacherName: string; status: string } }>(
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

  // Authentication
  activateAccount: (schoolId: string, phone: string, code: string, password: string) =>
    request<{ success: boolean; message: string }>('/api/auth/activate-account', {
      method: 'POST',
      body: JSON.stringify({ schoolId, phone, code, password }),
    }),

  resetPasswordWithCode: (schoolId: string, phone: string, code: string, password: string) =>
    request<{ success: boolean; message: string }>('/api/auth/reset-password-with-code', {
      method: 'POST',
      body: JSON.stringify({ schoolId, phone, code, password }),
    }),
  parentRegistrationChallenge: (schoolCode: string, phone: string, birthDate: string) =>
    request<{ success: boolean; schoolId: string; challenge: string }>('/api/auth/parent/registration-challenge', { method: 'POST', body: JSON.stringify({ schoolCode, phone, birthDate }) }),
  parentRegistrationComplete: (schoolId: string, phone: string, birthDate: string, challenge: string, password: string) =>
    request<{ success: boolean; message: string }>('/api/auth/parent/registration-complete', { method: 'POST', body: JSON.stringify({ schoolId, phone, birthDate, challenge, password }) }),
  parentResetChallenge: (schoolCode: string, phone: string, birthDate: string) =>
    request<{ success: boolean; schoolId: string; challenge: string }>('/api/auth/parent/reset-challenge', { method: 'POST', body: JSON.stringify({ schoolCode, phone, birthDate }) }),
  parentResetComplete: (schoolId: string, phone: string, birthDate: string, challenge: string, password: string) =>
    request<{ success: boolean; message: string }>('/api/auth/parent/reset-complete', { method: 'POST', body: JSON.stringify({ schoolId, phone, birthDate, challenge, password }) }),
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
  verifySchoolAdminActivation: (schoolCode:string,phone:string,code:string) =>
    request<{success:boolean;setupToken:string;schoolId:string}>('/api/auth/school-admin/activation-verify',{method:'POST',body:JSON.stringify({schoolCode,phone,code})}),
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

  checkInVisitor: (schoolId: string, qrToken: string) =>
    request<SecurityQrVerification & { appointment?: Appointment }>(
      `/api/schools/${schoolId}/security/check-in`,
      { method: 'POST', body: JSON.stringify({ qrToken }) }
    ),

  checkOutVisitor: (schoolId: string, appointmentId: string) =>
    request<{ success: boolean; appointment: Appointment }>(
      `/api/schools/${schoolId}/security/check-out`,
      { method: 'POST', body: JSON.stringify({ appointmentId }) }
    ),

  getNotifications: (schoolId: string) =>
    request<{ notifications: NotificationItem[] }>(`/api/schools/${schoolId}/notifications`),

  markNotificationsRead: (schoolId: string) =>
    request<{ success: boolean }>(`/api/schools/${schoolId}/notifications/read`, {
      method: 'POST',
    }),

  clearParentNotifications: (schoolId: string) =>
    request<{ success: boolean }>(`/api/schools/${schoolId}/notifications/clear`, { method: 'POST' }),

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

  createAuthCode: (schoolId: string, rosterId: string, purpose: 'ACCOUNT_ACTIVATION' | 'PASSWORD_RESET', target?: { type: 'teacher' | 'security'; id: string }) =>
    request<{ success: boolean; code: string; purpose: string; expiresAt: string }>(`/api/schools/${schoolId}/auth-codes`, {
      method: 'POST',
      body: JSON.stringify({ rosterId: target ? undefined : rosterId, purpose, targetType: target?.type, targetId: target?.id }),
    }),

  testIsolation: (schoolId: string) =>
    request<{ results: TenantIsolationTestResult[] }>(
      `/api/schools/${schoolId}/security/test-isolation`
    ),
};
