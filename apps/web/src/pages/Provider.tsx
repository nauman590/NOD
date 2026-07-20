import { Link, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { MapPin, DollarSign, CheckCircle2, Navigation, Clock, MessageCircle, Camera, Loader2, Star, ShieldAlert } from "lucide-react";
import { api, uploadFile } from "@/lib/api";
import { getSocket, useSocketEvent } from "@/lib/socket";
import { useModal } from "@/components/ui/Modal";
import ProviderHeader from "@/components/ProviderHeader";
import JobChat from "@/components/JobChat";
import type { Job, JobCard, JobStatus, CompletedJob } from "@/lib/types";
import { dollars } from "@/lib/types";

// Compact star display for a rating aggregate.
function RatingStars({ avg, count, label }: { avg: number; count: number; label?: string }) {
  if (!count) return <span className="text-[11px] text-muted-foreground">{label ?? "No ratings yet"}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {avg.toFixed(1)}
      <span className="opacity-70">({count})</span>
    </span>
  );
}

const IN_TRANSIT = new Set<JobStatus>(["EN_ROUTE", "ARRIVED", "IN_PROGRESS"]);
// Chat opens once the job is in progress (brief: no contact until job in progress).
const CHAT_OPEN = new Set<JobStatus>(["IN_PROGRESS", "COMPLETE"]);

// Streams the device GPS to the server while a job is in transit (throttled ~5s).
function useLocationBroadcast(jobId: string, active: boolean) {
  const last = useRef(0);
  useEffect(() => {
    if (!active || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - last.current < 5000) return;
        last.current = now;
        api(`/jobs/${jobId}/location`, { method: "POST", body: { lat: pos.coords.latitude, lng: pos.coords.longitude } }).catch(() => {});
      },
      undefined,
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [jobId, active]);
}

