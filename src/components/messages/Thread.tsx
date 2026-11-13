import { fmtDateTime } from "@/lib/time";

type Msg = { id: string; direction: string; body: string; status: string; sentBy: string | null; createdAt: Date; error: string | null };

export default function Thread({ messages }: { messages: Msg[] }) {
  if (messages.length === 0) return <div className="py-6 text-center text-sm text-slate-500">No texts yet.</div>;
  return (
    <div className="space-y-2">
      {messages.map((m) => {
        const out = m.direction === "out";
        return (
          <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${out ? "bg-brand text-white" : "bg-slate-100 text-slate-900"}`}>
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
              <div className={`mt-1 text-[10px] ${out ? "text-white/70" : "text-slate-500"}`}>
                {fmtDateTime(m.createdAt)}
                {out && ` · ${m.sentBy ?? ""} · ${m.status === "mock" ? "test mode, not sent" : m.status}`}
                {m.error && ` · ${m.error}`}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
