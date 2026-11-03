/** components/Toasts.tsx — lightweight toast notifications. */
"use client";

import React, { createContext, useCallback, useContext, useState } from "react";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  body?: string;
}

interface ToastContextValue {
  push: (t: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToasts(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts must be used inside ToastSetup");
  return ctx;
}

let nextId = 1;

export function ToastSetup({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId++;
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 7000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-[340px] max-w-[calc(100vw-3rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto rounded-xl border border-line bg-ink p-4 text-paper shadow-lift"
          >
            <div className="flex items-start gap-3">
              <span
                className={
                  "mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full " +
                  (t.kind === "success"
                    ? "bg-green-400"
                    : t.kind === "error"
                    ? "bg-red-400"
                    : "bg-accent")
                }
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.body && (
                  <p className="mt-1 break-words text-xs text-paper/70">{t.body}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
