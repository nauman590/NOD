import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useModal, Modal } from "@/components/ui/Modal";
import { dollars2 } from "@/lib/types";

interface Strike {
  id: string;
  reason: string;
  feeCents: number;
  note: string | null;
  settledAt: string | null;
  createdAt: string;
}
interface ProviderRow {
  id: string;
  status: string;
  vehicleType: string | null;
  ratingAvg: number;
  ratingCount: number;
  depositStatus: string | null;
  backgroundCheckStatus: string | null;
  user: { fullName: string | null; email: string | null; phone: string | null };
  categoryRates: { hourlyRateCents: number; category: { name: string } }[];
  strikes: Strike[];
}

const STATUS_CLS: Record<string, string> = {
  ACTIVE: "bg-primary/10 text-primary",
  PENDING_APPROVAL: "bg-amber-500/15 text-amber-600",
  SUSPENDED: "bg-muted text-muted-foreground",
  DEACTIVATED: "bg-destructive/10 text-destructive",
  REJECTED: "bg-destructive/10 text-destructive",
};

const bgPassed = (s: string | null) => s === "PASSED" || s === "STUB_PASSED";
const bgLabel = (s: string | null) =>
  bgPassed(s) ? "check ✓" : s === "FAILED" ? "check ✗" : "check pending";

export default function AdminProviders() {
  useEffect(() => { document.title = "Providers — NOD Admin"; }, []);
  const qc = useQueryClient();
  const modal = useModal();
  const { data: providers = [] } = useQuery({ queryKey: ["admin", "providers"], queryFn: () => api<ProviderRow[]>("/admin/providers") });

  const [strikeFor, setStrikeFor] = useState<ProviderRow | null>(null);
  const [reason, setReason] = useState("OTHER");
  const [fee, setFee] = useState(20);
  const [note, setNote] = useState("");

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api(`/admin/providers/${id}/${action}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
    onError: (e: any) => modal.alert("Couldn't complete", e?.message || "Action failed"),
  });

  const bgCheck = useMutation({
    mutationFn: ({ id, result }: { id: string; result: "PASSED" | "FAILED" }) =>
      api(`/admin/providers/${id}/background`, { method: "POST", body: { result } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });

  const issueStrike = useMutation({
    mutationFn: () => api(`/admin/providers/${strikeFor!.id}/strikes`, { method: "POST", body: { reason, feeCents: Math.round(fee * 100), note } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); setStrikeFor(null); setNote(""); setFee(20); setReason("OTHER"); },
  });

  const removeStrike = useMutation({
    mutationFn: (id: string) => api(`/admin/strikes/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });

  const confirmAct = async (id: string, action: string, label: string) => {
    if (await modal.confirm({ title: `${label}?`, confirmLabel: label, destructive: action === "deactivate" || action === "reject" }))
      act.mutate({ id, action });
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Providers</h1>
      <p className="mt-1 text-sm text-muted-foreground">Approve, suspend, or deactivate providers (Checkr is stubbed — approve manually).</p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Rates</th>
              <th className="px-4 py-3">Rating</th>
              <th className="px-4 py-3">Strikes</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {providers.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{p.user.fullName ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{p.user.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${STATUS_CLS[p.status] ?? "bg-muted"}`}>
                    {p.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{p.vehicleType ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {p.categoryRates.map((r) => `${r.category.name} ${dollars2(r.hourlyRateCents)}/h`).join(", ") || "—"}
                </td>
                <td className="px-4 py-3">{p.ratingCount ? `${p.ratingAvg.toFixed(1)}★ (${p.ratingCount})` : "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <span className="font-semibold">{p.strikes.length}</span>
                    {p.strikes.map((s) => (
                      <button key={s.id} onClick={() => removeStrike.mutate(s.id)} title={`${s.reason} ${dollars2(s.feeCents)} — click to remove`}
                        className="rounded bg-destructive/10 px-1.5 text-[10px] font-medium text-destructive hover:bg-destructive/20">
                        {s.reason.slice(0, 3)}×
                      </button>
                    ))}
                  </div>
                  <div className="mt-1 flex gap-2 text-[10px] text-muted-foreground">
                    <span>{p.depositStatus === "CAPTURED" ? "deposit ✓" : "no deposit"}</span>
                    <span>{bgLabel(p.backgroundCheckStatus)}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <button onClick={() => setStrikeFor(p)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-amber-600">Strike</button>
                    {p.status === "ACTIVE" ? (
                      <>
                        <button onClick={() => confirmAct(p.id, "suspend", "Suspend")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Suspend</button>
                        <button onClick={() => confirmAct(p.id, "deactivate", "Deactivate")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-destructive">Deactivate</button>
                      </>
                    ) : (
                      <>
                        {!bgPassed(p.backgroundCheckStatus) && (
                          <>
                            <button onClick={() => bgCheck.mutate({ id: p.id, result: "PASSED" })} className="rounded-lg border border-primary px-3 py-1.5 text-xs font-semibold text-primary">Pass check</button>
                            <button onClick={() => bgCheck.mutate({ id: p.id, result: "FAILED" })} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-destructive">Fail check</button>
                          </>
                        )}
                        <button
                          disabled={!bgPassed(p.backgroundCheckStatus)}
                          title={bgPassed(p.backgroundCheckStatus) ? "" : "Mark background check Passed first"}
                          onClick={() => confirmAct(p.id, "approve", p.status === "PENDING_APPROVAL" ? "Approve" : "Activate")}
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                        >
                          {p.status === "PENDING_APPROVAL" ? "Approve" : "Activate"}
                        </button>
                        {p.status === "PENDING_APPROVAL" && (
                          <button onClick={() => confirmAct(p.id, "reject", "Reject")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Reject</button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!strikeFor} onClose={() => setStrikeFor(null)}>
        {strikeFor && (
          <>
            <h2 className="text-lg font-bold tracking-tight">Issue strike</h2>
            <p className="mt-1 text-sm text-muted-foreground">{strikeFor.user.fullName ?? strikeFor.user.email}</p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Reason</span>
                <select value={reason} onChange={(e) => setReason(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary">
                  <option value="NO_SHOW">Claim-and-no-show</option>
                  <option value="LATE_CANCEL">Late cancel</option>
                  <option value="LOW_RATING">Low rating</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Fee deducted from next payout ($)</span>
                <input type="number" min={0} value={fee} onChange={(e) => setFee(+e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Note (optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setStrikeFor(null)} className="h-11 flex-1 rounded-2xl border border-border text-sm font-semibold">Cancel</button>
              <button disabled={issueStrike.isPending} onClick={() => issueStrike.mutate()}
                className="h-11 flex-1 rounded-2xl bg-destructive text-sm font-semibold text-primary-foreground disabled:opacity-60">
                {issueStrike.isPending ? "Issuing…" : "Issue strike"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
