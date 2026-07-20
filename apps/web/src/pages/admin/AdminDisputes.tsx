import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useModal, Modal } from "@/components/ui/Modal";
import AdminRatingsModal from "@/components/AdminRatingsModal";
import { dollars2 } from "@/lib/types";

interface DisputePhoto {
  id: string;
  url: string;
  uploader: { id: string; fullName: string | null; role: string } | null;
}
interface DisputeRow {
  id: string;
  status: string;
  reason: string;
  description: string | null;
  resolution: string | null;
  createdAt: string;
  raisedBy: { fullName: string | null; email: string | null; role: string };
  photos: DisputePhoto[];
  job: {
    id: string;
    basePriceCents: number;
    category: { name: string } | null;
    customer: { id: string; fullName: string | null } | null;
    provider: { id: string; user: { id: string; fullName: string | null } | null } | null;
  };
}

type Outcome = "full_refund" | "partial_refund" | "no_refund" | "additional_charge";
const OUTCOMES: { key: Outcome; label: string }[] = [
  { key: "full_refund", label: "Full refund" },
  { key: "partial_refund", label: "Partial refund" },
  { key: "no_refund", label: "No refund" },
  { key: "additional_charge", label: "Additional charge" },
];

const STATUS_CLS: Record<string, string> = {
  OPEN: "bg-amber-500/15 text-amber-600",
  UNDER_REVIEW: "bg-primary/10 text-primary",
  RESOLVED: "bg-primary/10 text-primary",
  REJECTED: "bg-destructive/10 text-destructive",
};

