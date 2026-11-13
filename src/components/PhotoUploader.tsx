"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { shrink } from "@/lib/shrinkImage";

export default function PhotoUploader({ bookingId, phase, label }: { bookingId: string; phase: string; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    setStatus(`Preparing ${list.length} photo(s)…`);
    try {
      const form = new FormData();
      form.set("bookingId", bookingId);
      form.set("phase", phase);
      for (const f of Array.from(list)) form.append("files", await shrink(f));
      setStatus("Uploading…");
      const res = await fetch("/api/admin/photos", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setStatus(`Uploaded ${data.count} photo(s) ✓`);
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}>
        📷 {label}
      </button>
      {status && <span className="text-xs text-slate-500">{status}</span>}
    </div>
  );
}
