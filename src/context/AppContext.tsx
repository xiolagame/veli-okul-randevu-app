import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  User,
  Student,
  TeacherProfile,
  AvailabilitySlot,
  Appointment,
  NotificationItem,
  SchoolSettings,
  AuditLogItem,
  UserRole,
  School,
  SchoolMembership,
  SchoolRosterRecord,
  TenantIsolationTestResult,
  SecurityQrVerification,
} from '../types';
import { api } from '../services/api';
import { ManagedSchool } from '../types/platform';
import { authSession } from '../platform/auth-session';
import { clearAuthSensitivePreferences, getActiveSchoolId, getPlatformTargetSchoolId, setActiveSchoolId, setPlatformTargetSchoolId } from '../platform/client-preferences';
import { LoginResult, performLogin } from '../platform/login-flow';
import { mobilePush } from '../platform/mobile-push';
import { pendingNavigationIntent } from '../platform/navigation-intent';
import { resolveSchoolContext, SchoolResolution } from '../platform/school-resolution';
import { networkHint } from '../platform/network';
import { loadVerifiedSessionPrerequisites, restoreExistingSession, SessionRestoreResult } from '../platform/session-restore';
import { appLifecycle } from '../platform/lifecycle';

interface AppContextType {
  refreshSchoolData: () => Promise<void>;
  refreshMobileData: () => Promise<void>;
  refreshPlatformSchools: () => Promise<void>;
  currentUser: User | null;
  users: User[];
  usersLoading: boolean;
  usersError: string;
  schools: School[];
  platformSchools: ManagedSchool[];
  isPlatformAdmin: boolean;
  platformContextActive: boolean;
  currentSchool: School | null;
  userMemberships: SchoolMembership[];
  currentMembership: SchoolMembership | null;
  teachers: TeacherProfile[];
  availability: AvailabilitySlot[];
  appointments: Appointment[];
  notifications: NotificationItem[];
  settings: SchoolSettings;
  auditLogs: AuditLogItem[];
  roster: SchoolRosterRecord[];
  isolationTestResults: TenantIsolationTestResult[];
  unreadNotificationCount: number;
  isLoading: boolean;
  authStorageError: boolean;
  accountDeletionNotice: string | null;
  switchSchool: (schoolId: string) => Promise<void>;
  returnToPlatform: () => Promise<void>;
  login: (phone: string, password: string, role?: UserRole) => Promise<LoginResult>;
  logout: () => Promise<void>;
  deleteAccount: (data: { password: string; confirmation: 'HESABIMI SİL'; requestId: string }) => Promise<void>;
  switchUser: (userId: string) => Promise<void>;
  bookAppointment: (data: {
    teacherId: string;
    studentName: string;
    className: string;
    date: string;
    startTime: string;
    endTime: string;
    notes?: string;
  }) => Promise<Appointment>;
  approveAppointment: (appointmentId: string) => Promise<void>;
  rejectAppointment: (appointmentId: string, reason?: string) => Promise<void>;
  cancelAppointment: (appointmentId: string) => Promise<void>;
  verifySecurityQr: (qrToken: string) => Promise<SecurityQrVerification>;
  addAvailabilitySlot: (slot: Omit<AvailabilitySlot, 'id' | 'teacherId'>) => Promise<void>;
  createTeacher: (data: { fullName: string; role: 'teacher' | 'security'; branch?: string; phone: string; email: string }) => Promise<unknown>;
  removeAvailabilitySlot: (slotId: string) => Promise<void>;
  markNotificationsAsRead: () => Promise<void>;
  clearParentNotifications: () => Promise<void>;
  clearParentHistory: () => Promise<void>;
  getParentClasses: () => Promise<string[]>;
  updateSettings: (newSettings: Partial<SchoolSettings>) => Promise<void>;
  addStudentToProfile: (student: { name: string; className: string }) => Promise<void>;
  removeStudentFromProfile: (studentId: string) => void;
  runIsolationTests: () => Promise<TenantIsolationTestResult[]>;
}

