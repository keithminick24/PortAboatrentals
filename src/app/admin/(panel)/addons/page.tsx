import { prisma } from "@/lib/db";
import { centsToInput } from "@/lib/money";
import { PageHeader } from "@/components/ui";
import FlashMessage from "@/components/FlashMessage";
import { saveAddOn } from "../../actions";

export default async function AddOnsPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const addOns = await prisma.addOn.findMany({ orderBy: { sortOrder: "asc" } });
  return (
    <div className="max-w-4xl">
      <PageHeader title="Add-ons" subtitle="Extras customers can add at checkout. Quantity = how many you own; the system won't oversell at overlapping times." />
      <FlashMessage msg={sp.msg} err={sp.err} />
      <div className="space-y-3">
        {[...addOns, null].map((a) => (
          <form key={a?.id ?? "new"} action={saveAddOn} className={`card card-pad grid grid-cols-12 items-end gap-3 ${a ? "" : "border-dashed"}`}>
            <input type="hidden" name="id" value={a?.id ?? ""} />
            <div className="col-span-12 sm:col-span-3"><label className="label">Name</label><input name="name" className="input" defaultValue={a?.name} placeholder="New add-on" /></div>
            <div className="col-span-12 sm:col-span-4"><label className="label">Description</label><input name="description" className="input" defaultValue={a?.description} /></div>
            <div className="col-span-4 sm:col-span-1"><label className="label">Price $</label><input name="price" className="input" defaultValue={centsToInput(a?.priceCents)} /></div>
            <div className="col-span-4 sm:col-span-1"><label className="label">Qty</label><input name="quantity" type="number" min={1} className="input" defaultValue={a?.quantity ?? 1} /></div>
            <div className="col-span-4 sm:col-span-1"><label className="label">Order</label><input name="sortOrder" type="number" className="input" defaultValue={a?.sortOrder ?? addOns.length + 1} /></div>
            <div className="col-span-12 flex items-center gap-3 sm:col-span-2">
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="active" defaultChecked={a?.active ?? true} /> Active</label>
              <button className="btn-secondary btn-sm">{a ? "Save" : "Add"}</button>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
