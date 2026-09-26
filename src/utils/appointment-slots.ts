export function intervalsOverlap(
  slot: { startTime: string; endTime: string },
  occupied: { startTime: string; endTime: string }
): boolean {
  return slot.startTime < occupied.endTime && slot.endTime > occupied.startTime;
}
