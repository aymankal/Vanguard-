import { useEffect, useRef, useSyncExternalStore } from 'react';

// In-app confirmation (the claude.ai viewer blocks window.confirm, and this looks better anyway).
type Pending = { message: string; label: string; resolve: (ok: boolean) => void } | null;
let pending: Pending = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function ask(message: string, label = 'Confirm'): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { message, label, resolve };
    emit();
  });
}

function close(ok: boolean) {
  pending?.resolve(ok);
  pending = null;
  emit();
}

export function ConfirmHost() {
  const p = useSyncExternalStore((cb) => (subs.add(cb), () => void subs.delete(cb)), () => pending);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (p) btn.current?.focus(); }, [p]);
  if (!p) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-zinc-950/40 p-4" onMouseDown={() => close(false)}>
      <div role="alertdialog" aria-modal="true" className="card w-full max-w-sm p-4 shadow-xl" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close(false)}>
        <p className="text-sm">{p.message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={() => close(false)}>Cancel</button>
          <button ref={btn} className="btn-primary" onClick={() => close(true)}>{p.label}</button>
        </div>
      </div>
    </div>
  );
}
