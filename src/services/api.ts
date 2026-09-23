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

  const url = `${API_BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || data.message || `İşlem başarısız (HTTP ${res.status})`);
  }

  return data as T;
}

export const api = {
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
  getTeachers: (schoolId: string) =>
    request<{ teachers: TeacherProfile[] }>(`/api/schools/${schoolId}/teachers`),

  getStudents: (schoolId: string) =>
    request<{ students: Student[] }>(`/api/schools/${schoolId}/students`),

  getAvailability: (schoolId: string) =>
    request<{ availability: AvailabilitySlot[] }>(`/api/schools/${schoolId}/availability`),

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

  uploadRoster: (schoolId: string, records: Partial<SchoolRosterRecord>[]) =>
    request<{ success: boolean; addedCount: number }>(`/api/schools/${schoolId}/roster/bulk-upload`, {
      method: 'POST',
      body: JSON.stringify({ records }),
    }),

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
