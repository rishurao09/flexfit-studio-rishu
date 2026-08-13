"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "info", duration = 4000) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { id, message, type, duration }]);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast]
  );

  const success = useCallback((msg: string, dur?: number) => toast(msg, "success", dur), [toast]);
  const error = useCallback((msg: string, dur?: number) => toast(msg, "error", dur), [toast]);
  const info = useCallback((msg: string, dur?: number) => toast(msg, "info", dur), [toast]);
  const warning = useCallback((msg: string, dur?: number) => toast(msg, "warning", dur), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info, warning }}>
      {children}
      {/* Global Toast Container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center justify-between p-4 rounded-lg shadow-lg border text-sm font-medium transition-all duration-300 transform translate-y-0 opacity-100 animate-slide-in"
            style={{
              background:
                t.type === "success"
                  ? "#064e3b"
                  : t.type === "error"
                  ? "#7f1d1d"
                  : t.type === "warning"
                  ? "#78350f"
                  : "#1e293b",
              color:
                t.type === "success"
                  ? "#34d399"
                  : t.type === "error"
                  ? "#f87171"
                  : t.type === "warning"
                  ? "#fbbf24"
                  : "#e2e8f0",
              borderColor:
                t.type === "success"
                  ? "#059669"
                  : t.type === "error"
                  ? "#dc2626"
                  : t.type === "warning"
                  ? "#d97706"
                  : "#475569",
            }}
            role="alert"
          >
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              className="ml-3 text-current opacity-70 hover:opacity-100 focus:outline-none text-base"
              aria-label="Close"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
