import { useCallback, useEffect, useState, useRef } from 'react'
import type { OrganizeResult } from './ResultCard'
import ResultCard from './ResultCard'
import ReviewPanel, { countNeedingReview } from './ReviewPanel'

function UploadIcon() {
  return (
    <svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Corner tick marks */}
      <path d="M4 16 L4 4 L16 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
      <path d="M36 4 L48 4 L48 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
      {/* Down arrow */}
      <path d="M26 10 L26 32" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square"/>
      <path d="M16 24 L26 34 L36 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter"/>
      {/* Intake tray */}
      <path d="M4 38 L4 48 L48 48 L48 38" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" fill="none"/>
      <path d="M4 38 L14 34 L38 34 L48 38" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" fill="none"/>
    </svg>
  )
}

function GearSpinner() {
  return (
    <svg
      className="spinner-ring"
      width="48" height="48"
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="M22.2 11.1 L21.4 5.2 L26.6 5.2 L25.8 11.1 L31.8 13.6 L35.4 8.8 L39.2 12.6 L34.4 16.2 L36.9 22.2 L42.8 21.4 L42.8 26.6 L36.9 25.8 L34.4 31.8 L39.2 35.4 L35.4 39.2 L31.8 34.4 L25.8 36.9 L26.6 42.8 L21.4 42.8 L22.2 36.9 L16.2 34.4 L12.6 39.2 L8.8 35.4 L13.6 31.8 L11.1 25.8 L5.2 26.6 L5.2 21.4 L11.1 22.2 L13.6 16.2 L8.8 12.6 L12.6 8.8 L16.2 13.6 Z M31 24 A7 7 0 1 0 17 24 A7 7 0 1 0 31 24"
      />
    </svg>
  )
}

const fileBasename = (p: string) => p.split(/[\\/]/).pop() ?? p

interface Props {
  sessionResults: OrganizeResult[]
  onResults: (results: OrganizeResult[]) => void
  onUpdateResult: (index: number, result: OrganizeResult) => void
  onClearSession: () => void
}

