import { useState, useCallback } from 'react'

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p

export interface OrganizeResult {
  originalPath: string
  destinationPath: string
  location: string
  category: string
  error?: string
  confidence?: number
  classificationMethod?: string
  classificationReasoning?: string
}

function MapPinIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 1.5C5.51 1.5 3.5 3.51 3.5 6c0 3.75 4.5 8.5 4.5 8.5s4.5-4.75 4.5-8.5c0-2.49-2.01-4.5-4.5-4.5z"
        fill="currentColor"
        opacity="0.9"
      />
      <circle cx="8" cy="6" r="1.6" fill="var(--bg2)" />
    </svg>
  )
}

function TagIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 2h5.5l6.5 6.5-5.5 5.5L2 7.5V2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="5.5" cy="5.5" r="1" fill="currentColor" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
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

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function CheckSmallIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 8.5L6.5 12 13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" fill="none"/>
    </svg>
  )
}

// Generate a deterministic pastel-ish color from a string
function thumbColor(name: string, ok: boolean): string {
  if (!ok) return 'rgba(220,50,50,.18)'
  const hues = [150, 160, 170, 140, 200, 130]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  return `hsla(${hues[h % hues.length]}, 45%, 35%, 0.5)`
}

export function isUnknown(r: OrganizeResult): boolean {
  if (r.error) return false
  const loc = r.location.toLowerCase()
  const cat = r.category.toLowerCase()
  if (loc.includes('unknown') || loc.includes('other') || cat.includes('unknown') || cat.includes('other')) return true
  if (r.confidence !== undefined && r.confidence < 0.7) return true
  return false
}

interface Props {
  result: OrganizeResult
  style?: React.CSSProperties
  showInlineReview?: boolean
  accepted?: boolean
  onAccept?: () => void
  onMove?: (newPath: string) => Promise<void>
}

export default function ResultCard({
  result,
  style,
  showInlineReview,
  accepted,
  onAccept,
  onMove
}: Props) {
  const [editing, setEditing] = useState(false)
  const [editPath, setEditPath] = useState('')
  const [moving, setMoving] = useState(false)

  const ok = !result.error
  const filename = basename(result.originalPath)
  const initial = filename.charAt(0)
  const needsReview = showInlineReview && isUnknown(result) && !accepted

  const startEdit = useCallback(async () => {
    const outputDir = await window.api.getOutputDir()
    let relPath = result.destinationPath
    if (relPath.startsWith(outputDir)) {
      relPath = relPath.slice(outputDir.length)
      if (relPath.startsWith('/')) relPath = relPath.slice(1)
    }
    const lastSlash = relPath.lastIndexOf('/')
    setEditPath(lastSlash >= 0 ? relPath.slice(0, lastSlash) : '')
    setEditing(true)
  }, [result.destinationPath])

  const handleMove = useCallback(async () => {
    if (!onMove || !editPath.trim()) return
    setMoving(true)
    try {
      await onMove(editPath)
      setEditing(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setMoving(false)
    }
  }, [editPath, onMove])

  return (
    <div className={`result-card ${ok ? 'success' : 'error'} ${needsReview ? 'needs-review' : ''}`} style={style}>
      <div
        className={`result-thumb ${ok ? 'success' : 'error'}`}
        style={{ background: thumbColor(filename, ok) }}
        aria-hidden="true"
      >
        {initial}
      </div>
      <div className="result-info">
        <div className="result-filename">{filename}</div>
        <div className="result-path">
          {ok ? result.destinationPath : result.error}
        </div>
        {editing && (
          <div className="inline-edit-row">
            <input
              className="inline-edit-input"
              value={editPath}
              onChange={e => setEditPath(e.target.value)}
              placeholder="Photos/State/City/Category"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleMove(); if (e.key === 'Escape') setEditing(false) }}
            />
            <button className="btn-inline-move" onClick={handleMove} disabled={moving}>
              {moving ? '…' : 'Move'}
            </button>
            <button className="btn-inline-cancel" onClick={() => setEditing(false)}>
              &times;
            </button>
          </div>
        )}
      </div>
      <div className="result-badges">
        {ok ? (
          <>
            <span className="badge badge-location">
              <MapPinIcon />
              {result.location}
            </span>
            <span className="badge badge-category">
              <TagIcon />
              {result.category}
            </span>
            {result.confidence !== undefined && (
              <span
                className="badge badge-confidence"
                title={result.classificationReasoning || `Confidence: ${Math.round(result.confidence * 100)}%`}
              >
                <span
                  className="confidence-dot"
                  style={{ background: result.confidence >= 0.8 ? '#4caf50' : result.confidence >= 0.5 ? '#ff9800' : '#f44336' }}
                />
                {Math.round(result.confidence * 100)}%
                {result.classificationMethod && (
                  <span className="confidence-method"> via {result.classificationMethod === 'text-extract' ? 'text' : result.classificationMethod}</span>
                )}
              </span>
            )}
            {needsReview && !editing && (
              <>
                <button className="btn-inline-review" title="Edit sort path" onClick={startEdit}>
                  <PencilIcon />
                </button>
                <button className="btn-inline-accept" title="Accept sort" onClick={onAccept}>
                  <CheckSmallIcon />
                </button>
              </>
            )}
            <button
              className="btn-reveal"
              title="Preview file"
              onClick={async () => {
                try { await window.api.openPreviewWindow(result.destinationPath) }
                catch (err) { alert(err instanceof Error ? err.message : String(err)) }
              }}
            >
              <EyeIcon />
            </button>
            <button
              className="btn-reveal"
              title="Show in Finder"
              onClick={async () => {
                const found = await window.api.revealInFinder(result.destinationPath)
                if (!found) alert('File has been moved or deleted.')
              }}
            >
              <FolderIcon />
            </button>
          </>
        ) : (
          <span className="badge badge-error">Error</span>
        )}
      </div>
    </div>
  )
}
