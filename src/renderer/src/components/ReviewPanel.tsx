import { useState, useEffect, useCallback } from 'react'
import type { OrganizeResult } from './ResultCard'

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p

interface ReviewItem {
  index: number
  result: OrganizeResult
  selected: boolean
  editedPath: string
}

interface Props {
  results: OrganizeResult[]
  acceptedIndices: Set<number>
  onMoved: (updates: { index: number; newResult: OrganizeResult }[]) => void
  onAccept: (indices: number[]) => void
  onDismiss: () => void
}

function needsReview(r: OrganizeResult): boolean {
  if (r.error) return false
  const loc = r.location.toLowerCase()
  const cat = r.category.toLowerCase()
  if (loc.includes('unknown') || loc.includes('other') || cat.includes('unknown') || cat.includes('other')) return true
  if (r.confidence !== undefined && r.confidence < 0.7) return true
  return false
}

export function countNeedingReview(results: OrganizeResult[], accepted: Set<number> = new Set()): number {
  return results.filter((r, i) => !accepted.has(i) && needsReview(r)).length
}

export default function ReviewPanel({ results, acceptedIndices, onMoved, onAccept, onDismiss }: Props) {
  const [outputDir, setOutputDir] = useState('')
  const [items, setItems] = useState<ReviewItem[]>([])
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    window.api.getOutputDir().then(setOutputDir)
  }, [])

  useEffect(() => {
    if (!outputDir) return
    const reviewItems: ReviewItem[] = []
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (acceptedIndices.has(i) || !needsReview(r)) continue
      const filename = basename(r.destinationPath)
      let relPath = r.destinationPath
      if (relPath.startsWith(outputDir)) {
        relPath = relPath.slice(outputDir.length)
        if (relPath.startsWith('/')) relPath = relPath.slice(1)
      }
      const lastSlash = relPath.lastIndexOf('/')
      const folder = lastSlash >= 0 ? relPath.slice(0, lastSlash) : ''

      reviewItems.push({
        index: i,
        result: r,
        selected: false,
        editedPath: folder
      })
    }
    setItems(reviewItems)
  }, [results, outputDir, acceptedIndices])

  const toggleSelect = useCallback((idx: number) => {
    setItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, selected: !item.selected } : item
    ))
  }, [])

  const selectAll = useCallback(() => {
    const allSelected = items.every(i => i.selected)
    setItems(prev => prev.map(item => ({ ...item, selected: !allSelected })))
  }, [items])

  const updatePath = useCallback((idx: number, path: string) => {
    setItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, editedPath: path } : item
    ))
  }, [])

  const moveSelected = useCallback(async () => {
    const toMove = items.filter(i => i.selected)
    if (!toMove.length) return

    setMoving(true)
    const updates: { index: number; newResult: OrganizeResult }[] = []

    for (const item of toMove) {
      try {
        const newPath = await window.api.moveFile(item.result.destinationPath, item.editedPath)
        const parts = item.editedPath.split('/')
        const newResult: OrganizeResult = {
          ...item.result,
          destinationPath: newPath,
          location: parts.slice(0, 2).join(' / ') || item.result.location,
          category: parts.slice(2).join(' / ') || item.result.category
        }
        updates.push({ index: item.index, newResult })
      } catch (err) {
        alert(`Failed to move ${basename(item.result.destinationPath)}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    setMoving(false)
    if (updates.length > 0) {
      onMoved(updates)
    }
  }, [items, onMoved])

  const acceptSelected = useCallback(() => {
    const selected = items.filter(i => i.selected).map(i => i.index)
    if (selected.length > 0) {
      onAccept(selected)
    }
  }, [items, onAccept])

  const acceptAllReview = useCallback(() => {
    onAccept(items.map(i => i.index))
  }, [items, onAccept])

  const selectedCount = items.filter(i => i.selected).length

  if (!items.length) return null

  return (
    <div className="review-panel">
      <div className="review-header">
        <div className="review-header-left">
          <span className="review-title">Review unknown files</span>
          <span className="review-count">{items.length} {items.length === 1 ? 'file' : 'files'}</span>
        </div>
        <div className="review-header-actions">
          <button className="btn-accept-sort" onClick={acceptAllReview}>Accept all</button>
          <button className="btn-clear-session" onClick={onDismiss}>Close</button>
        </div>
      </div>

      <div className="review-toolbar">
        <button className="btn-clear-session" onClick={selectAll}>
          {items.every(i => i.selected) ? 'Deselect all' : 'Select all'}
        </button>
        {selectedCount > 0 && (
          <>
            <button
              className="btn-review-move"
              onClick={moveSelected}
              disabled={moving}
            >
              {moving ? 'Moving…' : `Move ${selectedCount}`}
            </button>
            <button className="btn-accept-sort" onClick={acceptSelected}>
              Accept {selectedCount}
            </button>
          </>
        )}
      </div>

      <div className="review-list">
        {items.map((item, idx) => (
          <div key={item.index} className={`review-item ${item.selected ? 'selected' : ''}`}>
            <div className="review-item-header">
              <label className="review-checkbox">
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={() => toggleSelect(idx)}
                />
                <span className="review-filename">{basename(item.result.destinationPath)}</span>
              </label>
              <div className="review-item-actions">
                <button
                  className="btn-review-preview"
                  title="Preview file"
                  onClick={async () => {
                    try { await window.api.openPreviewWindow(item.result.destinationPath) }
                    catch (err) { alert(err instanceof Error ? err.message : String(err)) }
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
                    <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                  </svg>
                </button>
                <span className="badge badge-location">{item.result.location}</span>
                {item.result.confidence !== undefined && (
                  <span className="badge badge-confidence" style={{ marginLeft: 4 }}>
                    {Math.round(item.result.confidence * 100)}%
                  </span>
                )}
              </div>
            </div>
            {item.result.classificationReasoning && (
              <div className="review-item-reasoning">{item.result.classificationReasoning}</div>
            )}
            <div className="review-item-path">
              <span className="review-path-label">Move to:</span>
              <input
                className="review-path-input"
                value={item.editedPath}
                onChange={e => updatePath(idx, e.target.value)}
                placeholder="Photos/State/City/Category"
                onFocus={() => {
                  if (!item.selected) toggleSelect(idx)
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