export default function AdminDisputes() {
  useEffect(() => { document.title = "Disputes — NOD Admin"; }, []);
  const qc = useQueryClient();
  const modal = useModal();
  const { data: disputes = [] } = useQuery({ queryKey: ["admin", "disputes"], queryFn: () => api<DisputeRow[]>("/admin/disputes"), refetchInterval: 15000 });

  const [resolveFor, setResolveFor] = useState<DisputeRow | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("partial_refund");
  const [amount, setAmount] = useState(0);
  const [resolution, setResolution] = useState("");
  const [ratingsFor, setRatingsFor] = useState<{ userId: string; name: string } | null>(null);

  const resolveM = useMutation({
    mutationFn: (body: { id: string; status: string; resolution?: string; refundCents?: number; additionalChargeCents?: number }) =>
      api(`/admin/disputes/${body.id}`, { method: "PATCH", body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); closeResolve(); },
    onError: (e: any) => modal.alert("Couldn't resolve", e?.message || "Please try again."),
  });

  const closeResolve = () => { setResolveFor(null); setAmount(0); setResolution(""); setOutcome("partial_refund"); };

  const openResolve = (d: DisputeRow) => {
    setResolveFor(d);
    setOutcome("partial_refund");
    setAmount(0);
    setResolution("Resolved in customer's favor");
  };

  // When the outcome changes, prefill the amount sensibly.
  const pickOutcome = (o: Outcome) => {
    setOutcome(o);
    if (o === "full_refund" && resolveFor) setAmount(Math.round(resolveFor.job.basePriceCents) / 100);
    else if (o === "no_refund") setAmount(0);
  };

  const submitResolve = () => {
    if (!resolveFor) return;
    const cents = Math.round(amount * 100);
    resolveM.mutate({
      id: resolveFor.id,
      status: "RESOLVED",
      resolution,
      refundCents: outcome === "full_refund" || outcome === "partial_refund" ? cents : 0,
      additionalChargeCents: outcome === "additional_charge" ? cents : 0,
    });
  };

  const act = async (id: string, status: string, label: string) => {
    if (await modal.confirm({ title: `${label}?`, body: "The reporter will be notified.", confirmLabel: label }))
      resolveM.mutate({ id, status, resolution: label });
  };

  const banM = useMutation({
    mutationFn: (path: string) => api(path, { method: "POST", body: { reason: "Policy violation (dispute)" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });

  // Ban the party the report is against: a customer's report targets the provider, and vice-versa.
  const banOffender = async (d: DisputeRow) => {
    const reporterIsCustomer = d.raisedBy.role === "CUSTOMER";
    const path = reporterIsCustomer
      ? d.job.provider && `/admin/providers/${d.job.provider.id}/deactivate`
      : d.job.customer && `/admin/customers/${d.job.customer.id}/suspend`;
    if (!path) return modal.alert("Can't ban", "The offending party isn't on this job yet.");
    const who = reporterIsCustomer ? d.job.provider?.user?.fullName ?? "the provider" : d.job.customer?.fullName ?? "the customer";
    if (await modal.confirm({ title: `Ban ${who}?`, body: "They will be deactivated/suspended.", confirmLabel: "Ban", destructive: true }))
      banM.mutate(path);
  };

  const amountLabel =
    outcome === "additional_charge" ? "Charge the customer ($)" : outcome === "no_refund" ? "No amount" : "Refund to customer ($)";
  const amountDisabled = outcome === "no_refund";

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Disputes</h1>
      <p className="mt-1 text-sm text-muted-foreground">Reported issues with evidence. Captured funds are held in escrow until resolved.</p>

      <div className="mt-6 space-y-3">
        {disputes.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">No disputes.</div>
        )}
        {disputes.map((d) => (
          <div key={d.id} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${STATUS_CLS[d.status] ?? "bg-muted"}`}>{d.status.replace("_", " ")}</span>
                  <span className="text-sm font-semibold">{d.reason}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {d.job.category?.name} · raised by {d.raisedBy.fullName ?? d.raisedBy.email} ({d.raisedBy.role})
                </div>
                {d.description && <p className="mt-2 text-sm text-muted-foreground">{d.description}</p>}

                {/* Evidence photos (Sprint 5, item 1) */}
                {d.photos.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {d.photos.map((ph) => (
                      <a key={ph.id} href={ph.url} target="_blank" rel="noreferrer" title={`by ${ph.uploader?.fullName ?? "—"} (${ph.uploader?.role?.toLowerCase()})`}>
                        <img src={ph.url} alt="evidence" className="h-16 w-16 rounded-lg object-cover ring-1 ring-border" />
                      </a>
                    ))}
                  </div>
                )}

                {d.resolution && <p className="mt-2 text-xs text-primary">Resolution: {d.resolution}</p>}

                {/* Manual rating adjustments for either party (Sprint 5, item 3) */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {d.job.provider?.user && (
                    <button
                      onClick={() => setRatingsFor({ userId: d.job.provider!.user!.id, name: d.job.provider!.user!.fullName ?? "Provider" })}
                      className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted"
                    >
                      Adjust provider rating
                    </button>
                  )}
                  {d.job.customer && (
                    <button
                      onClick={() => setRatingsFor({ userId: d.job.customer!.id, name: d.job.customer!.fullName ?? "Customer" })}
                      className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted"
                    >
                      Adjust customer rating
                    </button>
                  )}
                </div>
              </div>

              {(d.status === "OPEN" || d.status === "UNDER_REVIEW") && (
                <div className="flex shrink-0 flex-col gap-2">
                  {d.status === "OPEN" && (
                    <button onClick={() => act(d.id, "UNDER_REVIEW", "Start review")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Review</button>
                  )}
                  <button onClick={() => openResolve(d)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Resolve</button>
                  <button onClick={() => act(d.id, "REJECTED", "Reject")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-destructive">Reject</button>
                  <button onClick={() => banOffender(d)} className="rounded-lg border border-destructive bg-destructive/5 px-3 py-1.5 text-xs font-semibold text-destructive">Ban offender</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!resolveFor} onClose={closeResolve}>
        {resolveFor && (
          <>
            <h2 className="text-lg font-bold tracking-tight">Resolve dispute</h2>
            <p className="mt-1 text-sm text-muted-foreground">{resolveFor.reason} · {resolveFor.job.category?.name} · base {dollars2(resolveFor.job.basePriceCents)}</p>

            <div className="mt-4">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Outcome</span>
              <div className="grid grid-cols-2 gap-2">
                {OUTCOMES.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => pickOutcome(o.key)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                      outcome === o.key ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">{amountLabel}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={amountDisabled}
                  value={amount}
                  onChange={(e) => setAmount(+e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary disabled:opacity-50"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Resolution note</span>
                <input value={resolution} onChange={(e) => setResolution(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
              </label>
            </div>

            {outcome === "additional_charge" && (
              <p className="mt-3 rounded-xl bg-amber-500/10 p-2.5 text-[11px] text-amber-600">The customer's card is charged and the amount is credited to the provider.</p>
            )}
            {(outcome === "full_refund" || outcome === "partial_refund") && (
              <p className="mt-3 rounded-xl bg-muted p-2.5 text-[11px] text-muted-foreground">If the provider was already paid out, the refund is recovered from their next payout.</p>
            )}

            <div className="mt-5 flex gap-2">
              <button onClick={closeResolve} className="h-11 flex-1 rounded-2xl border border-border text-sm font-semibold">Cancel</button>
              <button disabled={resolveM.isPending} onClick={submitResolve}
                className="h-11 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">
                {resolveM.isPending
                  ? "Resolving…"
                  : outcome === "no_refund"
                    ? "Resolve"
                    : outcome === "additional_charge"
                      ? `Resolve + charge $${amount || 0}`
                      : `Resolve + refund $${amount || 0}`}
              </button>
            </div>
          </>
        )}
      </Modal>

      <AdminRatingsModal userId={ratingsFor?.userId ?? null} name={ratingsFor?.name ?? ""} onClose={() => setRatingsFor(null)} />
    </div>
  );
}
