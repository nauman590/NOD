import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useModal } from "@/components/ui/Modal";
import { Modal } from "@/components/ui/Modal";
import { dollars2 } from "@/lib/types";

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  baseFeeCents: number;
  disposalFeeCents: number;
  perMileFeeCents: number;
  fallbackHourlyRateCents: number;
  promptTemplate: string;
  intakeConfig: { addressMode: string };
}

const empty = {
  slug: "", name: "", promptTemplate: "", addressMode: "single",
  baseFeeCents: 0, disposalFeeCents: 0, perMileFeeCents: 0, fallbackHourlyRateCents: 6000,
};

export default function AdminCategories() {
  useEffect(() => { document.title = "Categories — NOD Admin"; }, []);
  const qc = useQueryClient();
  const modal = useModal();
  const [editing, setEditing] = useState<null | (typeof empty & { id?: string })>(null);

  const { data: categories = [] } = useQuery({ queryKey: ["admin", "categories"], queryFn: () => api<CategoryRow[]>("/categories/all") });

  const save = useMutation({
    mutationFn: (c: typeof empty & { id?: string }) => {
      const body = {
        name: c.name,
        promptTemplate: c.promptTemplate,
        intakeConfig: { addressMode: c.addressMode, fields: [] },
        baseFeeCents: Number(c.baseFeeCents),
        disposalFeeCents: Number(c.disposalFeeCents),
        perMileFeeCents: Number(c.perMileFeeCents),
        fallbackHourlyRateCents: Number(c.fallbackHourlyRateCents),
      };
      return c.id
        ? api(`/categories/${c.id}`, { method: "PATCH", body })
        : api("/categories", { method: "POST", body: { ...body, slug: c.slug } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "categories"] }); qc.invalidateQueries({ queryKey: ["categories"] }); setEditing(null); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "categories"] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">Each category drives the AI prompt, intake form, and fees. New ones appear instantly in the customer app.</p>
        </div>
        <button onClick={() => setEditing({ ...empty })} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
          <Plus className="h-4 w-4" /> New category
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {categories.map((c) => (
          <div key={c.id} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold tracking-tight">{c.name}</h3>
                  {!c.active && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">inactive</span>}
                </div>
                <div className="text-xs text-muted-foreground">/{c.slug} · {c.intakeConfig?.addressMode}</div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>fallback {dollars2(c.fallbackHourlyRateCents)}/h</div>
                <div>fee {dollars2(c.baseFeeCents)} · disposal {dollars2(c.disposalFeeCents)}</div>
              </div>
            </div>
            <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{c.promptTemplate}</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setEditing({ id: c.id, slug: c.slug, name: c.name, promptTemplate: c.promptTemplate, addressMode: c.intakeConfig?.addressMode ?? "single", baseFeeCents: c.baseFeeCents, disposalFeeCents: c.disposalFeeCents, perMileFeeCents: c.perMileFeeCents, fallbackHourlyRateCents: c.fallbackHourlyRateCents })}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Edit</button>
              {c.active && (
                <button onClick={async () => { if (await modal.confirm({ title: `Deactivate ${c.name}?`, confirmLabel: "Deactivate" })) remove.mutate(c.id); }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-destructive">Deactivate</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)}>
        {editing && (
          <div className="max-h-[80vh] overflow-auto">
            <h2 className="text-lg font-bold tracking-tight">{editing.id ? "Edit category" : "New category"}</h2>
            <div className="mt-4 space-y-3">
              {!editing.id && (
                <L label="Slug (unique id)"><input value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} className={inp} placeholder="e.g. detailing" /></L>
              )}
              <L label="Name"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inp} /></L>
              <L label="Address mode">
                <select value={editing.addressMode} onChange={(e) => setEditing({ ...editing, addressMode: e.target.value })} className={inp}>
                  <option value="single">Single service address</option>
                  <option value="pickup_dropoff">Pickup + drop-off</option>
                </select>
              </L>
              <L label="AI prompt template"><textarea rows={4} value={editing.promptTemplate} onChange={(e) => setEditing({ ...editing, promptTemplate: e.target.value })} className={inp} placeholder="Use {{description}} and {{intakeJson}}" /></L>
              <div className="grid grid-cols-2 gap-3">
                <L label="Fallback rate (cents/h)"><input type="number" value={editing.fallbackHourlyRateCents} onChange={(e) => setEditing({ ...editing, fallbackHourlyRateCents: +e.target.value })} className={inp} /></L>
                <L label="Base fee (cents)"><input type="number" value={editing.baseFeeCents} onChange={(e) => setEditing({ ...editing, baseFeeCents: +e.target.value })} className={inp} /></L>
                <L label="Disposal fee (cents)"><input type="number" value={editing.disposalFeeCents} onChange={(e) => setEditing({ ...editing, disposalFeeCents: +e.target.value })} className={inp} /></L>
                <L label="Per-mile fee (cents)"><input type="number" value={editing.perMileFeeCents} onChange={(e) => setEditing({ ...editing, perMileFeeCents: +e.target.value })} className={inp} /></L>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setEditing(null)} className="h-11 flex-1 rounded-2xl border border-border text-sm font-semibold">Cancel</button>
              <button disabled={save.isPending || !editing.name || (!editing.id && !editing.slug)} onClick={() => save.mutate(editing)}
                className="h-11 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const inp = "h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}