export default function DropZone({ sessionResults, onResults, onUpdateResult, onClearSession }: Props) {
  const [over, setOver] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [acceptedIndices, setAcceptedIndices] = useState<Set<number>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  // Pre-sort staging
  const [stagedFiles, setStagedFiles] = useState<string[]>([])
  const [perSortExclusions, setPerSortExclusions] = useState('')

  const reviewCount = countNeedingReview(sessionResults, acceptedIndices)

  const stageFiles = useCallback((paths: string[]) => {
    const valid = paths.filter(p => /\.(jpe?g|png|heic|heif|tiff?|webp|pdf)$/i.test(p))
    if (!valid.length) return
    setStagedFiles(valid)
    setPerSortExclusions('')
  }, [])

  const cancelStaged = useCallback(() => {
    setStagedFiles([])
    setPerSortExclusions('')
  }, [])

  const runSort = useCallback(async () => {
    if (!stagedFiles.length) return
    const files = stagedFiles
    const exclusions = perSortExclusions.trim()
    setStagedFiles([])
    setPerSortExclusions('')
    setProcessing(true)
    try {
      const res: OrganizeResult[] = await window.api.organizePhotos(
        files,
        exclusions || undefined
      )
      onResults(res)
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setProcessing(false)
    }
  }, [stagedFiles, perSortExclusions, onResults])

  useEffect(() => {
    return window.api.onOpenFiles(stageFiles)
  }, [stageFiles])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    const paths = Array.from(e.dataTransfer.files).map(f => f.path)
    stageFiles(paths)
  }, [stageFiles])

  const browse = useCallback(async () => {
    const paths = await window.api.pickFiles()
    stageFiles(paths)
  }, [stageFiles])

  const handleMoved = useCallback((updates: { index: number; newResult: OrganizeResult }[]) => {
    for (const { index, newResult } of updates) {
      onUpdateResult(index, newResult)
    }
    const remaining = countNeedingReview(
      sessionResults.map((r, i) => {
        const update = updates.find(u => u.index === i)
        return update ? update.newResult : r
      }),
      acceptedIndices
    )
    if (remaining === 0) setReviewing(false)
  }, [sessionResults, acceptedIndices, onUpdateResult])

  const acceptIndices = useCallback((indices: number[]) => {
    setAcceptedIndices(prev => {
      const next = new Set(prev)
      for (const i of indices) next.add(i)
      return next
    })
  }, [])

  const handleClear = useCallback(() => {
    setAcceptedIndices(new Set())
    setReviewing(false)
    onClearSession()
  }, [onClearSession])

  const showStaged = stagedFiles.length > 0 && !processing

  return (
    <div className="organize-layout">
      {/* ── Drop zone — always visible ─────────────────── */}
      <div className="organize-drop-wrap">
        <div
          className={`drop-zone ${over ? 'over' : ''}`}
          onDragOver={e => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          {processing ? (
            <div className="drop-zone-processing">
              <GearSpinner />
              <h2>Analyzing &amp; sorting…</h2>
              <p>Reading metadata, detecting content, organizing into folders.</p>
            </div>
          ) : showStaged ? (
            <div className="drop-zone-staged">
              <h2>{stagedFiles.length} {stagedFiles.length === 1 ? 'file' : 'files'} ready to sort</h2>
              <div className="staged-file-list">
                {stagedFiles.slice(0, 6).map((f, i) => (
                  <span key={i} className="staged-filename">{fileBasename(f)}</span>
                ))}
                {stagedFiles.length > 6 && (
                  <span className="staged-filename staged-more">+{stagedFiles.length - 6} more</span>
                )}
              </div>
              <div className="staged-exclusion">
                <label className="staged-exclusion-label">Exclude terms from this sort</label>
                <input
                  className="staged-exclusion-input"
                  value={perSortExclusions}
                  onChange={e => setPerSortExclusions(e.target.value)}
                  placeholder="e.g. My Company, client name"
                  onKeyDown={e => { if (e.key === 'Enter') runSort() }}
                  autoFocus
                />
                <p className="staged-exclusion-hint">
                  Comma-separated. These terms will be ignored during source detection for this batch only.
                </p>
              </div>
              <div className="staged-actions">
                <button className="btn-staged-sort" onClick={runSort}>
                  Sort {stagedFiles.length === 1 ? 'file' : 'files'}
                </button>
                <button className="btn-staged-cancel" onClick={cancelStaged}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="drop-zone-svg-wrap">
                <UploadIcon />
              </div>
              <h2>Drop files to organize</h2>
              <p className="drop-zone-formats">Photos — JPEG · PNG · HEIC · TIFF · WebP</p>
              <p className="drop-zone-formats" style={{ marginBottom: 16 }}>Documents — PDF</p>
              <span className="drop-zone-browse" onClick={browse}>or browse files</span>
            </>
          )}
        </div>
      </div>

      {/* ── Session results — scrollable pane ──────────── */}
      <div className="session-panel">
        {sessionResults.length > 0 && (
          <div className="session-panel-header">
            <span className="session-count">
              {sessionResults.length} {sessionResults.length === 1 ? 'file' : 'files'} this session
            </span>
            <div className="session-header-actions">
              {reviewCount > 0 && !reviewing && (
                <button className="btn-review-prompt" onClick={() => { setReviewing(true); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                  {reviewCount} {reviewCount === 1 ? 'file needs' : 'files need'} review
                </button>
              )}
              <button className="btn-clear-session" onClick={handleClear}>
                Clear
              </button>
            </div>
          </div>
        )}
        <div className="session-scroll" ref={scrollRef}>
          {reviewing && reviewCount > 0 && (
            <ReviewPanel
              results={sessionResults}
              acceptedIndices={acceptedIndices}
              onMoved={handleMoved}
              onAccept={acceptIndices}
              onDismiss={() => setReviewing(false)}
            />
          )}
          {sessionResults.length > 0 && (
            <div className="results">
              {sessionResults.map((r, i) => (
                <ResultCard
                  key={i}
                  result={r}
                  style={{ animationDelay: `${i * 40}ms` }}
                  showInlineReview
                  accepted={acceptedIndices.has(i)}
                  onAccept={() => acceptIndices([i])}
                  onMove={async (newRelPath) => {
                    const newPath = await window.api.moveFile(r.destinationPath, newRelPath)
                    const parts = newRelPath.split('/')
                    onUpdateResult(i, {
                      ...r,
                      destinationPath: newPath,
                      location: parts.slice(0, 2).join(' / ') || r.location,
                      category: parts.slice(2).join(' / ') || r.category
                    })
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
