import { useState, useCallback, useMemo } from 'react'
import ResultCard from './ResultCard'
import { loadHistory, HISTORY_KEY } from '../App'
import type { HistoryEntry } from '../App'

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function groupByDay(entries: HistoryEntry[]): { label: string; entries: HistoryEntry[] }[] {
  const groups: Map<string, HistoryEntry[]> = new Map()
  for (const entry of entries) {
    const key = new Date(entry.timestamp).toDateString()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(entry)
  }
  return Array.from(groups.entries()).map(([key, entries]) => ({
    label: formatDate(new Date(key).getTime()),
    entries
  }))
}

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p

function matchesSearch(entry: HistoryEntry, query: string): boolean {
  const q = query.toLowerCase()
  return (
    basename(entry.originalPath).toLowerCase().includes(q) ||
    entry.destinationPath.toLowerCase().includes(q) ||
    entry.location.toLowerCase().includes(q) ||
    entry.category.toLowerCase().includes(q)
  )
}

export default function History() {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory())
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return entries
    return entries.filter(e => matchesSearch(e, search.trim()))
  }, [entries, search])

  const clearAll = useCallback(() => {
    if (!confirm('Clear all history? This cannot be undone.')) return
    try { localStorage.removeItem(HISTORY_KEY) } catch {}
    setEntries([])
  }, [])

  const groups = groupByDay(filtered)

  return (
    <div className="history-view">
      <div className="history-header">
        <div className="history-title-row">
          <span className="history-title">All-time history</span>
          <span className="history-count">
            {search && filtered.length !== entries.length
              ? `${filtered.length} of ${entries.length} files`
              : `${entries.length} ${entries.length === 1 ? 'file' : 'files'}`
            }
          </span>
        </div>
        {entries.length > 0 && (
          <button className="btn-clear-all" onClick={clearAll}>
            Clear all history
          </button>
        )}
      </div>

      {entries.length > 0 && (
        <div className="history-search">
          <input
            className="history-search-input"
            type="text"
            placeholder="Search by filename, location, category, or path…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="history-search-clear" onClick={() => setSearch('')}>
              &times;
            </button>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="history-empty">
          <p>No history yet.</p>
          <p>Files you organize will appear here.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="history-empty">
          <p>No results for "{search}"</p>
        </div>
      ) : (
        <div className="history-groups">
          {groups.map(group => (
            <div key={group.label} className="history-group">
              <div className="history-group-label">{group.label}</div>
              <div className="results">
                {group.entries.map((r, i) => (
                  <ResultCard key={i} result={r} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
