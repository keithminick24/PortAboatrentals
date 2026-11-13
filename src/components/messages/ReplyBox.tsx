"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";

type Template = { key: string; label: string; body: string };

function SendButton() {
  const { pending } = useFormStatus();
  return <button className="btn-primary shrink-0" disabled={pending}>{pending ? "Sending…" : "Send"}</button>;
}

/** Reply form with one-tap templates. Posts to a server action. */
export default function ReplyBox({
  action,
  hidden,
  templates,
}: {
  action: (f: FormData) => Promise<void>;
  hidden: Record<string, string>;
  templates: Template[];
}) {
  const [body, setBody] = useState("");
  return (
    <form action={async (f) => { await action(f); setBody(""); }} className="space-y-2">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {templates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {templates.map((t) => (
            <button key={t.key} type="button" className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50" onClick={() => setBody(t.body)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea name="body" rows={2} className="input flex-1" placeholder="Type a text…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1600} required />
        <SendButton />
      </div>
      <div className="text-right text-xs text-slate-400">{body.length}/1600</div>
    </form>
  );
}
