import { NavigationIntent, PendingNavigationIntentStore } from './navigation-intent';

type Resolution = 'NONE' | 'NAVIGATED' | 'SWITCHED' | 'PENDING' | 'CLEARED';

interface AppointmentNavigationOptions {
  store: PendingNavigationIntentStore;
  currentSchoolId: string;
  accessibleSchoolIds: string[];
  getAppointmentIds: (schoolId: string) => Promise<string[]>;
  switchSchool: (schoolId: string) => Promise<void>;
  navigate: (appointmentId: string) => Promise<void> | void;
  isCurrent: () => boolean;
}

export class AppointmentNavigationResolver {
  private running: Promise<Resolution> | null = null;

  resolve(options: AppointmentNavigationOptions): Promise<Resolution> {
    if (this.running) return this.running.then(() => this.resolve(options));
    this.running = this.resolveOnce(options).finally(() => { this.running = null; });
    return this.running;
  }

  private async resolveOnce(options: AppointmentNavigationOptions): Promise<Resolution> {
    const intent = options.store.peek();
    if (!intent || intent.type !== 'APPOINTMENT') return 'NONE';

    const schoolIds = [options.currentSchoolId, ...options.accessibleSchoolIds]
      .filter((schoolId, index, all) => !!schoolId && all.indexOf(schoolId) === index);

    for (const schoolId of schoolIds) {
      let appointmentIds: string[];
      try {
        appointmentIds = await options.getAppointmentIds(schoolId);
      } catch {
        return 'PENDING';
      }
      if (!options.isCurrent() || options.store.peek() !== intent) return 'PENDING';
      if (!appointmentIds.includes(intent.resourceId)) continue;

      if (schoolId !== options.currentSchoolId) {
        try {
          await options.switchSchool(schoolId);
        } catch {
          return 'PENDING';
        }
        return 'SWITCHED';
      }

      try {
        await options.navigate(intent.resourceId);
      } catch {
        return 'PENDING';
      }
      if (!options.isCurrent() || !options.store.consume(intent)) return 'PENDING';
      return 'NAVIGATED';
    }

    if (!options.isCurrent()) return 'PENDING';
    options.store.consume(intent);
    return 'CLEARED';
  }
}
