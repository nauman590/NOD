import { ReactNode, createContext, useCallback, useContext, useState } from "react";

export function Modal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 backdrop-blur-sm sm:items-center">
      <div
        className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
      <button className="absolute inset-0 -z-10" aria-label="Close" onClick={onClose} />
    </div>
  );
}

// ---- Imperative confirm / alert via context ----

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface DialogState extends ConfirmOptions {
  mode: "confirm" | "alert";
  resolve: (ok: boolean) => void;
}

interface ModalApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  alert: (title: string, body?: string) => Promise<boolean>;
}

const ModalApiCtx = createContext<ModalApi | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setDialog({ ...opts, mode: "confirm", resolve })),
    [],
  );
  const alert = useCallback(
    (title: string, body?: string) =>
      new Promise<boolean>((resolve) => setDialog({ title, body, mode: "alert", resolve })),
    [],
  );

  const close = (ok: boolean) => {
    dialog?.resolve(ok);
    setDialog(null);
  };

  return (
    <ModalApiCtx.Provider value={{ confirm, alert }}>
      {children}
      <Modal open={!!dialog} onClose={() => close(false)}>
        {dialog && (
          <>
            <h2 className="text-lg font-bold tracking-tight">{dialog.title}</h2>
            {dialog.body && <p className="mt-2 text-sm text-muted-foreground">{dialog.body}</p>}
            <div className="mt-6 flex gap-2">
              {dialog.mode === "confirm" && (
                <button
                  onClick={() => close(false)}
                  className="flex h-11 flex-1 items-center justify-center rounded-2xl border border-border bg-background text-sm font-semibold text-foreground transition hover:bg-muted"
                >
                  {dialog.cancelLabel || "Cancel"}
                </button>
              )}
              <button
                onClick={() => close(true)}
                className={`flex h-11 flex-1 items-center justify-center rounded-2xl text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30 transition active:scale-[0.99] ${
                  dialog.destructive ? "bg-destructive" : "bg-primary"
                }`}
              >
                {dialog.confirmLabel || "OK"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </ModalApiCtx.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalApiCtx);
  if (!ctx) throw new Error("useModal must be used within ModalProvider");
  return ctx;
}
