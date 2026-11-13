"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { shrink } from "@/lib/shrinkImage";

export type GridPhoto = { id: string; angle: string; aiStatus: string; aiSummary: string; flags: number };
type Angle = { key: string; label: string; hint: string };

/** Guided photo checklist: one tile per angle, tap to shoot with the phone camera. */
export default function DockPhotoGrid({
  bookingId,
  phase,
  angles,
  photos,
  locked,
}: {
  bookingId: string;
  phase: "before" | "after";
  angles: readonly Angle[];
  photos: GridPhoto[];
  locked?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function shoot(angle: string) {
    if (locked || busy) return;
    setTarget(angle);
    setError(null);
    input.current?.click();
  }

  async function onFile(list: FileList | null) {
    const file = list?.[0];
    if (!file || !target) return;
    setBusy(target);
    try {
      const form = new FormData();
      form.set("bookingId", bookingId);
      form.set("phase", phase);
      form.set("angle", target);
      form.append("files", await shrink(file));
      const res = await fetch("/api/admin/photos", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed. Check signal and try again.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  const done = angles.filter((a) => photos.some((p) => p.angle === a.key)).length;

  return (
    <div>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files)} />
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold">{done} of {angles.length} photos</span>
        <span className="text-slate-500">Tap a tile to take or retake</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-slate-200">
        <div className="h-2 bg-emerald-500 transition-all" style={{ width: `${(done / angles.length) * 100}%` }} />
      </div>
      {error && <div className="mt-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{error}</div>}
      <div className="mt-3 grid grid-cols-2 gap-3">
        {angles.map((a) => {
          const shots = photos.filter((p) => p.angle === a.key);
          const latest = shots[shots.length - 1];
          const uploading = busy === a.key;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => shoot(a.key)}
              disabled={locked || !!busy}
              className={`relative flex aspect-[4/3] flex-col overflow-hidden rounded-xl border-2 text-left ${
                latest ? (latest.flags > 0 ? "border-amber-400" : "border-emerald-400") : "border-dashed border-slate-300 bg-white"
              }`}
            >
              {latest ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/admin/photos/${latest.id}`} alt={a.label} className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center p-2 text-center">
                  <div className="text-3xl">📷</div>
                  <div className="mt-1 text-[11px] leading-tight text-slate-500">{a.hint}</div>
                </div>
              )}
              <div className="relative mt-auto bg-black/60 px-2 py-1 text-xs text-white">
                <div className="font-semibold">{a.label}</div>
                {uploading ? (
                  <div>Uploading…</div>
                ) : latest ? (
                  <ReviewChip p={latest} />
                ) : (
                  <div className="text-white/80">Tap to shoot</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReviewChip({ p }: { p: GridPhoto }) {
  if (p.aiStatus === "pending") return <div>🔎 Checking for damage…</div>;
  if (p.flags > 0) return <div className="font-semibold text-amber-300">⚠ {p.flags} spot{p.flags > 1 ? "s" : ""} to check</div>;
  if (p.aiStatus === "done") return <div className="text-emerald-300">✓ No issues found</div>;
  if (p.aiStatus === "error") return <div className="text-rose-200">Check by eye</div>;
  return <div className="text-white/80">✓ Saved</div>;
}
