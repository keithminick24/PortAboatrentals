"use client";

import { useState } from "react";
import SignaturePad from "./SignaturePad";

export default function SignContractForm(props: {
  endpoint: string;
  templateId: string;
  templateName: string;
  body: string;
  defaultName?: string;
  defaultEmail?: string;
  primary: boolean;
  redirectTo: string;
}) {
  const [name, setName] = useState(props.defaultName ?? "");
  const [email, setEmail] = useState(props.defaultEmail ?? "");
  const [dob, setDob] = useState("");
  const [boaterEd, setBoaterEd] = useState("");
  const [agree, setAgree] = useState(false);
  const [sig, setSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sig) return setError("Please sign in the box.");
    if (!agree) return setError("Please confirm you've read and agree.");
    setBusy(true);
    setError(null);
    const res = await fetch(props.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: props.templateId,
        signerName: name,
        signerEmail: email || undefined,
        dateOfBirth: dob || undefined,
        boaterEdNumber: boaterEd || undefined,
        signatureData: sig,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Could not save signature.");
      setBusy(false);
      return;
    }
    if (props.redirectTo === "stay") {
      setDone(true);
      setBusy(false);
      return;
    }
    window.location.href = props.redirectTo;
  }

  if (done) {
    return (
      <div className="card card-pad text-center">
        <div className="text-4xl">✅</div>
        <h2 className="h2 mt-2">Thanks, {name.split(" ")[0]}! You&apos;re signed.</h2>
        <p className="muted mt-1">See you on the water.</p>
        <button className="btn-secondary mt-4" onClick={() => window.location.reload()}>
          Sign for another guest
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card card-pad space-y-4">
      <h2 className="h2">{props.templateName}</h2>
      <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed">
        {props.body}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">Full legal name</label>
          <input id="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="dob">Date of birth</label>
          <input id="dob" type="date" className="input" required value={dob} onChange={(e) => setDob(e.target.value)} />
        </div>
        {!props.primary && (
          <div>
            <label className="label" htmlFor="email">Email (optional)</label>
            <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        )}
        {props.primary && (
          <div>
            <label className="label" htmlFor="boater">Texas boater education card # (if born on/after 9/1/1993)</label>
            <input id="boater" className="input" value={boaterEd} onChange={(e) => setBoaterEd(e.target.value)} />
          </div>
        )}
      </div>
      <div>
        <span className="label">Signature</span>
        <SignaturePad onChange={setSig} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          I have read and agree to the {props.templateName}. I understand I am giving up certain legal rights and that my
          electronic signature is legally binding.
        </span>
      </label>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
      <button className="btn-primary w-full py-3 text-base" disabled={busy}>
        {busy ? "Saving…" : "Sign agreement"}
      </button>
    </form>
  );
}
