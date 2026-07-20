import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useModal, Modal } from "@/components/ui/Modal";
import AdminRatingsModal from "@/components/AdminRatingsModal";

interface CustomerRow {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string | null;
  isGuest: boolean;
  createdAt: string;
  suspendedUntil: string | null;
  suspendedReason: string | null;
  _count: { customerJobs: number };
}

const isSuspended = (c: CustomerRow) => !!c.suspendedUntil && new Date(c.suspendedUntil) > new Date();
const fmtDate = (s: string) => new Date(s).toLocaleDateString();

export default function AdminCustomers() {
  useEffect(() => { document.title = "Customers — NOD Admin"; }, []);
  const qc = useQueryClient();
  const modal = useModal();
  const { data: customers = [] } = useQuery({ queryKey: ["admin", "customers"], queryFn: () => api<CustomerRow[]>("/admin/customers") });

  const [suspendFor, setSuspendFor] = useState<CustomerRow | null>(null);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(60);
  const [ratingsFor, setRatingsFor] = useState<{ userId: string; name: string } | null>(null);

  const suspendM = useMutation({
    mutationFn: () => api(`/admin/customers/${suspendFor!.id}/suspend`, { method: "POST", body: { reason: reason.trim() || undefined, days } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); setSuspendFor(null); setReason(""); setDays(60); },
    onError: (e: any) => modal.alert("Couldn't suspend", e?.message || "Please try again."),
  });

  const unsuspendM = useMutation({
    mutationFn: (id: string) => api(`/admin/customers/${id}/unsuspend`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
    onError: (e: any) => modal.alert("Couldn't reinstate", e?.message || "Please try again."),
  });

  const confirmUnsuspend = async (c: CustomerRow) => {
    if (await modal.confirm({ title: "Reinstate customer?", body: `${c.fullName ?? c.email} will be able to book again.`, confirmLabel: "Reinstate" }))
      unsuspendM.mutate(c.id);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
      <p className="mt-1 text-sm text-muted-foreground">Everyone who has booked a job. Suspend abusive accounts or reinstate them.</p>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-card text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Jobs</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {customers.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No customers yet.</td></tr>
            )}
            {customers.map((c) => {
              const suspended = isSuspended(c);
              return (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.fullName ?? "—"} {c.isGuest && <span className="text-[10px] text-muted-foreground">(guest)</span>}</div>
                    <div className="text-xs text-muted-foreground">{c.email ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3">{c._count.customerJobs}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(c.createdAt)}</td>
                  <td className="px-4 py-3">
                    {suspended ? (
                      <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-destructive" title={c.suspendedReason ?? ""}>
                        Suspended
                      </span>
                    ) : (
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        onClick={() => setRatingsFor({ userId: c.id, name: c.fullName ?? c.email ?? "Customer" })}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
                      >
                        Ratings
                      </button>
                      {suspended ? (
                        <button onClick={() => confirmUnsuspend(c)} className="rounded-lg border border-primary px-3 py-1.5 text-xs font-semibold text-primary">Reinstate</button>
                      ) : (
                        <button onClick={() => { setSuspendFor(c); setReason(""); setDays(60); }} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-destructive">Suspend</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={!!suspendFor} onClose={() => setSuspendFor(null)}>
        {suspendFor && (
          <>
            <h2 className="text-lg font-bold tracking-tight">Suspend customer</h2>
            <p className="mt-1 text-sm text-muted-foreground">{suspendFor.fullName ?? suspendFor.email}</p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Reason (shown to the customer)</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. repeated no-shows"
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Duration (days)</span>
                <input type="number" min={1} value={days} onChange={(e) => setDays(+e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
              </label>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setSuspendFor(null)} className="h-11 flex-1 rounded-2xl border border-border text-sm font-semibold">Cancel</button>
              <button disabled={suspendM.isPending} onClick={() => suspendM.mutate()}
                className="h-11 flex-1 rounded-2xl bg-destructive text-sm font-semibold text-primary-foreground disabled:opacity-60">
                {suspendM.isPending ? "Suspending…" : "Suspend"}
              </button>
            </div>
          </>
        )}
      </Modal>

      <AdminRatingsModal userId={ratingsFor?.userId ?? null} name={ratingsFor?.name ?? ""} onClose={() => setRatingsFor(null)} />
    </div>
  );
}
