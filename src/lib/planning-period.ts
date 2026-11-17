export interface PlanningPeriod {
  year: number | null;
  quarter: number | null;
  sprintNumber: number | null;
}

export function expectedPlanningPeriod(date = new Date()) {
  const year = date.getFullYear();
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
  const firstWednesday = start.getTime() + ((3 - start.getUTCDay() + 7) % 7) * dayMs;
  // Compare calendar days in UTC so daylight-saving changes do not move sprint boundaries.
  const today = Date.UTC(year, date.getMonth(), date.getDate());
  const sprintNumber = Math.max(0, Math.floor((today - firstWednesday) / (14 * dayMs)) + 1);
  return { year, quarter, sprintNumber };
}

export function formatPlanningPeriod({ year, quarter, sprintNumber }: PlanningPeriod) {
  if (year !== null && quarter !== null && sprintNumber !== null) {
    return `${String(year).slice(-2)}Q${quarter}S${sprintNumber}`;
  }
  return [
    year === null ? "" : String(year),
    quarter === null ? "" : `Q${quarter}`,
    sprintNumber === null ? "" : `Sprint ${sprintNumber}`,
  ].filter(Boolean).join(" · ");
}
