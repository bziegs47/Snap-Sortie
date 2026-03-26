import { useState, useEffect } from 'react'

interface SettingsData {
  outputDir: string
  anthropicApiKey: string
  excludedTerms: string
}

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3.5l1.5 2H13a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 13 13H3A1.5 1.5 0 0 1 1.5 11.5V4.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 8.5L6.5 12 13 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function Settings() {
  const [form, setForm] = useState<SettingsData>({
    outputDir: '',
    anthropicApiKey: '',
    excludedTerms: ''
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.getSettings().then(setForm)
  }, [])

  const set = (key: keyof SettingsData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  const pickFolder = async () => {
    const dir = await window.api.pickFolder()
    if (dir) setForm(f => ({ ...f, outputDir: dir }))
  }

  const save = async () => {
    await window.api.saveSettings(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="settings-form">

      {/* Output section */}
      <div className="settings-section">
        <p className="settings-section-title">Output</p>

        <div className="field">
          <label>Output Folder</label>
          <div className="field-row">
            <input value={form.outputDir} onChange={set('outputDir')} placeholder="/Users/you/Photos/Archive" />
            <button className="btn-browse" onClick={pickFolder} title="Browse for folder">
              <FolderIcon />
            </button>
          </div>
          <p className="hint">Files will be organized into subfolders by type, location, and content.</p>
        </div>
      </div>

      {/* Document Intelligence section */}
      <div className="settings-section">
        <p className="settings-section-title">Document Intelligence</p>

        <div className="field">
          <label>
            Anthropic API Key
            <span className={`api-key-dot ${form.anthropicApiKey ? 'filled' : ''}`} />
          </label>
          <input
            value={form.anthropicApiKey}
            onChange={set('anthropicApiKey')}
            placeholder="sk-ant-api03-..."
            type="password"
          />
          <p className="hint">
            Powers intelligent document classification via Claude Haiku.
            Documents are sorted by type (Invoice, Contract, Statement, etc.) and source.
            Without a key, basic keyword matching is used instead.
          </p>
        </div>
      </div>

      {/* Sorting Exclusions section */}
      <div className="settings-section">
        <p className="settings-section-title">Sorting Exclusions</p>

        <div className="field">
          <label>Excluded Terms</label>
          <input
            value={form.excludedTerms}
            onChange={set('excludedTerms')}
            placeholder="e.g. Acme, My Company, John Doe"
          />
          <p className="hint">
            Comma-separated words or names to exclude from document source detection.
            These will never be used as vendor/company folder names.
          </p>
        </div>
      </div>

      {/* Save */}
      <div className="settings-section">
        <button className={`btn-save ${saved ? 'saved' : ''}`} onClick={save}>
          <span className="save-check"><CheckIcon /></span>
          <span className="save-label">Save Settings</span>
          {saved && <span style={{ fontWeight: 400, fontSize: 13, opacity: 0.8 }}>Saved</span>}
        </button>
      </div>

    </div>
  )
}
