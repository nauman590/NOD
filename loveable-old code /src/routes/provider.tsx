import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MapPin, DollarSign, CheckCircle2, Navigation } from "lucide-react";
import { loadJobs, updateJob, payout, providerPayout, type Job } from "@/lib/provider-store";

export const Route = createFileRoute("/provider")({
  component: ProviderDashboard,
  head: () => ({
    meta: [
      { title: "Provider Dashboard — Tasker" },
      { name: "description", content: "Claim and manage on-demand jobs near you." },
    ],
  }),
});

function ProviderDashboard() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [tab, setTab] = useState<"available" | "active">("available");
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    const refresh = () => setJobs(loadJobs());
    refresh();
    window.addEventListener("provider-jobs-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("provider-jobs-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (pathname !== "/provider") {
    return <Outlet />;
  }

  const available = jobs.filter((j) => j.status === "available");
  const active = jobs.filter((j) => j.status !== "available" && j.status !== "declined");

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-8 pb-24">
        <header className="mb-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
            <Link
              to="/"
              className="shrink-3 text-xs font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
            >
              Customer view
            </Link>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Find work nearby and manage active tasks.
          </p>
        </header>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-2xl border border-border bg-card p-1">
          {(["available", "active"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold capitalize transition ${
                tab === t
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
              <span className="ml-1.5 text-xs opacity-70">
                ({t === "available" ? available.length : active.length})
              </span>
            </button>
          ))}
        </div>

        {tab === "available" ? (
          <div className="space-y-4">
            {available.length === 0 && <EmptyState text="No jobs available right now." />}
            {available.map((j) => (
              <AvailableCard key={j.id} job={j} />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {active.length === 0 && <EmptyState text="You haven't claimed any jobs yet." />}
            {active.map((j) => (
              <ActiveCard key={j.id} job={j} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function AvailableCard({ job }: { job: Job }) {
  const claim = () => updateJob(job.id, { status: "active" });
  return (
    <article className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      {job.photo && <img src={job.photo} alt="" className="aspect-[16/10] w-full object-cover" />}
      <div className="p-5">
        <h3 className="text-lg font-bold tracking-tight">{job.category}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{job.description}</p>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> {job.distance} miles away
        </div>
        <div className="mt-4 flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Your payout
          </span>
          <span className="text-3xl font-bold tracking-tight text-primary">
            ${payout(job.customerPrice)}
          </span>
        </div>
        <button
          onClick={claim}
          className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-md shadow-primary/30 transition active:scale-[0.99]"
        >
          Claim job
        </button>
      </div>
    </article>
  );
}

function ActiveCard({ job }: { job: Job }) {
  const navigate = useNavigate();
  const earn = providerPayout(job);

  const adjust = () => {
    console.log("Adjust tapped", { jobId: job.id });
    navigate({ to: "/provider/adjust/$jobId", params: { jobId: job.id } });
  };

  const openMaps = () => {
    const q = encodeURIComponent(job.customerAddress);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${q}`, "_blank");
  };

  const complete = () => {
    if (confirm("Mark this job complete?")) {
      updateJob(job.id, { status: "available", addOns: [] });
      alert("Job completed. Payout queued.");
    }
  };

  return (
    <article className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      {job.photo && <img src={job.photo} alt="" className="aspect-[16/9] w-full object-cover" />}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold tracking-tight">{job.category}</h3>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{job.description}</p>
          </div>
          <StatusBadge status={job.status} />
        </div>

        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> {job.customerAddress}
        </div>

        <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Payout
          </span>
          <span className="text-2xl font-bold tracking-tight text-primary">${earn}</span>
        </div>

        {job.status === "declined" && (
          <p className="mt-3 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
            Customer declined add-ons — proceed with original scope.
          </p>
        )}
        {job.status === "approved" && (
          <p className="mt-3 rounded-xl bg-primary/10 p-3 text-xs font-medium text-primary">
            Approved — start work!
          </p>
        )}
        {job.status === "pending_approval" && (
          <p className="mt-3 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
            Waiting for customer approval on add-ons…
          </p>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <ActionBtn
            icon={<Navigation className="h-4 w-4" />}
            label="Navigate"
            onClick={openMaps}
          />
          <ActionBtn icon={<DollarSign className="h-4 w-4" />} label="Adjust" onClick={adjust} />
          <ActionBtn
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Complete"
            onClick={complete}
            primary
          />
        </div>

        {job.status === "pending_approval" && (
          <Link
            to="/provider/approval/$jobId"
            params={{ jobId: job.id }}
            className="mt-3 block text-center text-xs text-muted-foreground underline"
          >
            Preview customer approval screen →
          </Link>
        )}
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: Job["status"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "Active", cls: "bg-primary/10 text-primary" },
    pending_approval: { label: "Pending", cls: "bg-muted text-muted-foreground" },
    approved: { label: "Approved", cls: "bg-primary text-primary-foreground" },
    declined: { label: "Declined", cls: "bg-muted text-muted-foreground" },
  };
  const v = map[status];
  if (!v) return null;
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${v.cls}`}
    >
      {v.label}
    </span>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition active:scale-[0.97] ${
        primary
          ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
          : "border border-border bg-background hover:bg-muted"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
