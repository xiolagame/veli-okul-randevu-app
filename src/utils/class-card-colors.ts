import type { CSSProperties } from 'react';
import { normalizeClassName } from './class-name';

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.codePointAt(0)!, 16777619);
  return result >>> 0;
}

function branchNumber(value: string): number {
  if (!/^[A-Z]{1,10}$/.test(value)) return hash(value);
  return [...value].reduce((result, character) => result * 26 + character.charCodeAt(0) - 64, 0) - 1;
}

const fraction = (value: number) => value - Math.floor(value);
const rounded = (value: number) => Math.round(value * 100) / 100;

/** Presentation only: no record mutation or dependence on list order/count. */
export function classCardColors(value: string, allClasses = false): CSSProperties {
  const canonical = (normalizeClassName(value) || value).normalize('NFC');
  const match = /^(\d+)(?:[-/\s]+)?(.*)$/u.exec(canonical);
  const grade = match ? Number(match[1]) : null;
  const base = allClasses ? 275 : ({ 5:146, 6:216, 7:28, 8:277 } as Record<number, number>)[grade ?? -1]
    ?? (grade === null ? hash(canonical) % 360 : Number.isSafeInteger(grade)
      ? rounded((grade * 137.507764 + 67) % 360) : hash(match![1]) % 360);
  const number = allClasses ? 0 : branchNumber(match?.[2] || canonical);
  // Low-discrepancy sequences spread neighboring branches across hue, saturation
  // and lightness. There is no finite branch palette or list-index assignment.
  const hue = rounded((base + (fraction((number + 1) * .61803398875) - .5) * 30 + 360) % 360);
  const saturation = rounded(58 + fraction((number + 1) * .75487766625) * 24);
  const shade = fraction((number + 1) * .41421356237);
  const light = rounded(80 + shade * 14), dark = rounded(13 + shade * 9);
  const hsl = (s: number, l: number) => `hsl(${hue} ${s}% ${rounded(l)}%)`;
  return {
    '--class-light-bg': hsl(saturation, light),
    '--class-light-end': hsl(saturation, Math.min(97, light + 3)),
    '--class-light-hover': hsl(saturation, light - 3),
    '--class-light-accent': hsl(67, 26),
    '--class-light-icon': hsl(55, 97),
    '--class-dark-bg': hsl(35, dark),
    '--class-dark-end': hsl(35, dark + 3),
    '--class-dark-hover': hsl(35, dark + 4),
    '--class-dark-accent': hsl(80, 78),
    '--class-dark-icon': hsl(35, 10),
  } as CSSProperties;
}
