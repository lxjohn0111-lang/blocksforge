// Local-calendar helpers shared by daily rewards, quests, shop rotation and
// limited-time events. Everything is computed from the device clock; nothing
// is fetched from a server.

export function dayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDayKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseDayKey(b).getTime() - parseDayKey(a).getTime()) / 86400000);
}

export function nextMidnight(now = new Date()): number {
  const n = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return n.getTime();
}

/** ISO-like week index counted from a fixed Monday (local time). */
export function weekIndex(now = new Date()): number {
  const epoch = new Date(2026, 0, 5).getTime();
  return Math.floor((startOfDay(now).getTime() - epoch) / (7 * 86400000));
}

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
