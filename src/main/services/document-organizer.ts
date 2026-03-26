import { mkdir, copyFile, readFile, stat } from 'fs/promises'
import { join, basename, extname } from 'path'
import { existsSync } from 'fs'
import Anthropic from '@anthropic-ai/sdk'
import type { Settings } from './store'
import type { OrganizeResult } from './organizer'

interface DocClassification {
  documentType: string
  source: string
  date: string | null
}

function buildExclusionRegex(terms: string): RegExp | null {
  const words = terms.split(',').map(t => t.trim()).filter(Boolean)
  if (!words.length) return null
  const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return new RegExp(`\\b(${pattern})\\b`, 'i')
}

// ── Claude vision-powered classification ───────────────────────

async function classifyWithClaude(
  pdfBuffer: Buffer,
  filename: string,
  apiKey: string,
  excludedTerms: string
): Promise<DocClassification> {
  const client = new Anthropic({ apiKey })

  const pdfBase64 = pdfBuffer.toString('base64')

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64
            }
          },
          {
            type: 'text',
            text: `Analyze this PDF document visually. Return ONLY a JSON object with three fields:

- "documentType": the most specific category. Choose from: Invoice, Receipt, Contract, Statement, Tax Form, Letter, Report, Manual, Resume, Legal, Insurance, Medical, Correspondence, Application, Certificate, Permit, Proposal, Presentation, Spreadsheet, Other
- "source": the company, organization, or sender (e.g. "Stripe", "IRS", "Chase Bank", "Google"). Look at letterheads, logos, headers, and content to identify this. If unclear, use "Unknown"
- "date": the primary date on the document in YYYY-MM-DD format. Look for invoice dates, statement dates, letter dates, signature dates, etc. If no date is visible, use null

${excludedTerms ? `Do NOT include any of these as a source name — skip them if found: ${excludedTerms}` : ''}
Keep source names short and clean (just the company/org name).
The filename is: ${filename}`
          }
        ]
      }
    ]
  })

  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') {
    return { documentType: 'Other', source: 'Unknown', date: null }
  }

  try {
    const jsonMatch = block.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { documentType: 'Other', source: 'Unknown', date: null }
    const parsed = JSON.parse(jsonMatch[0])
    let docType = sanitize(String(parsed.documentType || 'Other'))
    let source = sanitize(String(parsed.source || 'Unknown'))

    // Pluralize for folder names
    const pluralMap: Record<string, string> = {
      'Invoice': 'Invoices', 'Receipt': 'Receipts', 'Contract': 'Contracts',
      'Statement': 'Statements', 'Tax Form': 'Tax Forms', 'Letter': 'Letters',
      'Report': 'Reports', 'Manual': 'Manuals', 'Resume': 'Resumes',
      'Certificate': 'Certificates', 'Permit': 'Permits', 'Proposal': 'Proposals',
      'Presentation': 'Presentations', 'Spreadsheet': 'Spreadsheets',
      'Application': 'Applications', 'Correspondence': 'Correspondence'
    }
    docType = pluralMap[docType] || docType

    const exclusionRegex = buildExclusionRegex(excludedTerms)
    if (exclusionRegex && exclusionRegex.test(source)) source = 'Unknown'

    const date = parsed.date && typeof parsed.date === 'string' ? parsed.date : null

    return { documentType: docType, source, date }
  } catch {
    return { documentType: 'Other', source: 'Unknown', date: null }
  }
}

// ── Smart vendor extraction from filename ──────────────────────

const DOC_TYPE_KEYWORDS = /\b(sow|proposal|summary|invoice|receipt|contract|agreement|statement|report|estimate|quote|memo|letter|amendment|addendum|nda|msa|tos|eula)\b/i

/**
 * Extract vendor/company name from filename using multiple strategies:
 * 1. Look for "_from_VendorName" or "-from-VendorName"
 * 2. Split on " - " or " _ " delimiters and take the first segment
 * 3. Split before the first doc-type keyword (SOW, PROPOSAL, etc.)
 * Then clean by stripping excluded names, dates, numbers-only segments.
 */
function extractVendorFromFilename(filename: string, exclusionRegex: RegExp | null): string | null {
  const stem = basename(filename, extname(filename))

  // Strategy 1: explicit "from" marker
  const fromMatch = stem.match(/[_\-\s]from[_\-\s]+(.+)$/i)
  if (fromMatch) {
    const candidate = cleanVendor(fromMatch[1], exclusionRegex)
    if (candidate) return candidate
  }

  // Strategy 2: split on " - " delimiter, first segment is often the vendor
  if (stem.includes(' - ')) {
    const parts = stem.split(' - ')
    const candidate = cleanVendor(parts[0], exclusionRegex)
    if (candidate) return candidate
  }

  // Strategy 3: split on "_-_" or similar delimiters
  if (/_-_|_–_/.test(stem)) {
    const parts = stem.split(/_-_|_–_/)
    const candidate = cleanVendor(parts[0], exclusionRegex)
    if (candidate) return candidate
  }

  // Strategy 4: split before first doc-type keyword
  const kwMatch = stem.match(DOC_TYPE_KEYWORDS)
  if (kwMatch && kwMatch.index && kwMatch.index > 1) {
    const before = stem.slice(0, kwMatch.index)
    const candidate = cleanVendor(before, exclusionRegex)
    if (candidate) return candidate
  }

  // Strategy 5: split on underscores/hyphens, take segments that look like names
  const segments = stem.split(/[_\-]+/).filter(s => s.length > 1)
  if (segments.length >= 2) {
    const nameSegments = segments.filter(s =>
      !/^\d+$/.test(s) &&
      !/^\d{4}$/.test(s) &&
      !/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i.test(s) &&
      !DOC_TYPE_KEYWORDS.test(s) &&
      !(exclusionRegex && exclusionRegex.test(s))
    )
    if (nameSegments.length > 0) {
      const candidate = titleCase(nameSegments[0])
      if (candidate.length > 1) return candidate
    }
  }

  return null
}