const DEFAULT_SETTINGS: SchoolSettings = {
  schoolName: 'Kahramankazan Şehit Ömer Takdemir Ortaokulu',
  appName: 'Veli Randevu',
  defaultSlotMinutes: 15,
  minSlotMinutes: 10,
  maxBookingDaysAhead: 30,
  allowParentCancel: true,
};

const asSchool = (school: ManagedSchool): School => ({ ...school, settings: DEFAULT_SETTINGS });

type SchoolAccess = {
  schools: School[];
  managedSchools: ManagedSchool[];
  isPlatformAdmin: boolean;
  resolution: SchoolResolution;
};

function recordStartupDuration(stage: 'secure-storage' | 'me' | 'school-access' | 'first-school-data', started: number): void {
  try { performance.measure(`veli.startup.${stage}`, { start: started, end: performance.now() }); }
  catch { /* Diagnostics must not affect authentication. */ }
}

function fetchSchoolAccessBase() {
  return Promise.all([api.getPublicSchools(), api.getPlatformCapabilities()]);
}

async function fetchSchoolAccess(
  memberships: SchoolMembership[],
  preferredSchoolId: string | null,
  preferredPlatformTargetId: string | null,
  baseRequest = fetchSchoolAccessBase(),
): Promise<SchoolAccess> {
  const [schoolsResult, capabilities] = await baseRequest;
  const managedSchools = capabilities.manageSchools ? (await api.getManagedSchools()).schools : [];
  return {
    schools: schoolsResult.schools,
    managedSchools,
    isPlatformAdmin: capabilities.manageSchools,
    resolution: resolveSchoolContext({
      memberships,
      accessibleSchools: schoolsResult.schools,
      managedSchools,
      isPlatformAdmin: capabilities.manageSchools,
      preferredSchoolId,
      preferredPlatformTargetId,
    }),
  };
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const schoolLoadSequence = useRef(0);
  const firstSchoolLoadMeasured = useRef(false);
  const [schools, setSchools] = useState<School[]>([]);
  const [platformSchools, setPlatformSchools] = useState<ManagedSchool[]>([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [currentSchool, setCurrentSchool] = useState<School | null>(null);
  const [userMemberships, setUserMemberships] = useState<SchoolMembership[]>([]);
  const [currentMembership, setCurrentMembership] = useState<SchoolMembership | null>(null);

  const [teachers, setTeachers] = useState<TeacherProfile[]>([]);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [settings, setSettings] = useState<SchoolSettings>(DEFAULT_SETTINGS);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [roster, setRoster] = useState<SchoolRosterRecord[]>([]);
  const [isolationTestResults, setIsolationTestResults] = useState<TenantIsolationTestResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [authStorageError, setAuthStorageError] = useState(false);
  const [accountDeletionNotice, setAccountDeletionNotice] = useState<string | null>(null);
  const sessionRestore = useRef<Promise<SessionRestoreResult> | null>(null);
  const platformContextActive = !!getPlatformTargetSchoolId() && isPlatformAdmin;

  const clearRuntimeSession = useCallback(() => {
    schoolLoadSequence.current += 1;
    clearAuthSensitivePreferences();
    setUsers([]);
    setUsersError('');
    setUsersLoading(false);
    setCurrentUser(null);
    setIsPlatformAdmin(false);
    setPlatformSchools([]);
    setSchools([]);
    setCurrentSchool(null);
    setUserMemberships([]);
    setCurrentMembership(null);
    setTeachers([]);
    setAvailability([]);
    setAppointments([]);
    setNotifications([]);
    setSettings(DEFAULT_SETTINGS);
    setAuditLogs([]);
    setRoster([]);
    setIsolationTestResults([]);
  }, []);

  useEffect(() => authSession.subscribe(() => {
    pendingNavigationIntent.clear();
    void mobilePush.afterSessionInvalidated();
    clearRuntimeSession();
  }), [clearRuntimeSession]);

  // Load School-scoped data whenever active school or membership changes
  const loadSchoolData = useCallback(async (schoolId: string, user: User | null, membership: SchoolMembership | null, platformContext = false) => {
    if (!schoolId) return;
    const dataStarted = performance.now();
    const sequence = ++schoolLoadSequence.current;
    setUsers([]);
    setUsersError('');
    const role = platformContext ? 'admin' : membership?.role;
    const isAdmin = role === 'admin';
    setUsersLoading(isAdmin);
    const [teachersRes, usersRes, studentsRes, availRes, aptsRes, notifsRes, settingsRes, auditRes, rosterRes] = await Promise.all([
      api.getTeachers(schoolId).catch(() => { if (isAdmin) setUsersError('Öğretmen listesi yüklenemedi. Lütfen tekrar deneyin.'); return { teachers: [] }; }),
      isAdmin ? api.getSecurityUsers(schoolId).catch(() => { setUsersError('Güvenlik personeli yüklenemedi. Lütfen tekrar deneyin.'); return { users: [] }; }) : Promise.resolve({ users: [] }),
      api.getStudents(schoolId).catch(() => ({ students: [] })).then((result) => {
        if (sequence === schoolLoadSequence.current && user) setCurrentUser((current) => current?.id === user.id ? { ...current, students: result.students } : current);
        return result;
      }),
      api.getAvailability(schoolId).catch(() => ({ availability: [] })),
      (role === 'security' ? Promise.resolve({ appointments: [] }) : api.getAppointments(schoolId).catch(() => ({ appointments: [] }))).then((result) => {
        if (sequence === schoolLoadSequence.current) setAppointments(result.appointments);
        return result;
      }),
      api.getNotifications(schoolId).catch(() => ({ notifications: [] })).then((result) => {
        if (sequence === schoolLoadSequence.current) setNotifications(result.notifications);
        return result;
      }),
      api.getSettings(schoolId).catch(() => ({ settings: DEFAULT_SETTINGS })),
      role === 'admin' || role === 'security' ? api.getAuditLogs(schoolId).catch(() => ({ auditLogs: [] })) : Promise.resolve({ auditLogs: [] }),
      isAdmin ? api.getRoster(schoolId).catch(() => ({ roster: [] })) : Promise.resolve({ roster: [] }),
    ]);
    if (sequence !== schoolLoadSequence.current) return;
    if (!firstSchoolLoadMeasured.current) {
      firstSchoolLoadMeasured.current = true;
      recordStartupDuration('first-school-data', dataStarted);
    }
    setTeachers(teachersRes.teachers);
    setUsers(usersRes.users);
    setUsersLoading(false);
    if (user) setCurrentUser({ ...user, students: studentsRes.students });
    setAvailability(availRes.availability);
    setAppointments(aptsRes.appointments);
    setNotifications(notifsRes.notifications);
    setSettings(settingsRes.settings);
    setAuditLogs(auditRes.auditLogs);
    setRoster(rosterRes.roster);
  }, []);

  const applyAuthenticatedSession = useCallback((user: User, memberships: SchoolMembership[], access: SchoolAccess) => {
    const { resolution } = access;
    const platformContext = resolution.kind === 'PLATFORM_TARGET';
    const activeMembership = resolution.membership;
    const activeUser: User = {
      ...user,
      students: [],
      role: platformContext ? 'admin' : activeMembership?.role,
      branch: activeMembership?.branch,
    };
    schoolLoadSequence.current += 1;
    setUsers([]);
    setUsersError('');
    setTeachers([]);
    setAvailability([]);
    setAppointments([]);
    setNotifications([]);
    setSettings(DEFAULT_SETTINGS);
    setAuditLogs([]);
    setRoster([]);
    setIsolationTestResults([]);
    setSchools(access.schools);
    setPlatformSchools(access.managedSchools);
    setIsPlatformAdmin(access.isPlatformAdmin);
    setUserMemberships(memberships);
    setPlatformTargetSchoolId(platformContext ? resolution.schoolId : null);
    setActiveSchoolId(resolution.schoolId);
    setCurrentSchool(platformContext ? asSchool(resolution.school) : resolution.school);
    setCurrentMembership(activeMembership);
    setCurrentUser(activeUser);
    if (resolution.schoolId) void loadSchoolData(resolution.schoolId, activeUser, activeMembership, platformContext);
  }, [loadSchoolData]);

  const restoreSession = useCallback((): Promise<SessionRestoreResult> => {
    if (sessionRestore.current) return sessionRestore.current;
    sessionRestore.current = restoreExistingSession({
      session: authSession,
      onHydrationDuration: (durationMs) => recordStartupDuration('secure-storage', performance.now() - durationMs),
      bootstrap: async (token) => {
        const meStarted = performance.now();
        const accessStarted = performance.now();
        const [meRes, accessBase] = await loadVerifiedSessionPrerequisites(
          () => api.getMe().finally(() => recordStartupDuration('me', meStarted)),
          fetchSchoolAccessBase,
        );
        const access = await fetchSchoolAccess(meRes.memberships, getActiveSchoolId(), getPlatformTargetSchoolId(), Promise.resolve(accessBase))
          .finally(() => recordStartupDuration('school-access', accessStarted));
        if (await authSession.getToken() !== token) throw new Error('Session changed during restore');
        applyAuthenticatedSession(meRes.user, meRes.memberships, access);
      },
    }).finally(() => { sessionRestore.current = null; });
    return sessionRestore.current;
  }, [applyAuthenticatedSession]);

  // Initial bootstrap from secure storage. Transient API/network failures preserve the token for reconnect.
  useEffect(() => {
    async function init() {
      setIsLoading(true);
      try {
        await restoreSession();
      } catch {
        clearRuntimeSession();
        setAuthStorageError(true);
      } finally {
        setIsLoading(false);
      }
    }

    void init();
  }, [clearRuntimeSession, restoreSession]);

  useEffect(() => {
    const retryRestore = () => {
      if (!currentUser) void restoreSession().catch(() => setAuthStorageError(true));
    };
    const unsubscribeNetwork = networkHint.subscribe((state) => {
      if (state === 'CONNECTED') retryRestore();
    });
    const unsubscribeLifecycle = appLifecycle.subscribe((state) => {
      if (state === 'ACTIVE') retryRestore();
    });
    return () => {
      unsubscribeNetwork();
      unsubscribeLifecycle();
    };
  }, [currentUser?.id, restoreSession]);

  // Switch Active School
  const switchSchool = async (schoolId: string) => {
    const platformSchool = isPlatformAdmin && platformSchools.find((school) => school.id === schoolId && !school.disabledAt);
    const membership = userMemberships.find((item) => item.schoolId === schoolId && item.status === 'active') || null;
    if (isPlatformAdmin && !platformSchool) return;
    if (!platformSchool && (!membership || !schools.some((school) => school.id === schoolId))) return;
    if (!isPlatformAdmin && currentUser?.role === 'security') return;
    schoolLoadSequence.current += 1;
    setUsers([]);
    setUsersError('');
    setPlatformTargetSchoolId(platformSchool ? schoolId : null);
    setActiveSchoolId(schoolId);
    const targetSchool = platformSchool ? asSchool(platformSchool) : schools.find((s) => s.id === schoolId) || null;
    setCurrentSchool(targetSchool);

    // Instant cache purge of previous school data
    setTeachers([]);
    setAvailability([]);
    setAppointments([]);
    setNotifications([]);
    setAuditLogs([]);
    setRoster([]);

    if (currentUser) {
      const activeMem = platformSchool ? null : membership;
      setCurrentMembership(activeMem);

      const updatedUser = {
        ...currentUser,
        students: [], // Reset previous school's students
        role: platformSchool ? 'admin' as const : activeMem?.role,
        branch: activeMem ? activeMem.branch : undefined,
      };
      setCurrentUser(updatedUser);
      await loadSchoolData(schoolId, updatedUser, activeMem, !!platformSchool);
    }
  };

  const returnToPlatform = async () => {
    const fallback = isPlatformAdmin ? null : userMemberships.find((membership) => membership.status === 'active' && schools.some((school) => school.id === membership.schoolId));
    setPlatformTargetSchoolId(null);
    if (fallback) {
      const target = schools.find((school) => school.id === fallback.schoolId) || null;
      setActiveSchoolId(fallback.schoolId);
      setCurrentSchool(target);
      setCurrentMembership(fallback);
      setTeachers([]); setUsers([]); setAvailability([]); setAppointments([]); setNotifications([]); setAuditLogs([]); setRoster([]); setSettings(DEFAULT_SETTINGS); setIsolationTestResults([]);
      if (currentUser) {
        const updatedUser = { ...currentUser, role: fallback.role, branch: fallback.branch, students: [] };
        setCurrentUser(updatedUser);
        await loadSchoolData(fallback.schoolId, updatedUser, fallback);
      }
    }
    else {
      schoolLoadSequence.current += 1;
      setActiveSchoolId(null);
      setCurrentSchool(null); setCurrentMembership(null); setTeachers([]); setUsers([]); setAvailability([]); setAppointments([]); setNotifications([]); setRoster([]); setAuditLogs([]); setSettings(DEFAULT_SETTINGS); setIsolationTestResults([]);
      if (currentUser) setCurrentUser({ ...currentUser, role: undefined, students: [] });
    }
  };

  // Login
  const login = async (phone: string, password: string, role?: UserRole): Promise<LoginResult> => {
    const result = await performLogin({
      authenticate: () => api.login(phone, password, role),
      session: authSession,
      clearRuntimeSession,
      bootstrap: async (response) => {
        const access = await fetchSchoolAccess(response.memberships, null, null);
        if (await authSession.getToken() !== response.token) throw new Error('Session changed during bootstrap');
        applyAuthenticatedSession(response.user, response.memberships, access);
      },
    });
    if (result.ok) setAuthStorageError(false);
    if (result.ok) setAccountDeletionNotice(null);
    return result;
  };

  // Logout
  const logout = async () => {
    await mobilePush.beforeLogout();
    await authSession.clearToken();
    pendingNavigationIntent.clear();
    clearRuntimeSession();
  };

  const deleteAccount = async (data: { password: string; confirmation: 'HESABIMI SİL'; requestId: string }) => {
    const result = await api.deleteOwnAccount(data);
    let localCleanupFailed = false;
    try {
      await mobilePush.afterSessionInvalidated();
    } catch {
      localCleanupFailed = true;
    }
    try {
      await authSession.clearTokenAfterRemoteInvalidation();
    } catch {
      try {
        await authSession.clearTokenAfterRemoteInvalidation();
      } catch {
        localCleanupFailed = true;
      }
    }
    pendingNavigationIntent.clear();
    clearRuntimeSession();
    setAccountDeletionNotice(result.message);
    setAuthStorageError(localCleanupFailed);
  };

  // Quick switch user for instant evaluator testing
  const switchUser = async (userId: string) => {
    const result = await performLogin({
      authenticate: () => api.quickSwitch(userId),
      session: authSession,
      clearRuntimeSession,
      bootstrap: async (response) => {
        const access = await fetchSchoolAccess(response.memberships, null, null);
        if (await authSession.getToken() !== response.token) throw new Error('Session changed during bootstrap');
        applyAuthenticatedSession(response.user, response.memberships, access);
      },
    });
    if (!result.ok) console.error('Switch user failed:', result.reason);
  };

  // Book Appointment
  const bookAppointment = async (data: {
    teacherId: string;
    studentName: string;
    className: string;
    date: string;
    startTime: string;
    endTime: string;
    notes?: string;
  }): Promise<Appointment> => {
    if (!currentSchool) throw new Error('Aktif okul seçili değil');
    const res = await api.bookAppointment(currentSchool.id, data);
    setAppointments((prev) => [res.appointment, ...prev]);
    return res.appointment;
  };

  // Approve Appointment
  const approveAppointment = async (appointmentId: string) => {
    if (!currentSchool) return;
    const res = await api.approveAppointment(currentSchool.id, appointmentId);
    setAppointments((prev) => prev.map((a) => (a.id === appointmentId ? res.appointment : a)));
  };

  // Reject Appointment
  const rejectAppointment = async (appointmentId: string, reason?: string) => {
    if (!currentSchool) return;
    const res = await api.rejectAppointment(currentSchool.id, appointmentId, reason);
    setAppointments((prev) => prev.map((a) => (a.id === appointmentId ? res.appointment : a)));
  };

  // Cancel Appointment
  const cancelAppointment = async (appointmentId: string) => {
    if (!currentSchool) return;
    const res = await api.cancelAppointment(currentSchool.id, appointmentId);
    setAppointments((prev) => prev.map((a) => (a.id === appointmentId ? res.appointment : a)));
  };

  // Read-only QR verification (Strictly validated by backend tenant guard)
  const verifySecurityQr = async (qrToken: string) => {
    if (!currentSchool) {
      return { success: false, allowed: false, decision: 'INVALID' as const, title: 'RANDEVU DOĞRULANAMADI', message: 'Bu randevu giriş için doğrulanamadı.' };
    }
    return api.verifySecurityQr(currentSchool.id, qrToken);
  };

  // Add Availability Slot
  const addAvailabilitySlot = async (slot: Omit<AvailabilitySlot, 'id' | 'teacherId'>) => {
    if (!currentSchool) return;
    const res = await api.addAvailabilitySlot(currentSchool.id, slot);
    setAvailability((prev) => [...prev, res.slot]);
  };

  const createTeacher = async (data: { fullName: string; role: 'teacher' | 'security'; branch?: string; phone: string; email: string }) => {
    if (!currentSchool) throw new Error('Aktif okul bulunamadı.');
    try {
      const result = await api.createStaff(currentSchool.id, data);
      await loadSchoolData(currentSchool.id, currentUser, currentMembership, platformContextActive);
      return result;
    } catch (error) {
      await loadSchoolData(currentSchool.id, currentUser, currentMembership, platformContextActive);
      throw error;
    }
  };

  // Remove Availability Slot
  const removeAvailabilitySlot = async (slotId: string) => {
    if (!currentSchool) return;
    await api.removeAvailabilitySlot(currentSchool.id, slotId);
    setAvailability((prev) => prev.filter((s) => s.id !== slotId));
  };

  // Mark notifications read
  const markNotificationsAsRead = async () => {
    if (!currentSchool) return;
    await api.markNotificationsRead(currentSchool.id).catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const clearParentNotifications = async () => {
    if (!currentSchool || currentMembership?.role !== 'parent') return;
    await api.clearParentNotifications(currentSchool.id);
    setNotifications((previous) => previous.filter((notification) => notification.userId !== currentUser?.id));
  };

  const clearParentHistory = async () => {
    if (!currentSchool || currentMembership?.role !== 'parent') return;
    await api.clearParentHistory(currentSchool.id);
    const result = await api.getAppointments(currentSchool.id);
    setAppointments(result.appointments);
  };

  const getParentClasses = async () => {
    if (!currentSchool || currentMembership?.role !== 'parent') return [];
    return (await api.getParentClasses(currentSchool.id)).classes;
  };

  // Update Settings
  const updateSettings = async (newSettings: Partial<SchoolSettings>) => {
    if (!currentSchool) return;
    const res = await api.updateSettings(currentSchool.id, newSettings);
    setSettings(res.settings);
  };

  // Add / Remove Student Profile (Local helpers)
  const addStudentToProfile = async (student: { name: string; className: string }) => {
    if (!currentUser || !currentSchool || currentMembership?.role !== 'parent') throw new Error('Aktif veli hesabı bulunamadı.');
    await api.claimParentStudent(currentSchool.id, student);
    const result = await api.getStudents(currentSchool.id);
    setCurrentUser((previous) => previous ? { ...previous, students: result.students } : previous);
  };

  const removeStudentFromProfile = (studentId: string) => {
    if (!currentUser) return;
    const updated = (currentUser.students || []).filter((s) => s.id !== studentId);
    setCurrentUser({ ...currentUser, students: updated });
  };

  // Automated Tenant Isolation Test Suite
  const runIsolationTests = async (): Promise<TenantIsolationTestResult[]> => {
    if (!currentSchool) return [];
    try {
      const res = await api.testIsolation(currentSchool.id);
      setIsolationTestResults(res.results);
      return res.results;
    } catch (err: any) {
      console.error('Test isolation error:', err);
      return [];
    }
  };

  const unreadNotificationCount = notifications.filter(
    (n) => !n.read && (currentUser ? n.userId === currentUser.id : true)
  ).length;

  return (
    <AppContext.Provider
      value={{
        refreshMobileData: async () => {
          if (!currentSchool || !currentUser || !['parent', 'teacher'].includes(currentMembership?.role || '')) return;
          const schoolId = currentSchool.id;
          const [notificationResult, appointmentResult] = await Promise.all([
            api.getNotifications(schoolId), api.getAppointments(schoolId),
          ]);
          if (schoolId !== getActiveSchoolId()) return;
          setNotifications(notificationResult.notifications);
          setAppointments(appointmentResult.appointments);
        },
        refreshSchoolData: async () => {
          const schoolId = currentSchool?.id;
          if (!schoolId || getActiveSchoolId() !== schoolId || (currentMembership?.role !== 'admin' && !platformContextActive)) return;
          const [teacherData, userData, rosterData, logData] = await Promise.all([
            api.getTeachers(schoolId), api.getSecurityUsers(schoolId), api.getRoster(schoolId), api.getAuditLogs(schoolId),
          ]);
          if (getActiveSchoolId() !== schoolId) return;
          setTeachers(teacherData.teachers);
          setUsers(userData.users);
          setRoster(rosterData.roster);
          setAuditLogs(logData.auditLogs);
        },
        refreshPlatformSchools: async () => {
          if (!isPlatformAdmin) return;
          const result = await api.getManagedSchools();
          setPlatformSchools(result.schools);
          setSchools((current) => current.map((school) => {
            const updated = result.schools.find((candidate) => candidate.id === school.id);
            return updated ? asSchool(updated) : school;
          }));
          const active = currentSchool && result.schools.find((school) => school.id === currentSchool.id);
          if ((!active || active.disabledAt) && currentSchool && platformContextActive) {
            await returnToPlatform();
          } else if (active) setCurrentSchool(asSchool(active));
        },
        currentUser,
        users,
        usersLoading,
        usersError,
        schools,
        platformSchools,
        isPlatformAdmin,
        platformContextActive,
        currentSchool,
        userMemberships,
        currentMembership,
        teachers,
        availability,
        appointments,
        notifications,
        settings,
        auditLogs,
        roster,
        isolationTestResults,
        unreadNotificationCount,
        isLoading,
        authStorageError,
        accountDeletionNotice,
        switchSchool,
        returnToPlatform,
        login,
        logout,
        deleteAccount,
        switchUser,
        bookAppointment,
        approveAppointment,
        rejectAppointment,
        cancelAppointment,
        verifySecurityQr,
        addAvailabilitySlot,
        createTeacher,
        removeAvailabilitySlot,
        markNotificationsAsRead,
        clearParentNotifications,
        clearParentHistory,
        getParentClasses,
        updateSettings,
        addStudentToProfile,
        removeStudentFromProfile,
        runIsolationTests,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};
