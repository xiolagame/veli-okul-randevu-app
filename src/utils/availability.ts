import { AvailabilitySlot } from '../types';

export const AVAILABILITY_DAYS = [
  { id: 1, name: 'Pazartesi' },
  { id: 2, name: 'Salı' },
  { id: 3, name: 'Çarşamba' },
  { id: 4, name: 'Perşembe' },
  { id: 5, name: 'Cuma' },
  { id: 6, name: 'Cumartesi' },
] as const;

export function groupAvailabilityByDay(slots: AvailabilitySlot[]) {
  return AVAILABILITY_DAYS.map((day) => ({
    ...day,
    slots: slots
      .filter((slot) => slot.dayOfWeek === day.id)
      .sort((left, right) => left.startTime.localeCompare(right.startTime) || left.endTime.localeCompare(right.endTime)),
  })).filter((day) => day.slots.length > 0);
}
