"use client";
import { useEffect, useState } from "react";

/** One-tap ways for the renter to send the passenger waiver link to their group. */
export default function ShareWaiver({ url, boat, when }: { url: string; boat: string; when: string }) {
  const [copied, setCopied] = useState(false);
  const msg = `Please sign the passenger waiver for our boat trip (${boat}, ${when}) before we go: ${url}`;
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare("share" in navigator), []);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {canShare && (
          <button
            type="button"
            className="btn-primary col-span-2 sm:col-span-1"
            onClick={() => navigator.share({ title: "Passenger waiver", text: msg, url }).catch(() => {})}
          >
            Share…
          </button>
        )}
        <a className="btn-secondary" href={`sms:?&body=${encodeURIComponent(msg)}`}>💬 Text it</a>
        <a className="btn-secondary" href={`mailto:?subject=${encodeURIComponent("Boat trip waiver")}&body=${encodeURIComponent(msg)}`}>✉️ Email it</a>
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied!" : "🔗 Copy link"}
        </button>
      </div>
      <code className="block break-all rounded bg-slate-100 px-2 py-1 text-xs">{url}</code>
    </div>
  );
}
