import { create } from 'zustand'
import type { Settings } from '../types'

interface SettingsState {
  settings: Settings | null
  loadSettings: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  loadSettings: async () => {
    const s = await window.api.getSettings()
    set({ settings: s })
  },
}))
