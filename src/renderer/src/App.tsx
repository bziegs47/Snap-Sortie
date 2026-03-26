import { useState, useCallback } from 'react'
import DropZone from './components/DropZone'
import Settings from './components/Settings'
import History from './components/History'
import type { OrganizeResult } from './components/ResultCard'

export const HISTORY_KEY = 'snapsortie-history'
const MAX_HISTORY = 2000

export interface HistoryEntry extends OrganizeResult {
  timestamp: number
}

export function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function appendHistory(results: OrganizeResult[]): void {
  const entries: HistoryEntry[] = results.map(r => ({ ...r, timestamp: Date.now() }))
  const existing = loadHistory()
  const merged = [...entries, ...existing].slice(0, MAX_HISTORY)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(merged))
  } catch {}
}

type Tab = 'organize' | 'history' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('organize')
  const [sessionResults, setSessionResults] = useState<OrganizeResult[]>([])

  const addResults = useCallback((results: OrganizeResult[]) => {
    setSessionResults(prev => [...results, ...prev])
    appendHistory(results)
  }, [])

  const updateResult = useCallback((index: number, newResult: OrganizeResult) => {
    setSessionResults(prev => prev.map((r, i) => i === index ? newResult : r))
    // Update in localStorage history too
    try {
      const history = loadHistory()
      const match = history.findIndex(h =>
        h.originalPath === newResult.originalPath && h.destinationPath !== newResult.destinationPath
      )
      if (match >= 0) {
        history[match] = { ...history[match], ...newResult }
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
      }
    } catch {}
  }, [])

  const clearSession = useCallback(() => {
    setSessionResults([])
  }, [])

  return (
    <div className="app">
      <div className="titlebar">
        <div className="titlebar-wordmark">
          <span className="titlebar-wordmark-snap">Snap</span>
          <span className="titlebar-wordmark-sortie">Sortie</span>
          <span className="titlebar-dot" />
        </div>
      </div>
      <nav className="tabs">
        <div className={`tab ${tab === 'organize' ? 'active' : ''}`} onClick={() => setTab('organize')}>Organize</div>
        <div className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>History</div>
        <div className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>Settings</div>
      </nav>
      <main className={`content${tab === 'organize' ? ' content-organize' : ''}`}>
        {tab === 'organize' && (
          <DropZone
            sessionResults={sessionResults}
            onResults={addResults}
            onUpdateResult={updateResult}
            onClearSession={clearSession}
          />
        )}
        {tab === 'history' && <History />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  )
}
