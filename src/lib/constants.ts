export const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "checked_out",
  "returned",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  checked_out: "On the water",
  returned: "Returned",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-300",
  confirmed: "bg-sky-100 text-sky-900 border-sky-300",
  checked_out: "bg-emerald-100 text-emerald-900 border-emerald-300",
  returned: "bg-violet-100 text-violet-900 border-violet-300",
  completed: "bg-slate-100 text-slate-700 border-slate-300",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200 line-through",
  no_show: "bg-rose-100 text-rose-900 border-rose-300",
};

export const DEPOSIT_LABELS: Record<string, string> = {
  none: "No card on file",
  card_saved: "Card saved (not held)",
  held: "Hold placed",
  released: "Released",
  captured: "Captured",
  partially_captured: "Partially captured",
};

export const PAYMENT_LABELS: Record<string, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
};

export const PHOTO_PHASES = ["before", "after", "damage", "other"] as const;
export type PhotoPhase = (typeof PHOTO_PHASES)[number];

export const FUEL_LEVELS = ["Full", "7/8", "3/4", "5/8", "1/2", "3/8", "1/4", "1/8", "Empty"];

/** Statuses that occupy a boat's time on the calendar. */
export const ACTIVE_STATUSES = ["pending", "confirmed", "checked_out", "returned", "completed"];