export default function Provider() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"available" | "active" | "completed">("available");

  useEffect(() => {
    document.title = "Provider Dashboard — Tasker";
    getSocket();
  }, []);

  const me = useQuery({ queryKey: ["provider-me"], queryFn: () => api<any>("/providers/me") });
  const isActive = me.data?.status === "ACTIVE";
  const config = useQuery({ queryKey: ["payments-config"], queryFn: () => api<{ depositRequired?: boolean }>("/payments/config") });
  // When the platform requires a funded deposit to claim, block claiming until it's paid.
  const depositBlocked = !!config.data?.depositRequired && me.data?.depositStatus !== "CAPTURED";

  const available = useQuery({ queryKey: ["available"], queryFn: () => api<JobCard[]>("/jobs/available"), refetchInterval: 15000, enabled: isActive });
  const active = useQuery({ queryKey: ["active"], queryFn: () => api<Job[]>("/jobs/active"), refetchInterval: 15000, enabled: isActive });
  const completed = useQuery({ queryKey: ["completed"], queryFn: () => api<CompletedJob[]>("/jobs/completed"), enabled: isActive });

  useSocketEvent("job.available", () => qc.invalidateQueries({ queryKey: ["available"] }));
  useSocketEvent("job.claimed", () => qc.invalidateQueries({ queryKey: ["available"] }));
  useSocketEvent("job.assigned", () => {
    qc.invalidateQueries({ queryKey: ["available"] });
    qc.invalidateQueries({ queryKey: ["active"] });
  });
  useSocketEvent("job.adjustment_approved", () => qc.invalidateQueries({ queryKey: ["active"] }));
  useSocketEvent("job.adjustment_declined", () => qc.invalidateQueries({ queryKey: ["active"] }));
  useSocketEvent("job.completed", () => {
    qc.invalidateQueries({ queryKey: ["active"] });
    qc.invalidateQueries({ queryKey: ["completed"] });
  });
  // Reflect a customer/admin cancellation on the active tab without waiting for the poll.
  useSocketEvent("job.updated", () => qc.invalidateQueries({ queryKey: ["active"] }));

  const availList = available.data ?? [];
  const activeList = active.data ?? [];
  const completedList = completed.data ?? [];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-8 pb-24">
        <ProviderHeader title="Jobs" />

        {!me.data ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !isActive ? (
          <PendingApproval me={me.data} />
        ) : (
          <>
            <div className="mb-6 flex gap-1 rounded-2xl border border-border bg-card p-1">
              {(["available", "active", "completed"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-semibold capitalize transition ${
                    tab === t ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                  <span className="ml-1.5 text-xs opacity-70">
                    ({t === "available" ? availList.length : t === "active" ? activeList.length : completedList.length})
                  </span>
                </button>
              ))}
            </div>

            {tab === "available" ? (
              <div className="space-y-4">
                {depositBlocked && (
                  <Link to="/provider/account" className="block rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
                    <div className="flex items-start gap-3">
                      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                      <div>
                        <div className="text-sm font-semibold text-amber-600">Pay your $50 refundable deposit to claim jobs</div>
                        <p className="mt-0.5 text-xs text-muted-foreground">The deposit covers any penalties and is returned when you leave in good standing. Tap to add it.</p>
                      </div>
                    </div>
                  </Link>
                )}
                {availList.length === 0 && <EmptyState text="No jobs available right now." />}
                {availList.map((j) => <AvailableCard key={j.id} job={j} depositBlocked={depositBlocked} />)}
              </div>
            ) : tab === "active" ? (
              <div className="space-y-4">
                {activeList.length === 0 && <EmptyState text="You haven't claimed any jobs yet." />}
                {activeList.map((j) => <ActiveCard key={j.id} job={j} />)}
              </div>
            ) : (
              <div className="space-y-4">
                {completedList.length === 0 && <EmptyState text="No completed jobs yet." />}
                {completedList.map((j) => <CompletedCard key={j.id} job={j} />)}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function PendingApproval({ me }: { me: any }) {
  const { data: connect } = useQuery({ queryKey: ["connect-status"], queryFn: () => api<any>("/providers/me/connect/status") });
  const copy: Record<string, { title: string; body: string }> = {
    PENDING_APPROVAL: { title: "Your account is pending approval", body: "An admin is reviewing your application. You'll get access to nearby jobs as soon as you're approved. In the meantime, finish your setup below so you're ready to go." },
    SUSPENDED: { title: "Your account is suspended", body: "Your provider account is temporarily suspended. Please check back later or contact support." },
    REJECTED: { title: "Application not approved", body: "Your provider application wasn't approved. Contact support if you think this is a mistake." },
    DEACTIVATED: { title: "Account deactivated", body: "Your provider account has been deactivated." },
  };
  const c = copy[me.status] ?? { title: "Account not active", body: "" };
  const ratesSet = (me.categoryRates?.length ?? 0) > 0;
  const payouts = !!connect?.payoutsEnabled;
  const deposit = me.depositStatus === "CAPTURED";

  return (
    <div>
      <div className="rounded-3xl border border-amber-500/30 bg-amber-500/5 p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
          <Clock className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-xl font-bold tracking-tight">{c.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
      </div>

      {me.status === "PENDING_APPROVAL" && (
        <div className="mt-5 rounded-3xl border border-border bg-card p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Finish your setup</h3>
          <ul className="mt-3 space-y-2.5">
            <ChecklistItem done={ratesSet} label="Set your hourly rates" />
            <ChecklistItem done={payouts} label="Connect payouts (Stripe)" />
            <ChecklistItem done={deposit} label="Pay the $50 refundable deposit" />
          </ul>
          <Link
            to="/provider/onboarding"
            className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30"
          >
            Complete provider setup
          </Link>
        </div>
      )}
    </div>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${done ? "bg-primary text-primary-foreground" : "border border-border bg-background"}`}>
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />}
      </span>
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">{text}</div>
  );
}

function AvailableCard({ job, depositBlocked }: { job: JobCard; depositBlocked?: boolean }) {
  const qc = useQueryClient();
  const modal = useModal();
  const claim = useMutation({
    mutationFn: () => api(`/jobs/${job.id}/claim`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["available"] });
      qc.invalidateQueries({ queryKey: ["active"] });
    },
    onError: async (e: any) => {
      await modal.alert(e?.status === 409 ? "Job already taken" : "Could not claim", e?.status === 409 ? "Another pro claimed it first." : e?.message);
      qc.invalidateQueries({ queryKey: ["available"] });
    },
  });

  return (
    <article className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      {job.photoUrl && <img src={job.photoUrl} alt="" className="aspect-[16/10] w-full object-cover" />}
      <div className="p-5">
        <h3 className="text-lg font-bold tracking-tight">{job.category}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{job.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {job.distanceMiles != null && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> {job.distanceMiles} miles away
            </span>
          )}
          {/* Customer's rating, so a pro can vet who they're accepting (Sprint 4, item 1). */}
          <span className="inline-flex items-center gap-1">
            <span className="opacity-70">Customer</span>
            <RatingStars avg={job.customerRatingAvg} count={job.customerRatingCount} />
          </span>
        </div>
        <div className="mt-4 flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your payout</span>
          <span className="text-3xl font-bold tracking-tight text-primary">{dollars(job.providerPayoutCents)}</span>
        </div>
        <button
          disabled={claim.isPending || depositBlocked}
          title={depositBlocked ? "Pay your $50 deposit to claim jobs" : undefined}
          onClick={() => claim.mutate()}
          className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-md shadow-primary/30 transition active:scale-[0.99] disabled:opacity-60"
        >
          {claim.isPending ? "Claiming…" : depositBlocked ? "Deposit required to claim" : "Claim job"}
        </button>
      </div>
    </article>
  );
}

function ActiveCard({ job }: { job: Job }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const modal = useModal();
  const inTransit = IN_TRANSIT.has(job.status);
  const [showChat, setShowChat] = useState(false);
  // Photo gate (Sprint 4, item 6): a BEFORE photo is required to mark arrived, and an
  // AFTER photo is required to complete. Buttons stay disabled until each is uploaded.
  const hasBefore = job.photos?.some((p) => p.kind === "BEFORE") ?? false;
  const hasAfter = job.photos?.some((p) => p.kind === "AFTER") ?? false;
  // GPS broadcast starts when the pro taps "Navigate" (not on status change). Persisted
  // per-job so a page refresh mid-drive keeps sharing location instead of going dark.
  const navKey = `nod_nav_${job.id}`;
  const [navigating, setNavigating] = useState<boolean>(() => {
    try { return localStorage.getItem(navKey) === "1"; } catch { return false; }
  });
  useLocationBroadcast(job.id, navigating);

  const refresh = () => qc.invalidateQueries({ queryKey: ["active"] });
  const [acting, setActing] = useState(false);
  // Lifecycle step actions (en-route / arrived / start / delay-notice) can legitimately
  // fail (e.g. a photo gate or a terminal-state guard), so surface the error and hold a
  // busy state instead of firing an unhandled rejection and leaving the button live.
  const act = async (path: string) => {
    if (acting) return;
    setActing(true);
    try {
      await api(`/jobs/${job.id}/${path}`, { method: "POST" });
      refresh();
    } catch (e: any) {
      await modal.alert("Couldn't update the job", e?.message || "Please try again.");
    } finally {
      setActing(false);
    }
  };

  const nextStep: Record<string, { label: string; path: string } | null> = {
    CLAIMED: { label: "Start driving", path: "en-route" },
    EN_ROUTE: { label: "I've arrived", path: "arrived" },
    ARRIVED: { label: "Start job", path: "start" },
    APPROVED: { label: "Start job", path: "start" },
    DECLINED: { label: "Start job", path: "start" },
  };
  const step = nextStep[job.status] ?? null;

  const openMaps = () => {
    // Tapping Navigate begins the live GPS broadcast to the customer, then opens
    // turn-by-turn directions in Google Maps (deep-link).
    if (!navigating) {
      setNavigating(true);
      try { localStorage.setItem(navKey, "1"); } catch { /* ignore */ }
    }
    const q = encodeURIComponent(job.serviceAddress ?? "");
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${q}`, "_blank");
  };

  const complete = async () => {
    if (!hasAfter) {
      await modal.alert("Add an 'after' photo", "You need to upload an 'after' photo before completing the job.");
      return;
    }
    if (await modal.confirm({ title: "Mark this job complete?", confirmLabel: "Complete" })) {
      try {
        const r: any = await api(`/jobs/${job.id}/complete`, { method: "POST" });
        refresh();
        await modal.alert("Job complete", `Payout queued: ${dollars(r.payoutCents)}.`);
      } catch (e: any) {
        await modal.alert("Couldn't complete", e?.message || "Please try again.");
      }
    }
  };

  const reportOffPlatform = async () => {
    if (
      await modal.confirm({
        title: "Report off-platform payment?",
        body: "Report that this customer asked to pay off-platform (cash, Venmo, etc.). Our team verifies every report — a verified attempt results in an immediate ban.",
        confirmLabel: "Report",
        cancelLabel: "Back",
        destructive: true,
      })
    ) {
      try {
        await api(`/jobs/${job.id}/report-off-platform`, {
          method: "POST",
          body: { description: "Provider reported: customer requested off-platform payment." },
        });
        await modal.alert("Report submitted", "Thanks — our team will review it and take action if verified.");
      } catch (e: any) {
        await modal.alert("Couldn't submit", e?.message || "Please try again.");
      }
    }
  };

  const cancelJob = async () => {
    if (await modal.confirm({ title: "Cancel this job?", body: "Cancelling a job you've claimed incurs a $20 strike and can affect your standing.", confirmLabel: "Cancel job", cancelLabel: "Keep job" })) {
      try {
        await api(`/jobs/${job.id}/cancel`, { method: "POST" });
        refresh();
        await modal.alert("Job cancelled", "The job has been cancelled and removed from your active list.");
      } catch (e: any) {
        await modal.alert("Couldn't cancel", e?.message || "Please try again.");
      }
    }
  };

  const reportNoShow = async () => {
    if (await modal.confirm({ title: "Report a customer no-show?", body: "This ends the job now and applies a 50% no-show fee to the customer.", confirmLabel: "Report no-show", cancelLabel: "Back" })) {
      try {
        await api(`/jobs/${job.id}/no-show`, { method: "POST" });
        refresh();
        await modal.alert("No-show reported", "The job has been ended with a 50% no-show fee.");
      } catch (e: any) {
        await modal.alert("Couldn't report", e?.message || "Please try again.");
      }
    }
  };

  return (
    <article className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      {job.photoUrl && <img src={job.photoUrl} alt="" className="aspect-[16/9] w-full object-cover" />}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold tracking-tight">{job.category}</h3>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{job.description}</p>
          </div>
          <StatusBadge status={job.status} />
        </div>

        {job.serviceAddress && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> {job.serviceAddress}
          </div>
        )}

        {navigating ? (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" /> Sharing live location
          </div>
        ) : inTransit ? (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            Tap Navigate to share your live location
          </div>
        ) : null}

        {job.status === "EN_ROUTE" && (
          <button onClick={() => act("delay-notice")} className="mt-2 block text-[11px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground">
            Running late? Notify customer
          </button>
        )}

        <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Payout</span>
          <span className="text-2xl font-bold tracking-tight text-primary">{dollars(job.providerPayoutCents)}</span>
        </div>

        {job.status === "PENDING_APPROVAL" && (
          <p className="mt-3 rounded-xl bg-muted p-3 text-xs text-muted-foreground">Waiting for customer approval on add-ons…</p>
        )}
        {job.status === "APPROVED" && (
          <p className="mt-3 rounded-xl bg-primary/10 p-3 text-xs font-medium text-primary">Add-ons approved — start work!</p>
        )}

        {step && (
          <>
            <button
              onClick={() => act(step.path)}
              disabled={(step.path === "arrived" && !hasBefore) || acting}
              className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
            >
              {acting ? "Working…" : step.label}
            </button>
            {step.path === "arrived" && !hasBefore && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
                <Camera className="h-3.5 w-3.5" /> Add a "before" photo below to mark yourself arrived.
              </p>
            )}
          </>
        )}

        <div className="mt-3 grid grid-cols-3 gap-2">
          <ActionBtn icon={<Navigation className="h-4 w-4" />} label="Navigate" onClick={openMaps} />
          <ActionBtn icon={<DollarSign className="h-4 w-4" />} label="Adjust" onClick={() => navigate(`/provider/adjust/${job.id}`)} />
          <ActionBtn icon={<CheckCircle2 className="h-4 w-4" />} label="Complete" onClick={complete} primary disabled={!hasAfter} />
        </div>
        {!hasAfter && (job.status === "IN_PROGRESS" || job.status === "APPROVED" || job.status === "DECLINED") && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
            <Camera className="h-3.5 w-3.5" /> Add an "after" photo below before you can complete.
          </p>
        )}

        {(job.status === "EN_ROUTE" || job.status === "ARRIVED" || job.status === "IN_PROGRESS" || job.status === "APPROVED" || job.status === "DECLINED") && (
          <ProviderPhotos job={job} allowAfter={job.status !== "EN_ROUTE"} />
        )}

        {job.status === "ARRIVED" && (
          <button
            onClick={reportNoShow}
            className="mt-3 flex h-11 w-full items-center justify-center rounded-2xl border border-destructive/30 bg-background text-sm font-semibold text-destructive transition hover:bg-destructive/5"
          >
            Report customer no-show
          </button>
        )}

        {CHAT_OPEN.has(job.status) ? (
          <>
            <button
              onClick={() => setShowChat((v) => !v)}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
            >
              <MessageCircle className="h-4 w-4" /> {showChat ? "Hide chat" : "Message customer"}
            </button>
            {showChat && <JobChat jobId={job.id} />}
          </>
        ) : (
          <p className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-background py-2 text-[11px] font-medium text-muted-foreground">
            <MessageCircle className="h-4 w-4" /> Messaging opens once you start the job
          </p>
        )}

        <button
          onClick={reportOffPlatform}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-destructive/30 bg-background py-2 text-[11px] font-semibold text-destructive transition hover:bg-destructive/5"
        >
          <ShieldAlert className="h-3.5 w-3.5" /> Report off-platform payment request
        </button>

        <button
          onClick={() => navigate(`/job/${job.id}/report`)}
          className="mt-3 flex h-9 w-full items-center justify-center text-xs font-semibold text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
        >
          Report an issue with this job
        </button>

        <button
          onClick={cancelJob}
          className="mt-1 flex h-9 w-full items-center justify-center text-xs font-semibold text-muted-foreground underline underline-offset-4 transition hover:text-destructive"
        >
          Cancel job
        </button>
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: Job["status"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    CLAIMED: { label: "Claimed", cls: "bg-primary/10 text-primary" },
    EN_ROUTE: { label: "En route", cls: "bg-primary/10 text-primary" },
    ARRIVED: { label: "Arrived", cls: "bg-primary/10 text-primary" },
    IN_PROGRESS: { label: "In progress", cls: "bg-primary text-primary-foreground" },
    PENDING_APPROVAL: { label: "Pending", cls: "bg-muted text-muted-foreground" },
    APPROVED: { label: "Approved", cls: "bg-primary text-primary-foreground" },
    DECLINED: { label: "Declined", cls: "bg-muted text-muted-foreground" },
  };
  const v = map[status];
  if (!v) return null;
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${v.cls}`}>{v.label}</span>;
}

function ProviderPhotos({ job, allowAfter = true }: { job: Job; allowAfter?: boolean }) {
  const qc = useQueryClient();
  const modal = useModal();
  const [busy, setBusy] = useState<null | "BEFORE" | "AFTER">(null);
  const refs = { BEFORE: useRef<HTMLInputElement>(null), AFTER: useRef<HTMLInputElement>(null) };

  const upload = async (kind: "BEFORE" | "AFTER", file: File) => {
    setBusy(kind);
    try {
      const { url } = await uploadFile(file);
      const coords = await new Promise<{ lat?: number; lng?: number }>((res) => {
        if (!navigator.geolocation) return res({});
        navigator.geolocation.getCurrentPosition(
          (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => res({}),
          { maximumAge: 10000, timeout: 4000 },
        );
      });
      await api(`/jobs/${job.id}/photos`, { method: "POST", body: { kind, url, ...coords } });
      qc.invalidateQueries({ queryKey: ["active"] });
    } catch (e: any) {
      // Upload can fail (rejected file type, network). Tell the pro instead of silently
      // swallowing it — the photo gate would otherwise seem broken.
      await modal.alert("Photo upload failed", e?.message || "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const Tile = ({ kind }: { kind: "BEFORE" | "AFTER" }) => {
    const photo = job.photos?.find((p) => p.kind === kind);
    return (
      <div>
        <input ref={refs[kind]} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(kind, e.target.files[0])} />
        {photo ? (
          <img src={photo.url} alt={kind} className="aspect-square w-full rounded-xl object-cover" />
        ) : (
          <button onClick={() => refs[kind].current?.click()} disabled={busy === kind}
            className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-background text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary">
            {busy === kind ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {kind === "BEFORE" ? "Before" : "After"}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="mt-3 rounded-xl border border-border bg-background p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Photo proof · required</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Tile kind="BEFORE" />
        {allowAfter ? (
          <Tile kind="AFTER" />
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-muted/30 text-center text-[10px] font-medium text-muted-foreground">
            <Camera className="h-4 w-4 opacity-50" />
            After photo
            <span className="opacity-70">(unlocks on arrival)</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick, primary, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${
        primary ? "bg-primary text-primary-foreground shadow-md shadow-primary/30" : "border border-border bg-background hover:bg-muted"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// A completed job in the provider's history, with the ability to rate the customer
// (two-way ratings — Sprint 4, item 2).
function CompletedCard({ job }: { job: CompletedJob }) {
  const qc = useQueryClient();
  const modal = useModal();
  const navigate = useNavigate();
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  const [open, setOpen] = useState(false);

  const rate = useMutation({
    mutationFn: () => api(`/jobs/${job.id}/rate`, { method: "POST", body: { stars, comment: comment || undefined } }),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["completed"] });
      setOpen(false);
      await modal.alert("Thanks!", "Your rating helps other pros know who they're working with.");
    },
    onError: (e: any) => modal.alert("Couldn't submit", e?.message || "Please try again."),
  });

  return (
    <article className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold tracking-tight">{job.category}</h3>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{job.description}</p>
          </div>
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">Completed</span>
        </div>

        <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
          <Avatar url={job.customerPhotoUrl} name={job.customerName} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{job.customerName ?? "Customer"}</div>
            <RatingStars avg={job.customerRatingAvg} count={job.customerRatingCount} />
          </div>
          <div className="text-right text-sm font-bold text-primary">{dollars(job.providerPayoutCents)}</div>
        </div>

        {job.providerRatedCustomer ? (
          <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-muted px-3 py-2.5 text-xs font-medium text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" /> You rated this customer {job.providerGaveStars}★
          </div>
        ) : open ? (
          <div className="mt-3 rounded-xl border border-border bg-background p-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Rate this customer</div>
            <div className="flex justify-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setStars(n)} aria-label={`${n} stars`}>
                  <Star className={`h-8 w-8 transition ${n <= stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                </button>
              ))}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Add a note (optional)…"
              className="mt-3 w-full resize-none rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-primary"
            />
            <div className="mt-3 flex gap-2">
              <button onClick={() => setOpen(false)} className="h-10 flex-1 rounded-xl border border-border text-xs font-semibold">Cancel</button>
              <button
                disabled={rate.isPending}
                onClick={() => rate.mutate()}
                className="h-10 flex-1 rounded-xl bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {rate.isPending ? "Submitting…" : "Submit rating"}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-2xl border border-primary/40 bg-primary/5 text-sm font-semibold text-primary transition hover:bg-primary/10"
          >
            <Star className="h-4 w-4" /> Rate customer
          </button>
        )}

        <button
          onClick={() => navigate(`/job/${job.id}/report`)}
          className="mt-3 flex h-9 w-full items-center justify-center text-xs font-semibold text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
        >
          Report an issue with this job
        </button>
      </div>
    </article>
  );
}

// Small round avatar with an initial fallback.
function Avatar({ url, name }: { url: string | null; name: string | null }) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  if (url) return <img src={url} alt={name ?? ""} className="h-10 w-10 shrink-0 rounded-full object-cover" />;
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-muted-foreground">
      {initial}
    </div>
  );
}
