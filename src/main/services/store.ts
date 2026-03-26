import Store from 'electron-store'

export interface Settings {
  outputDir: string
  anthropicApiKey: string
  excludedTerms: string
}

const store = new Store<Settings>({
  defaults: {
    outputDir: '',
    anthropicApiKey: '',
    excludedTerms: ''
  }
})

export function getSettings(): Settings {
  return store.store as Settings
}

export function saveSettings(settings: Partial<Settings>): void {
  Object.entries(settings).forEach(([k, v]) => store.set(k, v))
}
