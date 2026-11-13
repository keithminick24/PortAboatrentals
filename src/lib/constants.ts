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

/** Guided photo positions for dock check-out / check-in. Order = shot order on the dock. */
export const PHOTO_ANGLES = [
  { key: "bow", label: "Bow (front)", hint: "Stand on the dock, whole front of the boat" },
  { key: "port", label: "Port side (left)", hint: "Full left side, hull and pontoons" },
  { key: "starboard", label: "Starboard side (right)", hint: "Full right side, hull and pontoons" },
  { key: "stern", label: "Stern (back)", hint: "Back deck, swim ladder, motor from behind" },
  { key: "helm", label: "Helm / console", hint: "Steering, gauges, screen, switches" },
  { key: "seating", label: "Seating & deck", hint: "Upholstery, carpet, Bimini top" },
  { key: "engine", label: "Engine cowling", hint: "Motor cover close up" },
  { key: "prop", label: "Propeller", hint: "Tilt motor up, prop blades and skeg" },
] as const;
export type PhotoAngle = (typeof PHOTO_ANGLES)[number]["key"] | "other";
export const ANGLE_LABELS: Record<string, string> = Object.fromEntries([
  ...PHOTO_ANGLES.map((a) => [a.key, a.label]),
  ["other", "Other"],
]);
export const DAMAGE_SEVERITIES = ["minor", "moderate", "major"] as const;
