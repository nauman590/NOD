import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2, Check, Clock, MapPin } from "lucide-react";
import { loadJobs, updateJob, payout, type LineItem, type Job } from "@/lib/provider-store";

export const Route = createFileRoute("/provider/adjust/$jobId")({
  component: AdjustPrice,
  head: () => ({ meta: [{ title: "Adjust price — Tasker" }] }),
});

function AdjustPrice() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const j = loadJobs().find((x) => x.id === jobId) || null;
    setJob(j);
    setItems(j?.addOns?.length ? j.addOns : [{ id: crypto.randomUUID(), description: "", price: 0 }]);
  }, [jobId]);

  const validItems = items.filter((i) => i.description.trim() && i.price > 0);
  const addOnTotal = validItems.reduce((s, i) => s + i.price, 0);
  const newTotal = useMemo(() => (job ? job.customerPrice + addOnTotal : 0), [job, addOnTotal]);
  const newPayout = useMemo(() => (job ? payout(job.customerPrice) + addOnTotal : 0), [job, addOnTotal]);

  if (!job) return null;

  const update = (id: string, patch: Partial<LineItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const remove = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));
  const add = () => setItems((prev) => [...prev, { id: crypto.randomUUID(), description: "", price: 0 }]);

  const send = () => {
    updateJob(jobId, { addOns: validItems, status: "pending_approval" });
    setSent(true);
  };

  if (sent) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-10 w-10" strokeWidth={2.5} />
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Request sent</h1>
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          Waiting for customer approval
        </div>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          The customer will be notified of the additional items and can approve the new total.
        </p>
        <button
          onClick={() => navigate({ to: "/provider" })}
          className="mt-8 flex h-12 items-center justify-center rounded-2xl bg-primary px-8 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99]"
        >
          Back to jobs
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-36">
        <Link to="/provider" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        {/* Job details */}
        {job.photo && (
          <div className="mt-5 overflow-hidden rounded-3xl">
            <img src={job.photo} alt="" className="aspect-[16/10] w-full object-cover" />
          </div>
        )}

        <h1 className="mt-5 text-3xl font-bold tracking-tight">{job.category}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{job.description}</p>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> {job.customerAddress}
        </div>

        <div className="mt-4 rounded-3xl border border-border bg-card p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Original payout</span>
            <span className="text-2xl font-bold tracking-tight text-primary">${payout(job.customerPrice)}</span>
          </div>
        </div>

        <h2 className="mt-6 text-lg font-bold tracking-tight">Add price adjustments</h2>
        <p className="mt-1 text-sm text-muted-foreground">Describe extra items or work and set a price for each.</p>

        <section className="mt-4 space-y-3">
          {items.map((item, idx) => (
            <div key={item.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Item #{idx + 1}
                </span>
                {items.length > 1 && (
                  <button onClick={() => remove(item.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Item description</label>
              <input
                value={item.description}
                onChange={(e) => update(item.id, { description: e.target.value })}
                placeholder="e.g. Extra mattress"
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
              />
              <label className="mb-1 mt-3 block text-xs font-medium text-muted-foreground">Price</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step="0.01"
                  value={item.price || ""}
                  onChange={(e) => update(item.id, { price: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                  className="h-11 w-full rounded-xl border border-border bg-background pl-7 pr-3 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                />
              </div>
            </div>
          ))}

          <button
            onClick={add}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card text-sm font-medium text-muted-foreground transition hover:border-primary hover:text-primary"
          >
            <Plus className="h-4 w-4" /> Add another item
          </button>
        </section>

        <section className="mt-6 rounded-3xl border border-border bg-card p-5">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Original customer price</span>
            <span>${job.customerPrice}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
            <span>Adjustments</span>
            <span>+ ${addOnTotal}</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-sm font-medium">New customer total</span>
            <span className="text-3xl font-bold tracking-tight text-primary">${newTotal}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Your new payout</span>
            <span className="font-semibold text-foreground">${newPayout}</span>
          </div>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-md">
          <button
            disabled={validItems.length === 0}
            onClick={send}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
          >
            Send to customer for approval
          </button>
        </div>
      </div>
    </main>
  );
}
