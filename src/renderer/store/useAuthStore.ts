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
  logout: () => set({ user: null, shift: null }),
}))
