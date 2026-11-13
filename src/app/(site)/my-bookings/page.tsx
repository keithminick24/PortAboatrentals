import { emailMyBookings } from "./actions";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "My bookings" };

export default async function MyBookings({ searchParams }: { searchParams: Promise<{ sent?: string; err?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-12">
      <h1 className="h1">My bookings</h1>
      <p className="text-slate-600">Enter the email you booked with and we&apos;ll email you links to all your trips and the agreements you signed.</p>
      {sp.sent && <Notice tone="success">If we have bookings for that email, a message with your links is on its way. Check your inbox (and spam folder).</Notice>}
      {sp.err && <Notice tone="error">Please enter a valid email.</Notice>}
      <form action={emailMyBookings} className="card card-pad space-y-3">
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required className="input" autoComplete="email" />
        <button className="btn-primary w-full">Email me my bookings</button>
      </form>
    </div>
  );
}
