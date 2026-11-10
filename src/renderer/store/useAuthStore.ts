import { create } from 'zustand'
import type { User, Shift } from '../types'

interface AuthState {
  user: User | null
  shift: Shift | null
  setUser: (user: User | null) => void
  setShift: (shift: Shift | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  shift: null,
  setUser: (user) => set({ user }),
  setShift: (shift) => set({ shift }),
  logout: () => {
    try { void window.api.logout() } catch { /* ignore */ }   // el proceso principal también olvida la sesión
    set({ user: null, shift: null })
  },
}))
