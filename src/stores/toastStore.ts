import { create } from "zustand";

interface ToastStore {
  message: string | null;
  showToast: (message: string, durationMs?: number) => void;
  clearToast: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastStore>((set) => ({
  message: null,
  showToast: (message, durationMs = 3000) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ message });
    toastTimer = setTimeout(() => {
      set({ message: null });
      toastTimer = null;
    }, durationMs);
  },
  clearToast: () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    set({ message: null });
  },
}));
