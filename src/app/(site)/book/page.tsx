import BookingWizard from "@/components/BookingWizard";
import { bookingWizardProps } from "@/lib/wizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book a boat" };

export default async function BookPage({ searchParams }: { searchParams: Promise<{ boat?: string; date?: string }> }) {
  const props = await bookingWizardProps(await searchParams);
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <BookingWizard {...props} />
    </div>
  );
}
