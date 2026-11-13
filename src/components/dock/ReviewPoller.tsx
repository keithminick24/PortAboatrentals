"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the dock screen live while photo reviews run: polls a tiny status
 * endpoint and refreshes the page when results arrive. Buzzes the phone when
 * new damage spots are flagged.
 */
export default function ReviewPoller({ bookingId, pending, flags }: { bookingId: string; pending: number; flags: number }) {
  const router = useRouter();
  const lastFlags = useRef(flags);

  useEffect(() => {
    if (flags > lastFlags.current && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([200, 100, 200]);
    lastFlags.current = flags;
  }, [flags]);

  useEffect(() => {
    if (pending === 0) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/admin/dock/${bookingId}/status`, { cache: "no-store" });
        const d = await r.json();
        if (d.pending !== pending || d.flags !== flags) router.refresh();
      } catch {
        /* offline; try again next tick */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [bookingId, pending, flags, router]);

  return null;
}
