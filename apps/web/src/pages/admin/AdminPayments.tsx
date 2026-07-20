import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useModal, Modal } from "@/components/ui/Modal";
import { dollars2 } from "@/lib/types";

interface PaymentRow {
  id: string;
  jobId: string | null;
  type: string;
  status: string;
  amountCents: number;
  refundedAmountCents: number | null;
  stripePaymentIntentId: string | null;
  createdAt: string;
  user: { id: string; fullName: string | null; email: string | null } | null;
}

// Only customer-facing charges are refundable (a PAYOUT is money sent TO a provider).
const REFUNDABLE_TYPES = new Set(["BASE", "ADDON", "DISPUTE_CHARGE", "CANCELLATION_FEE"]);
const remaining = (p: PaymentRow) => p.amountCents - (p.refundedAmountCents ?? 0);
const canRefund = (p: PaymentRow) =>
  REFUNDABLE_TYPES.has(p.type) && (p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED") && remaining(p) > 0;

const STATUS_CLS: Record<string, string> = {
  CAPTURED: "bg-primary/10 text-primary",
  AUTHORIZED: "bg-amber-500/15 text-amber-600",
  REFUNDED: "bg-muted text-muted-foreground",
  PARTIALLY_REFUNDED: "bg-amber-500/15 text-amber-600",
  FAILED: "bg-destructive/10 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
};

export default function AdminPayments() {
  useEffect(() => { document.title = "Payments — NOD Admin"; }, []);
  const qc = useQueryClient();
  const modal = useModal();
  const { data: payments = [] } = useQuery({ queryKey: ["admin", "payments"], queryFn: () => api<PaymentRow[]>("/admin/payments"), refetchInterval: 20000 });

  const [refundFor, setRefundFor] = useState<PaymentRow | null>(null);
  const [amount, setAmount] = useState(0);

  const refundM = useMutation({
    mutationFn: () => api(`/admin/payments/${refundFor!.id}/refund`, { method: "POST", body: { amountCents: Math.round(amount * 100) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); setRefundFor(null); setAmount(0); },
    onError: (e: any) => modal.alert("Refund failed", e?.message || "Please try again."),
  });

  const openRefund = (p: PaymentRow) => { setRefundFor(p); setAmount(remaining(p) / 100); };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every charge, add-on, fee and payout. Issue an ad-hoc refund on any customer charge.</p>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-card text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Payer</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Refunded</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {payments.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No payments yet.</td></tr>
            )}
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{p.user?.fullName ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{p.user?.email ?? "—"}</div>
                </td>
                <td className="px-4 py-3 text-xs font-medium text-muted-foreground">{p.type.replace(/_/g, " ")}</td>
                <td className="px-4 py-3 text-right font-medium">{dollars2(p.amountCents)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${STATUS_CLS[p.status] ?? "bg-muted"}`}>
                    {p.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">{p.refundedAmountCents ? dollars2(p.refundedAmountCents) : "—"}</td>
                <td className="px-4 py-3 text-right">
                  {canRefund(p) ? (
                    <button onClick={() => openRefund(p)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/5">
                      Refund
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!refundFor} onClose={() => setRefundFor(null)}>
        {refundFor && (
          <>
            <h2 className="text-lg font-bold tracking-tight">Refund payment</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {refundFor.type.replace(/_/g, " ")} · {dollars2(refundFor.amountCents)} · refundable {dollars2(remaining(refundFor))}
            </p>
            <div className="mt-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Amount to refund ($)</span>
                <input type="number" min={0} step="0.01" max={remaining(refundFor) / 100} value={amount} onChange={(e) => setAmount(+e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
              </label>
            </div>
            {!refundFor.stripePaymentIntentId && (
              <p className="mt-3 rounded-xl bg-muted p-2.5 text-[11px] text-muted-foreground">No Stripe charge on file — this records a ledger refund only.</p>
            )}
            <div className="mt-5 flex gap-2">
              <button onClick={() => setRefundFor(null)} className="h-11 flex-1 rounded-2xl border border-border text-sm font-semibold">Cancel</button>
              <button
                disabled={refundM.isPending || amount <= 0 || Math.round(amount * 100) > remaining(refundFor)}
                onClick={() => refundM.mutate()}
                className="h-11 flex-1 rounded-2xl bg-destructive text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {refundM.isPending ? "Refunding…" : `Refund $${amount || 0}`}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
