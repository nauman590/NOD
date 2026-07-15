import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Bell, Check, X } from "lucide-react";
import { loadJobs, updateJob, jobTotal, type Job } from "@/lib/provider-store";

export const Route = createFileRoute("/provider/approval/$jobId")({
  component: CustomerApproval,
  head: () => ({ meta: [{ title: "Customer approval — Tasker" }] }),
});

function CustomerApproval() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [decision, setDecision] = useState<null | "approved" | "declined">(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    setJob(loadJobs().find((x) => x.id === jobId) || null);
  }, [jobId]);

  if (!job) return null;

  const total = jobTotal(job);
  const diff = total - job.customerPrice;

  const approve = () => {
    setProcessing(true);
    setTimeout(() => {
      updateJob(jobId, { status: "approved" });
      setDecision("approved");
      setProcessing(false);
    }, 1100);
  };

  const decline = () => {
    updateJob(jobId, { status: "declined", addOns: [] });
    setDecision("declined");
  };

  if (decision) {
    const approved = decision === "approved";
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <div
          className={`flex h-20 w-20 items-center justify-center rounded-full ${
            approved ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          {approved ? <Check className="h-10 w-10" strokeWidth={2.5} /> : <X className="h-10 w-10" strokeWidth={2.5} />}
        </div>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">
          {approved ? "Approved — start work" : "Declined"}
        </h1>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          {approved
            ? `Customer charged $${diff} for the add-ons via Stripe.`
            : "Proceed with the original scope. No charge to customer."}
        </p>
        <button
          onClick={() => navigate({ to: "/provider" })}
          className="mt-8 flex h-12 items-center justify-center rounded-2xl bg-primary px-8 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30"
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

        <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
          <Bell className="h-3.5 w-3.5" /> New notification · Customer view
        </div>

        <h1 className="mt-4 text-3xl font-bold tracking-tight">Your provider added items</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review the updated total before approving.</p>

        <section className="mt-6 rounded-3xl border border-border bg-card p-5">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Original</div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-base font-semibold">{job.category}</span>
            <span className="text-base font-semibold">${job.customerPrice}</span>
          </div>

          <div className="mt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Add-ons</div>
          <ul className="mt-2 space-y-2">
            {job.addOns.map((l) => (
              <li key={l.id} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{l.description}</span>
                <span className="font-semibold">+ ${l.price}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 border-t border-border pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">New total</span>
              <span className="text-4xl font-bold tracking-tight text-primary">${total}</span>
            </div>
            <p className="mt-1 text-right text-xs text-muted-foreground">
              You'll be charged the difference: ${diff}
            </p>
          </div>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 space-y-2 border-t border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto w-full max-w-md space-y-2">
          <button
            disabled={processing}
            onClick={approve}
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-[0.99] disabled:opacity-60"
          >
            {processing ? "Charging via Stripe…" : `Approve and pay difference · $${diff}`}
          </button>
          <button
            disabled={processing}
            onClick={decline}
            className="flex h-12 w-full items-center justify-center rounded-2xl border border-border bg-background text-sm font-semibold text-foreground transition hover:bg-muted"
          >
            Decline
          </button>
        </div>
      </div>
    </main>
  );
}
