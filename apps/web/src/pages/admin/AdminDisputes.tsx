import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useModal, Modal } from "@/components/ui/Modal";

interface DisputeRow {
  id: string;
  status: string;
  reason: string;
  description: string | null;
  resolution: string | null;
  createdAt: string;
  raisedBy: { fullName: string | null; email: string | null; role: string };
  job: {
    id: string;
    category: { name: string } | null;
    customer: { id: string; fullName: string | null } | null;
    provider: { id: string; user: { fullName: string | null } | null } | null;
  };
}

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

  const [refundFor, setRefundFor] = useState<DisputeRow | null>(null);
  const [refund, setRefund] = useState(0);
  const [resolution, setResolution] = useState("");

  const resolveM = useMutation({
    mutationFn: ({ id, status, resolution, refundCents }: { id: string; status: string; resolution?: string; refundCents?: number }) =>
      api(`/admin/disputes/${id}`, { method: "PATCH", body: { status, resolution, refundCents } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "disputes"] }); setRefundFor(null); setRefund(0); setResolution(""); },
  });

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

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Disputes</h1>
      <p className="mt-1 text-sm text-muted-foreground">Reported issues. Captured funds are held in escrow until resolved.</p>

      <div className="mt-6 space-y-3">
        {disputes.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">No disputes.</div>
        )}
        {disputes.map((d) => (
          <div key={d.id} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${STATUS_CLS[d.status] ?? "bg-muted"}`}>{d.status.replace("_", " ")}</span>
                  <span className="text-sm font-semibold">{d.reason}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {d.job.category?.name} · raised by {d.raisedBy.fullName ?? d.raisedBy.email} ({d.raisedBy.role})
                </div>
                {d.description && <p className="mt-2 text-sm text-muted-foreground">{d.description}</p>}
                {d.resolution && <p className="mt-2 text-xs text-primary">Resolution: {d.resolution}</p>}
              </div>
              {(d.status === "OPEN" || d.status === "UNDER_REVIEW") && (
                <div className="flex shrink-0 flex-col gap-2">
                  {d.status === "OPEN" && (
                    <button onClick={() => act(d.id, "UNDER_REVIEW", "Start review")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Review</button>
                  )}
                  <button onClick={() => { setRefundFor(d); setResolution("Resolved in customer's favor"); }} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Resolve</button>
                  <button onClick={() => act(d.id, "REJECTED", "Reject")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-destructive">Reject</button>
                  <button onClick={() => banOffender(d)} className="rounded-lg border border-destructive bg-destructive/5 px-3 py-1.5 text-xs font-semibold text-destructive">Ban offender</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!refundFor} onClose={() => setRefundFor(null)}>
        {refundFor && (
          <>
            <h2 className="text-lg font-bold tracking-tight">Resolve dispute</h2>
            <p className="mt-1 text-sm text-muted-foreground">{refundFor.reason} · {refundFor.job.category?.name}</p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Resolution note</span>
                <input value={resolution} onChange={(e) => setResolution(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Refund to customer ($) — 0 for none</span>
                <input type="number" min={0} value={refund} onChange={(e) => setRefund(+e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setRefundFor(null)} className="h-11 flex-1 rounded-2xl border border-border text-sm font-semibold">Cancel</button>
              <button disabled={resolveM.isPending}
                onClick={() => resolveM.mutate({ id: refundFor.id, status: "RESOLVED", resolution, refundCents: Math.round(refund * 100) })}
                className="h-11 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">
                {resolveM.isPending ? "Resolving…" : refund > 0 ? `Resolve + refund $${refund}` : "Resolve"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
