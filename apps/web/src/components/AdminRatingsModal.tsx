import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Star, Trash2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";

interface RatingRow {
  id: string;
  stars: number;
  comment: string | null;
  createdAt: string;
  rater: { id: string; fullName: string | null; role: string } | null;
  job: { id: string; category: { name: string } | null } | null;
}

// Admin manual rating adjustment (Sprint 5, item 3): view, edit stars, or delete any
// rating a provider/customer has received. The aggregate recomputes server-side.
export default function AdminRatingsModal({ userId, name, onClose }: { userId: string | null; name: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: ratings = [], isLoading } = useQuery({
    queryKey: ["admin", "ratings", userId],
    queryFn: () => api<RatingRow[]>(`/admin/users/${userId}/ratings`),
    enabled: !!userId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "ratings", userId] });
    qc.invalidateQueries({ queryKey: ["admin", "providers"] });
    qc.invalidateQueries({ queryKey: ["admin"] });
  };

  const update = useMutation({
    mutationFn: ({ id, stars }: { id: string; stars: number }) => api(`/admin/ratings/${id}`, { method: "PATCH", body: { stars } }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/ratings/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  return (
    <Modal open={!!userId} onClose={onClose}>
      <div className="max-h-[70vh] overflow-y-auto">
        <h2 className="text-lg font-bold tracking-tight">Ratings — {name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Adjust or remove ratings. The average recomputes automatically.</p>

        <div className="mt-4 space-y-2">
          {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
          {!isLoading && ratings.length === 0 && <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No ratings received.</div>}
          {ratings.map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} onClick={() => update.mutate({ id: r.id, stars: n })} aria-label={`Set ${n} stars`}>
                      <Star className={`h-5 w-5 transition ${n <= r.stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />
                    </button>
                  ))}
                  <span className="ml-1 text-xs text-muted-foreground">{r.stars}★</span>
                </div>
                <button
                  onClick={() => remove.mutate(r.id)}
                  disabled={remove.isPending}
                  aria-label="Delete rating"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-destructive hover:bg-destructive/5 disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {r.comment && <p className="mt-2 text-sm text-foreground">"{r.comment}"</p>}
              <div className="mt-1 text-[11px] text-muted-foreground">
                {r.job?.category?.name ?? "—"} · by {r.rater?.fullName ?? "—"} ({r.rater?.role?.toLowerCase()})
              </div>
            </div>
          ))}
        </div>

        <button onClick={onClose} className="mt-5 h-11 w-full rounded-2xl border border-border text-sm font-semibold">Done</button>
      </div>
    </Modal>
  );
}
