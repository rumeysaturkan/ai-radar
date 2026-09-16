/** ISO-8601 hafta kimliği üretir, ör. "2026-W38". */
export function isoWeekId(date: Date): string {
  const target = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );

  // ISO haftasında gün 1=Pazartesi ... 7=Pazar.
  const dayNumber = target.getUTCDay() === 0 ? 7 : target.getUTCDay();

  // Haftanın perşembesi, o haftanın hangi yıla ait olduğunu belirler.
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);

  const year = target.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((target.getTime() - yearStart) / 86_400_000 + 1) / 7);

  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function formatDate(iso: string, language: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}
