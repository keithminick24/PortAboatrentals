import BookingWizard from "@/components/BookingWizard";
import { bookingWizardProps } from "@/lib/wizard";

export const dynamic = "force-dynamic";

/** Chrome-less booking widget for embedding in WordPress via <iframe>. */
export default async function EmbedBook({ searchParams }: { searchParams: Promise<{ boat?: string; date?: string }> }) {
  const props = await bookingWizardProps(await searchParams);
  return (
    <div className="site p-2">
      <BookingWizard embedded {...props} />
    </div>
  );
}