function cleanVendor(raw: string, exclusionRegex: RegExp | null): string | null {
  let cleaned = raw
    .replace(/[_\-]+/g, ' ')
    .replace(/\b\d{4,}\b/g, '')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (!cleaned || cleaned.length < 2) return null
  if (exclusionRegex && exclusionRegex.test(cleaned)) return null
  if (/^\d+$/.test(cleaned)) return null

  return titleCase(cleaned)
}

// ── Fallback heuristic classification (no API key) ─────────────

function classifyFallback(filename: string, excludedTerms: string): DocClassification {
  const stem = basename(filename, extname(filename)).toLowerCase()

  let documentType = 'Other'
  if (/invoice|bill/i.test(stem)) documentType = 'Invoices'
  else if (/receipt|payment/i.test(stem)) documentType = 'Receipts'
  else if (/contract|agreement/i.test(stem)) documentType = 'Contracts'
  else if (/sow|proposal/i.test(stem)) documentType = 'Proposals'
  else if (/statement/i.test(stem)) documentType = 'Statements'
  else if (/w-?2|1099|tax/i.test(stem)) documentType = 'Tax Forms'
  else if (/insurance|policy/i.test(stem)) documentType = 'Insurance'
  else if (/resume|cv/i.test(stem)) documentType = 'Resumes'
  else if (/report/i.test(stem)) documentType = 'Reports'
  else if (/estimate|quote/i.test(stem)) documentType = 'Estimates'
  else if (/nda|msa|tos|eula/i.test(stem)) documentType = 'Legal'

  const exclusionRegex = buildExclusionRegex(excludedTerms)
  const source = extractVendorFromFilename(filename, exclusionRegex) || 'Unknown'

  return { documentType, source, date: null }
}

// ── Helpers ────────────────────────────────────────────────────

function titleCase(str: string): string {
  return str.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase())
}

function sanitize(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim()
}

function parseDate(dateStr: string | null, fallback: Date): Date {
  if (dateStr) {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d
  }
  return fallback
}

// ── Main entry point ───────────────────────────────────────────

export async function organizeDocument(
  filePath: string,
  settings: Settings
): Promise<OrganizeResult> {
  try {
    // 1. Read PDF
    const buffer = await readFile(filePath)

    // 2. Classify document
    let classification: DocClassification
    const excluded = settings.excludedTerms || ''
    if (settings.anthropicApiKey) {
      try {
        classification = await classifyWithClaude(buffer, basename(filePath), settings.anthropicApiKey, excluded)
      } catch {
        classification = classifyFallback(basename(filePath), excluded)
      }
    } else {
      classification = classifyFallback(basename(filePath), excluded)
    }

    // Supplement: if Claude (or fallback) returned Unknown source, try filename
    if (classification.source === 'Unknown') {
      const exclusionRegex = buildExclusionRegex(excluded)
      const fileVendor = extractVendorFromFilename(basename(filePath), exclusionRegex)
      if (fileVendor) classification.source = fileVendor
    }

    const { documentType, source } = classification

    // 3. Determine date — prefer Claude-extracted, fall back to file mtime
    const fileStat = await stat(filePath)
    const date = parseDate(classification.date, fileStat.mtime)
    const year = date.getFullYear().toString()
    const monthNum = String(date.getMonth() + 1).padStart(2, '0')
    const monthName = date.toLocaleString('en-US', { month: 'short' })
    const month = `${monthNum} ${monthName}`

    // 4. Build destination: Documents/<Type>/<Source>/<Year>/<Month>/
    const destDir = join(settings.outputDir, 'Documents', documentType, source, year, month)
    await mkdir(destDir, { recursive: true })

    // 5. Collision handling
    const ext = extname(filePath)
    const base = basename(filePath, ext)
    let destPath = join(destDir, basename(filePath))
    let counter = 1
    while (existsSync(destPath)) {
      destPath = join(destDir, `${base}_${counter}${ext}`)
      counter++
    }

    // 6. Copy
    await copyFile(filePath, destPath)

    return {
      originalPath: filePath,
      destinationPath: destPath,
      location: `${documentType} / ${source}`,
      category: `${year} / ${month}`
    }
  } catch (err) {
    return {
      originalPath: filePath,
      destinationPath: '',
      location: '',
      category: '',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
