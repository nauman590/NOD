import { Link, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { MapPin, DollarSign, CheckCircle2, Navigation, Clock, MessageCircle, Camera, Loader2 } from "lucide-react";
import { api, uploadFile } from "@/lib/api";
import { getSocket, useSocketEvent } from "@/lib/socket";
import { useModal } from "@/components/ui/Modal";
import ProviderHeader from "@/components/ProviderHeader";
import JobChat from "@/components/JobChat";
import type { Job, JobCard, JobStatus } from "@/lib/types";
import { dollars } from "@/lib/types";

const IN_TRANSIT = new Set<JobStatus>(["EN_ROUTE", "ARRIVED", "IN_PROGRESS"]);

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
  const [tab, setTab] = useState<"available" | "active">("available");

  useEffect(() => {
    document.title = "Provider Dashboard — Tasker";
    getSocket();
  }, []);

  const me = useQuery({ queryKey: ["provider-me"], queryFn: () => api<any>("/providers/me") });
  const isActive = me.data?.status === "ACTIVE";

  const available = useQuery({ queryKey: ["available"], queryFn: () => api<JobCard[]>("/jobs/available"), refetchInterval: 15000, enabled: isActive });
  const active = useQuery({ queryKey: ["active"], queryFn: () => api<Job[]>("/jobs/active"), refetchInterval: 15000, enabled: isActive });

  useSocketEvent("job.available", () => qc.invalidateQueries({ queryKey: ["available"] }));
  useSocketEvent("job.claimed", () => qc.invalidateQueries({ queryKey: ["available"] }));
  useSocketEvent("job.assigned", () => {
    qc.invalidateQueries({ queryKey: ["available"] });
    qc.invalidateQueries({ queryKey: ["active"] });
  });
  useSocketEvent("job.adjustment_approved", () => qc.invalidateQueries({ queryKey: ["active"] }));
  useSocketEvent("job.adjustment_declined", () => qc.invalidateQueries({ queryKey: ["active"] }));

  const availList = available.data ?? [];
  const activeList = active.data ?? [];

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
              {(["available", "active"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-semibold capitalize transition ${
                    tab === t ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                  <span className="ml-1.5 text-xs opacity-70">({t === "available" ? availList.length : activeList.length})</span>
                </button>
              ))}
            </div>

            {tab === "available" ? (
              <div className="space-y-4">
                {availList.length === 0 && <EmptyState text="No jobs available right now." />}
                {availList.map((j) => <AvailableCard key={j.id} job={j} />)}
              </div>
            ) : (
              <div className="space-y-4">
                {activeList.length === 0 && <EmptyState text="You haven't claimed any jobs yet." />}
                {activeList.map((j) => <ActiveCard key={j.id} job={j} />)}
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

function AvailableCard({ job }: { job: JobCard }) {
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
        {job.distanceMiles != null && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> {job.distanceMiles} miles away
          </div>
        )}
        <div className="mt-4 flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your payout</span>
          <span className="text-3xl font-bold tracking-tight text-primary">{dollars(job.providerPayoutCents)}</span>
        </div>
        <button
          disabled={claim.isPending}
          onClick={() => claim.mutate()}
          className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-md shadow-primary/30 transition active:scale-[0.99] disabled:opacity-60"
        >
          {claim.isPending ? "Claiming…" : "Claim job"}
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
  useLocationBroadcast(job.id, inTransit);

  const refresh = () => qc.invalidateQueries({ queryKey: ["active"] });
  const act = (path: string) => api(`/jobs/${job.id}/${path}`, { method: "POST" }).then(refresh);

  const nextStep: Record<string, { label: string; path: string } | null> = {
    CLAIMED: { label: "Start driving", path: "en-route" },
    EN_ROUTE: { label: "I've arrived", path: "arrived" },
    ARRIVED: { label: "Start job", path: "start" },
    APPROVED: { label: "Start job", path: "start" },
    DECLINED: { label: "Start job", path: "start" },
  };
  const step = nextStep[job.status] ?? null;

  const openMaps = () => {
    const q = encodeURIComponent(job.serviceAddress ?? "");
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${q}`, "_blank");
  };

  const complete = async () => {
    if (await modal.confirm({ title: "Mark this job complete?", confirmLabel: "Complete" })) {
      const r: any = await api(`/jobs/${job.id}/complete`, { method: "POST" });
      refresh();
      await modal.alert("Job complete", `Payout queued: ${dollars(r.payoutCents)}.`);
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

        {inTransit && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" /> Sharing live location
          </div>
        )}

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
          <button
            onClick={() => act(step.path)}
            className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30"
          >
            {step.label}
          </button>
        )}

        <div className="mt-3 grid grid-cols-3 gap-2">
          <ActionBtn icon={<Navigation className="h-4 w-4" />} label="Navigate" onClick={openMaps} />
          <ActionBtn icon={<DollarSign className="h-4 w-4" />} label="Adjust" onClick={() => navigate(`/provider/adjust/${job.id}`)} />
          <ActionBtn icon={<CheckCircle2 className="h-4 w-4" />} label="Complete" onClick={complete} primary />
        </div>

        {(job.status === "ARRIVED" || job.status === "IN_PROGRESS" || job.status === "APPROVED" || job.status === "DECLINED") && (
          <ProviderPhotos job={job} />
        )}

        <button
          onClick={() => setShowChat((v) => !v)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
        >
          <MessageCircle className="h-4 w-4" /> {showChat ? "Hide chat" : "Message customer"}
        </button>
        {showChat && <JobChat jobId={job.id} />}
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

function ProviderPhotos({ job }: { job: Job }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<null | "BEFORE" | "AFTER">(null);
  const refs = { BEFORE: useRef<HTMLInputElement>(null), AFTER: useRef<HTMLInputElement>(null) };
  const has = (k: "BEFORE" | "AFTER") => job.photos?.some((p) => p.kind === k);

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
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Photo proof</div>
      <div className="grid grid-cols-2 gap-2">
        <Tile kind="BEFORE" />
        <Tile kind="AFTER" />
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick, primary }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition active:scale-[0.97] ${
        primary ? "bg-primary text-primary-foreground shadow-md shadow-primary/30" : "border border-border bg-background hover:bg-muted"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
