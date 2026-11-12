// Reports group sales by the local day and hour of the computer running the
// server, so MongoDB date operators receive the same time zone.
export const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const MS_PER_MINUTE = 60 * 1000;

export function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

export function startOfDaysAgo(days: number): Date {
  const date = startOfToday();
  date.setDate(date.getDate() - days);
  return date;
}

export function msToMinutes(ms: number): number {
  return Math.round((ms / MS_PER_MINUTE) * 10) / 10;
}
