import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, MapPin, Clock, Bell } from "lucide-react";
import { api } from "@/lib/api";
import { getSocket, useSocketEvent } from "@/lib/socket";
import { useModal } from "@/components/ui/Modal";
import NotificationsBell from "@/components/NotificationsBell";
import LiveTrackingMap from "@/components/LiveTrackingMap";
import JobChat from "@/components/JobChat";
import type { Job, JobStatus } from "@/lib/types";
import { dollars } from "@/lib/types";

const IN_TRANSIT = new Set<JobStatus>(["EN_ROUTE", "ARRIVED", "IN_PROGRESS"]);

const STEPS: { key: JobStatus; label: string }[] = [
  { key: "AVAILABLE", label: "Finding a pro" },
  { key: "CLAIMED", label: "Pro assigned" },
  { key: "EN_ROUTE", label: "On the way" },
  { key: "ARRIVED", label: "Arrived" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "COMPLETE", label: "Complete" },
];

const STEP_INDEX: Record<string, number> = {
  AVAILABLE: 0, CLAIMED: 1, PENDING_APPROVAL: 1, APPROVED: 1, DECLINED: 1,
  EN_ROUTE: 2, ARRIVED: 3, IN_PROGRESS: 4, COMPLETE: 5, CANCELLED: 0,
};

export default function JobTracking() {
  const { jobId } = useParams() as { jobId: string };
  const qc = useQueryClient();
  const modal = useModal();

  useEffect(() => {
    document.title = "Track your job — Tasker";
    getSocket()?.emit("job:subscribe", { jobId });
  }, [jobId]);

  const { data: job } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api<Job>(`/jobs/${jobId}`),
    refetchInterval: 8000,
  });

  const [liveLoc, setLiveLoc] = useState<{ lat: number; lng: number; ts: number } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["job", jobId] });
  useSocketEvent("job.updated", (j: Job) => j.id === jobId && qc.setQueryData(["job", jobId], j));
  useSocketEvent("job.status_changed", invalidate);
  useSocketEvent("job.adjustment_requested", invalidate);
  useSocketEvent("job.completed", invalidate);
  useSocketEvent("provider.location", (p: { jobId: string; lat: number; lng: number; ts: number }) => {
    if (p.jobId === jobId) setLiveLoc({ lat: p.lat, lng: p.lng, ts: p.ts });
  });

  const approve = useMutation({
    mutationFn: () => api(`/jobs/${jobId}/adjustments/approve`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const decline = useMutation({
    mutationFn: () => api(`/jobs/${jobId}/adjustments/decline`, { method: "POST" }),
    onSuccess: invalidate,
  });

  if (!job) return <main className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Loading…</main>;

  const current = STEP_INDEX[job.status] ?? 0;
  const pending = job.addOns.filter((a) => a.status === "PENDING");
  const newTotal = job.basePriceCents + job.pendingAddOnsCents;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-12">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
          <NotificationsBell />
        </div>

        <h1 className="mt-5 text-2xl font-bold tracking-tight">{job.category}</h1>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{job.description}</p>
        {job.serviceAddress && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> {job.serviceAddress}
          </div>
        )}

        {job.status === "CANCELLED" ? (
          <div className="mt-6 rounded-3xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            This job was cancelled.
          </div>
        ) : (
          <>
            {/* Add-on approval */}
            {job.status === "PENDING_APPROVAL" && pending.length > 0 && (
              <section className="mt-6 rounded-3xl border border-primary/30 bg-primary/5 p-5">
                <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                  <Bell className="h-3.5 w-3.5" /> Your pro added items
                </div>
                <ul className="mt-3 space-y-2">
                  {pending.map((a) => (
                    <li key={a.id} className="flex items-center justify-between text-sm">
                      <span>{a.description}</span>
                      <span className="font-semibold">+ {dollars(a.priceCents)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex items-baseline justify-between border-t border-border pt-3">
                  <span className="text-sm text-muted-foreground">New total</span>
                  <span className="text-3xl font-bold tracking-tight text-primary">{dollars(newTotal)}</span>
                </div>
                <div className="mt-4 space-y-2">
                  <button
                    disabled={approve.isPending}
                    onClick={() => approve.mutate()}
                    className="flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30 disabled:opacity-60"
                  >
                    {approve.isPending ? "Approving…" : `Approve · pay ${dollars(job.pendingAddOnsCents)} more`}
                  </button>
                  <button
                    disabled={decline.isPending}
                    onClick={async () => {
                      if (await modal.confirm({ title: "Decline add-ons?", body: "Your pro will proceed with the original scope.", confirmLabel: "Decline" }))
                        decline.mutate();
                    }}
                    className="flex h-11 w-full items-center justify-center rounded-2xl border border-border bg-background text-sm font-semibold text-foreground hover:bg-muted"
                  >
                    Decline
                  </button>
                </div>
              </section>
            )}

            {/* Live location while the pro is in transit */}
            {IN_TRANSIT.has(job.status) && (
              <LiveTrackingMap
                lat={liveLoc?.lat ?? job.providerLat ?? null}
                lng={liveLoc?.lng ?? job.providerLng ?? null}
                lastUpdate={liveLoc?.ts ?? null}
                etaMinutes={job.etaMinutes}
              />
            )}

            {/* Status timeline */}
            <section className="mt-6 rounded-3xl border border-border bg-card p-5">
              <ol className="space-y-4">
                {STEPS.map((s, i) => {
                  const done = i < current;
                  const active = i === current;
                  return (
                    <li key={s.key} className="flex items-center gap-3">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${
                          done || active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {done ? <Check className="h-4 w-4" /> : i + 1}
                      </span>
                      <span className={`text-sm ${active ? "font-semibold text-foreground" : done ? "text-foreground" : "text-muted-foreground"}`}>
                        {s.label}
                      </span>
                      {active && job.status !== "COMPLETE" && (
                        <Clock className="ml-auto h-4 w-4 animate-pulse text-primary" />
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* Summary */}
            <section className="mt-6 rounded-3xl border border-border bg-card p-5">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Base price</span>
                <span>{dollars(job.basePriceCents)}</span>
              </div>
              {job.approvedAddOnsCents > 0 && (
                <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
                  <span>Add-ons</span>
                  <span>+ {dollars(job.approvedAddOnsCents)}</span>
                </div>
              )}
              <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
                <span className="text-sm font-medium">Total</span>
                <span className="text-2xl font-bold tracking-tight text-primary">{dollars(job.customerTotalCents)}</span>
              </div>
              {job.providerName && (
                <p className="mt-3 text-xs text-muted-foreground">Your pro: {job.providerName}</p>
              )}
            </section>

            {job.photos && job.photos.length > 0 && (
              <section className="mt-6 rounded-3xl border border-border bg-card p-5">
                <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Photo proof</h2>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {(["BEFORE", "AFTER"] as const).map((k) => {
                    const p = job.photos.find((x) => x.kind === k);
                    return (
                      <div key={k}>
                        <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{k.toLowerCase()}</div>
                        {p ? (
                          <img src={p.url} alt={k} className="aspect-square w-full rounded-xl object-cover" />
                        ) : (
                          <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-muted text-xs text-muted-foreground">—</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {job.status !== "AVAILABLE" && <JobChat jobId={jobId} />}

            {job.status === "COMPLETE" && (
              <Link
                to={`/job/${jobId}/rate`}
                className="mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/30"
              >
                Rate your pro
              </Link>
            )}

            {job.status !== "AVAILABLE" && (
              <div className="mt-4 text-center">
                <Link to={`/job/${jobId}/report`} className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-destructive">
                  Report an issue with this job
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
