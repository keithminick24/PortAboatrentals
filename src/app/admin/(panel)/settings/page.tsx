import { getSettings, prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { appUrl } from "@/lib/mail";
import { isMockPayments } from "@/lib/payments";
import { Notice, PageHeader, Pill } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import CopyButton from "@/components/CopyButton";
import { saveSettings, saveStaff } from "../../actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const me = await requireAdmin();
  const s = await getSettings();
  const staff = await prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } });
  const weekend = s.weekendDays.split(",");
  const isOwner = me.role === "owner";
  const embed = `<iframe src="${appUrl("/embed/book")}" style="width:100%;min-height:1100px;border:0" title="Book a boat"></iframe>`;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Settings" />
      <FlashMessage msg={sp.msg} err={sp.err} />
      {!isOwner && <Notice tone="info">Only the owner can change settings.</Notice>}

      <div className="card card-pad space-y-2 text-sm">
        <h2 className="h2">Integrations</h2>
        <div>Payments: {isMockPayments() ? <Pill tone="amber">Test mode (no Stripe key)</Pill> : <Pill tone="green">Stripe live</Pill>}</div>
        <div>Email: {process.env.SMTP_HOST ? <Pill tone="green">SMTP configured</Pill> : <Pill tone="amber">Logging to console only</Pill>}</div>
        <div>Photo storage: <Pill>{process.env.STORAGE_DRIVER || "local"}</Pill></div>
        <div className="pt-2">
          <div className="font-medium">Embed on WordPress</div>
          <p className="muted">Paste into a Custom HTML block on portaboatrentals.com, or just link your &quot;Book Now&quot; buttons to {appUrl("/book")}.</p>
          <div className="mt-1 flex items-start gap-2">
            <code className="block flex-1 overflow-x-auto rounded bg-slate-100 p-2 text-xs">{embed}</code>
            <CopyButton text={embed} />
          </div>
        </div>
      </div>

      <form action={saveSettings} className="card card-pad space-y-4">
        <fieldset disabled={!isOwner} className="space-y-4">
          <h2 className="h2">Business</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Business name</label><input name="businessName" className="input" defaultValue={s.businessName} /></div>
            <div><label className="label">Phone</label><input name="phone" className="input" defaultValue={s.phone} /></div>
            <div><label className="label">Email</label><input name="email" className="input" defaultValue={s.email} /></div>
            <div><label className="label">Address / meeting point</label><input name="address" className="input" defaultValue={s.address} /></div>
          </div>
          <h2 className="h2">Booking rules</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className="label">Opens</label><input name="openTime" type="time" className="input" defaultValue={s.openTime} /></div>
            <div><label className="label">Last return by</label><input name="closeTime" type="time" className="input" defaultValue={s.closeTime} /></div>
            <div><label className="label">Start every (min)</label><input name="slotIntervalMin" type="number" className="input" defaultValue={s.slotIntervalMin} /></div>
            <div><label className="label">Turnaround between trips (min)</label><input name="bufferMin" type="number" className="input" defaultValue={s.bufferMin} /></div>
            <div><label className="label">Minimum notice (hrs)</label><input name="minNoticeHours" type="number" className="input" defaultValue={s.minNoticeHours} /></div>
            <div><label className="label">Book up to (days ahead)</label><input name="maxAdvanceDays" type="number" className="input" defaultValue={s.maxAdvanceDays} /></div>
            <div><label className="label">Unpaid hold (min)</label><input name="holdMinutes" type="number" className="input" defaultValue={s.holdMinutes} /></div>
            <div><label className="label">Free cancel up to (hrs before)</label><input name="cancelWindowHours" type="number" className="input" defaultValue={s.cancelWindowHours} /></div>
          </div>
          <h2 className="h2">Pricing</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className="label">Sales tax %</label><input name="taxRate" type="number" step="0.001" className="input" defaultValue={s.taxRateBps / 100} /></div>
            <div><label className="label">Booking fee % (of rental)</label><input name="feeRate" type="number" step="0.01" className="input" defaultValue={s.feeRateBps / 100} /></div>
            <div>
              <span className="label">Weekend pricing days</span>
              <div className="flex flex-wrap gap-2 text-sm">
                {DAYS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1"><input type="checkbox" name="weekendDays" value={i} defaultChecked={weekend.includes(String(i))} />{d}</label>
                ))}
              </div>
            </div>
          </div>
          <div><label className="label">Confirmation note (shown on confirmation & email)</label><textarea name="confirmationNote" rows={2} className="input" defaultValue={s.confirmationNote} /></div>
          <button className="btn-primary">Save settings</button>
        </fieldset>
      </form>

      <div className="card card-pad space-y-3">
        <h2 className="h2">Staff logins</h2>
        <p className="muted">Owner: everything. Manager: refunds, deposit captures, fleet & contracts. Staff: check-in/out, photos, bookings.</p>
        {[...staff, null].map((u) => (
          <form key={u?.id ?? "new"} action={saveStaff} className="grid grid-cols-12 items-end gap-2 rounded-lg bg-slate-50 p-2">
            <fieldset disabled={!isOwner} className="contents">
              <input type="hidden" name="id" value={u?.id ?? ""} />
              <div className="col-span-6 sm:col-span-3"><label className="label text-xs">Name</label><input name="name" className="input" defaultValue={u?.name} required /></div>
              <div className="col-span-6 sm:col-span-3"><label className="label text-xs">Email</label><input name="email" type="email" className="input" defaultValue={u?.email} required /></div>
              <div className="col-span-5 sm:col-span-2">
                <label className="label text-xs">Role</label>
                <select name="role" className="input" defaultValue={u?.role ?? "staff"}><option value="owner">Owner</option><option value="manager">Manager</option><option value="staff">Staff</option></select>
              </div>
              <div className="col-span-7 sm:col-span-2"><label className="label text-xs">{u ? "New password" : "Password"}</label><input name="password" type="password" className="input" placeholder={u ? "unchanged" : "8+ chars"} /></div>
              <div className="col-span-12 flex items-center gap-2 sm:col-span-2">
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={u?.active ?? true} />Active</label>
                <button className="btn-secondary btn-sm">{u ? "Save" : "Add"}</button>
              </div>
            </fieldset>
          </form>
        ))}
      </div>
    </div>
  );
}
