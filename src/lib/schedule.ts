/** Crew scheduling helpers shared by /admin/schedule and the dock app. */
import { fmtDateStr, fmtTime, localDate } from "./time";

export const POSITIONS = ["dock", "captain", "office", "cleaning"] as const;
export const POSITION_LABELS: Record<string, string> = { dock: "Dock", captain: "Captain", office: "Office", cleaning: "Cleaning" };

/** "9:00 AM–5:00 PM" → "9a–5p" for compact chips. */
export function shortTime(d: Date): string {
  return fmtTime(d).replace(":00", "").replace(" AM", "a").replace(" PM", "p");
}

export function shiftLabel(s: { startsAt: Date; endsAt: Date }) {
  return `${shortTime(s.startsAt)}–${shortTime(s.endsAt)}`;
}

/** Text message listing someone's shifts for a week. */
export function weekText(name: string, weekStart: string, shifts: { startsAt: Date; endsAt: Date; position: string }[]) {
  const first = name.trim().split(/\s+/)[0];
  const lines = shifts.map(
    (s) => `${fmtDateStr(localDate(s.startsAt))}: ${shiftLabel(s)} (${POSITION_LABELS[s.position] ?? s.position})`,
  );
  return `Hi ${first}, your shifts for the week of ${fmtDateStr(weekStart, { weekday: undefined })}:\n${lines.join("\n")}\nQuestions? Reply here or ask a manager.`;
}
