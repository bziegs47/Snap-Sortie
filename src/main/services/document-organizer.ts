import { mkdir, copyFile, readFile, stat } from 'fs/promises'
import { join, basename, extname } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import type { Settings } from './store'
import { resolveCollision } from './collision'
import type { BrowserWindow } from 'electron'
import type { OrganizeResult } from './organizer'

// ── Text extractor interface (for future Google Cloud Document AI) ──

export interface ExtractedText {
  text: string
  confidence: number
  pages: number
}

export interface TextExtractor {
  extract(buffer: Buffer, filename: string): Promise<ExtractedText | null>
}

// ── pdf-parse extractor ─────────────────────────────────────────────

class PdfParseExtractor implements TextExtractor {
  async extract(buffer: Buffer, _filename: string): Promise<ExtractedText | null> {
    try {
      // Skip very large files (>50MB)
      if (buffer.length > 50 * 1024 * 1024) return null

      const pdfParse = (await import('pdf-parse')).default
      const result = await pdfParse(buffer, { max: 10 }) // limit to first 10 pages

      const text = result.text?.trim() || ''
      // Only return if there's meaningful text content (not just whitespace/garbage)
      const nonWhitespace = text.replace(/\s/g, '')
      if (nonWhitespace.length < 50) return null

      return {
        text,
        confidence: nonWhitespace.length > 200 ? 0.8 : 0.5,
        pages: result.numpages || 1
      }
    } catch {
      return null
    }
  }
}

// ── Google Cloud Document AI extractor (stub) ───────────────────────

class GoogleDocAIExtractor implements TextExtractor {
  async extract(_buffer: Buffer, _filename: string): Promise<ExtractedText | null> {
    throw new Error('Google Cloud Document AI is not configured. Add your API key in Settings.')
  }
}

// ── Extractor factory ───────────────────────────────────────────────

function getExtractor(settings: Settings): TextExtractor | null {
  const backend = settings.textExtractorBackend || 'pdf-parse'
  switch (backend) {
    case 'google-docai':
      return new GoogleDocAIExtractor()
    case 'pdf-parse':
      return new PdfParseExtractor()
    case 'none':
      return null
    default:
      return new PdfParseExtractor()
  }
}

// ── Classification types ────────────────────────────────────────────

interface DocClassification {
  documentType: string
  source: string
  date: string | null
  confidence: number
  classificationMethod: 'claude' | 'text-extract' | 'filename' | 'google-docai'
  reasoning?: string
}

function buildExclusionRegex(terms: string): RegExp | null {
  const words = terms.split(',').map(t => t.trim()).filter(Boolean)
  if (!words.length) return null
  const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return new RegExp(`\\b(${pattern})\\b`, 'i')
}

const PLURAL_MAP: Record<string, string> = {
  'Invoice': 'Invoices', 'Receipt': 'Receipts', 'Contract': 'Contracts',
  'Statement': 'Statements', 'Tax Form': 'Tax Forms', 'Letter': 'Letters',
  'Report': 'Reports', 'Manual': 'Manuals', 'Resume': 'Resumes',
  'Certificate': 'Certificates', 'Permit': 'Permits', 'Proposal': 'Proposals',
  'Presentation': 'Presentations', 'Spreadsheet': 'Spreadsheets',
  'Application': 'Applications', 'Correspondence': 'Correspondence'
}

function pluralizeType(docType: string): string {
  return PLURAL_MAP[docType] || docType
}

// ── Claude vision-powered classification ────────────────────────────

async function classifyWithClaude(
  pdfBuffer: Buffer,
  filename: string,
  apiKey: string,
  excludedTerms: string,
  extractedText: string | null
): Promise<DocClassification> {
  const client = new Anthropic({ apiKey })
  const pdfBase64 = pdfBuffer.toString('base64')

  const contentBlocks: Anthropic.MessageCreateParams['messages'][0]['content'] = [
    {
      type: 'document' as const,
      source: {
        type: 'base64' as const,
        media_type: 'application/pdf' as const,
        data: pdfBase64
      }
    },
    {
      type: 'text',
      text: `Analyze this PDF document. Return ONLY a JSON object with these fields:

- "documentType": Choose the MOST specific match from this list:
  Invoice, Receipt, Contract, Statement, Tax Form, Letter, Report,
  Manual, Resume, Legal, Insurance, Medical, Correspondence,
  Application, Certificate, Permit, Proposal, Presentation,
  Spreadsheet, Other
- "source": The company, organization, or sender name. Look at:
  letterheads, logos, headers, "From:" fields, return addresses,
  footers, and watermarks. Keep it short (just the company name).
  Use "Unknown" ONLY if truly not identifiable anywhere in the document.
- "date": The primary document date in YYYY-MM-DD format.
  Prefer: invoice date > statement date > letter date > signature date.
  Use null if no date is visible.
- "confidence": A number 0.0 to 1.0 indicating your certainty about
  BOTH documentType and source combined:
  0.9-1.0 = Clear letterhead/logo, obvious document type, unambiguous
  0.7-0.89 = Fairly confident, minor ambiguity in one field
  0.5-0.69 = Moderate guessing, content partially readable or generic
  Below 0.5 = Significant uncertainty, scanned/blurry, or very generic
- "reasoning": One sentence explaining your classification decision.

For multi-page documents: focus on the first 1-2 pages for
classification. Only check later pages if the first page is ambiguous
(e.g., cover pages, table of contents).

${excludedTerms ? `EXCLUDED source names — do NOT use any of these: ${excludedTerms}` : ''}
${extractedText ? `\nExtracted text from PDF (may be incomplete):\n${extractedText}` : ''}
Filename: ${filename}`
    }
  ]

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    messages: [{ role: 'user', content: contentBlocks }]
  })

  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') {
    return { documentType: 'Other', source: 'Unknown', date: null, confidence: 0.2, classificationMethod: 'claude' }
  }

  try {
    const jsonMatch = block.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { documentType: 'Other', source: 'Unknown', date: null, confidence: 0.2, classificationMethod: 'claude' }
    const parsed = JSON.parse(jsonMatch[0])

    let docType = sanitize(String(parsed.documentType || 'Other'))
    let source = sanitize(String(parsed.source || 'Unknown'))
    docType = pluralizeType(docType)

    const exclusionRegex = buildExclusionRegex(excludedTerms)
    if (exclusionRegex && exclusionRegex.test(source)) source = 'Unknown'

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined
    const date = parsed.date && typeof parsed.date === 'string' ? parsed.date : null

    return { documentType: docType, source, date, confidence, classificationMethod: 'claude', reasoning }
  } catch {
    return { documentType: 'Other', source: 'Unknown', date: null, confidence: 0.2, classificationMethod: 'claude' }
  }
}

// ── Text-based classification (when pdf-parse returns usable text) ──

function classifyFromText(text: string, filename: string, excludedTerms: string): DocClassification {
  const upper = text.slice(0, 2000).toUpperCase()
  const exclusionRegex = buildExclusionRegex(excludedTerms)

  // Document type detection from text content
  let documentType = 'Other'
  if (/\bINVOICE\b/.test(upper) || /\bBILL\s+TO\b/.test(upper)) documentType = 'Invoice'
  else if (/\bRECEIPT\b/.test(upper) || /\bPAYMENT\s+RECEIVED\b/.test(upper)) documentType = 'Receipt'
  else if (/\bCONTRACT\b/.test(upper) || /\bAGREEMENT\b/.test(upper)) documentType = 'Contract'
  else if (/\bSTATEMENT\b/.test(upper) && !/\bMISSION\s+STATEMENT\b/.test(upper)) documentType = 'Statement'
  else if (/\bW-?2\b/.test(upper) || /\b1099\b/.test(upper) || /\bTAX\s+RETURN\b/.test(upper)) documentType = 'Tax Form'
  else if (/\bPROPOSAL\b/.test(upper) || /\bSOW\b/.test(upper) || /\bSCOPE\s+OF\s+WORK\b/.test(upper)) documentType = 'Proposal'
  else if (/\bRESUME\b/.test(upper) || /\bCURRICULUM\s+VITAE\b/.test(upper) || /\bEXPERIENCE\b.*\bEDUCATION\b/.test(upper)) documentType = 'Resume'
  else if (/\bINSURANCE\b/.test(upper) || /\bPOLICY\s+(NUMBER|NO|#)\b/.test(upper)) documentType = 'Insurance'
  else if (/\bESTIMATE\b/.test(upper) || /\bQUOTE\b/.test(upper) || /\bBID\b/.test(upper)) documentType = 'Estimate'
  else if (/\bREPORT\b/.test(upper)) documentType = 'Report'
  else if (/\bCERTIFICATE\b/.test(upper)) documentType = 'Certificate'
  else if (/\bPERMIT\b/.test(upper) || /\bLICENSE\b/.test(upper)) documentType = 'Permit'
  else if (/\bNDA\b/.test(upper) || /\bNON-?DISCLOSURE\b/.test(upper) || /\bMSA\b/.test(upper)) documentType = 'Legal'
  else if (/\bLETTER\b/.test(upper) || /\bDEAR\s/i.test(text.slice(0, 500))) documentType = 'Letter'
  documentType = pluralizeType(documentType)

  // Source detection from text content
  let source = 'Unknown'
  // Look for common patterns that indicate the source
  const fromMatch = text.match(/(?:From|Sender|Issued by|Prepared by|Company)[:\s]+([A-Z][A-Za-z\s&.,]+?)(?:\n|$)/m)
  if (fromMatch) {
    const candidate = cleanVendor(fromMatch[1].trim(), exclusionRegex)
    if (candidate) source = candidate
  }
  // Try the first line of text as a potential company header
  if (source === 'Unknown') {
    const firstLines = text.trim().split('\n').slice(0, 3)
    for (const line of firstLines) {
      const trimmed = line.trim()
      // Skip very short lines, date-like lines, and common headers
      if (trimmed.length < 3 || trimmed.length > 60) continue
      if (/^\d/.test(trimmed) || /^(page|date|to|from|re:|subject)/i.test(trimmed)) continue
      const candidate = cleanVendor(trimmed, exclusionRegex)
      if (candidate && candidate.length >= 3 && candidate.length <= 40) {
        source = candidate
        break
      }
    }
  }
  // Fall back to filename vendor extraction
  if (source === 'Unknown') {
    const fileVendor = extractVendorFromFilename(filename, exclusionRegex)
    if (fileVendor) source = fileVendor
  }

  // Date detection from text content
  let date: string | null = null
  const datePatterns = [
    /(\d{4})-(\d{2})-(\d{2})/,                                    // YYYY-MM-DD
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,                              // MM/DD/YYYY
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2}),?\s+(\d{4})/i  // Month DD, YYYY
  ]
  for (const pattern of datePatterns) {
    const match = text.slice(0, 2000).match(pattern)
    if (match) {
      try {
        const d = new Date(match[0])
        if (!isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) {
          date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          break
        }
      } catch { /* skip */ }
    }
  }

  return {
    documentType,
    source,
    date,
    confidence: 0.5,
    classificationMethod: 'text-extract',
    reasoning: `Classified from extracted PDF text (${documentType === 'Other' ? 'no strong keyword match' : 'keyword match found'})`
  }
}

// ── Smart vendor extraction from filename ───────────────────────────

const DOC_TYPE_KEYWORDS = /\b(sow|proposal|summary|invoice|receipt|contract|agreement|statement|report|estimate|quote|memo|letter|amendment|addendum|nda|msa|tos|eula)\b/i
const SCANNER_PREFIXES = /^(scan|img|doc|document|pdf|file|image|photo|page|copy)[\s_\-]*\d*/i

function extractVendorFromFilename(filename: string, exclusionRegex: RegExp | null): string | null {
  const stem = basename(filename, extname(filename))

  // Filter out common scanner/default prefixes
  if (SCANNER_PREFIXES.test(stem)) {
    const cleaned = stem.replace(SCANNER_PREFIXES, '').replace(/^[\s_\-]+/, '')
    if (cleaned.length < 3) return null
    // Continue with cleaned stem if there's something meaningful after the prefix
  }

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
      !SCANNER_PREFIXES.test(s) &&
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

// ── Fallback heuristic classification (no API key, no text) ─────────

function classifyFallback(filename: string, excludedTerms: string): DocClassification {
  const stem = basename(filename, extname(filename)).toLowerCase()

  let documentType = 'Other'
  if (/invoice|bill/i.test(stem)) documentType = 'Invoice'
  else if (/receipt|payment/i.test(stem)) documentType = 'Receipt'
  else if (/contract|agreement/i.test(stem)) documentType = 'Contract'
  else if (/sow|proposal/i.test(stem)) documentType = 'Proposal'
  else if (/statement/i.test(stem)) documentType = 'Statement'
  else if (/w-?2|1099|tax/i.test(stem)) documentType = 'Tax Form'
  else if (/insurance|policy/i.test(stem)) documentType = 'Insurance'
  else if (/resume|cv/i.test(stem)) documentType = 'Resume'
  else if (/report/i.test(stem)) documentType = 'Report'
  else if (/estimate|quote|bid/i.test(stem)) documentType = 'Estimate'
  else if (/certificate|cert/i.test(stem)) documentType = 'Certificate'
  else if (/permit|license/i.test(stem)) documentType = 'Permit'
  else if (/nda|msa|tos|eula/i.test(stem)) documentType = 'Legal'
  else if (/letter|correspondence/i.test(stem)) documentType = 'Letter'
  else if (/order/i.test(stem)) documentType = 'Invoice'
  documentType = pluralizeType(documentType)

  const exclusionRegex = buildExclusionRegex(excludedTerms)
  const source = extractVendorFromFilename(filename, exclusionRegex) || 'Unknown'

  return {
    documentType,
    source,
    date: null,
    confidence: 0.3,
    classificationMethod: 'filename',
    reasoning: `Classified from filename only (${documentType === 'Other' ? 'no keyword match' : 'keyword match'})`
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function titleCase(str: string): string {
  return str.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase())
}

function sanitize(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim()
}

function parseDate(dateStr: string | null, fallback: Date): Date {
  if (dateStr) {
    const d = new Date(dateStr)
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) return d
  }
  return fallback
}

// ── Main entry point ────────────────────────────────────────────────

export async function organizeDocument(
  filePath: string,
  settings: Settings,
  parentWindow?: BrowserWindow | null
): Promise<OrganizeResult> {
  try {
    // 1. Read PDF
    const buffer = await readFile(filePath)
    const excluded = settings.excludedTerms || ''

    // 2. Try text extraction (supplementary)
    const extractor = getExtractor(settings)
    let extractedText: string | null = null
    if (extractor) {
      try {
        const result = await extractor.extract(buffer, basename(filePath))
        if (result) {
          // Cap at 2000 chars for Claude prompt context
          extractedText = result.text.slice(0, 2000)
        }
      } catch { /* text extraction is optional */ }
    }

    // 3. Classify document
    let classification: DocClassification
    if (settings.anthropicApiKey) {
      try {
        classification = await classifyWithClaude(buffer, basename(filePath), settings.anthropicApiKey, excluded, extractedText)
      } catch {
        // Claude failed — try text-based, then filename fallback
        if (extractedText) {
          classification = classifyFromText(extractedText, basename(filePath), excluded)
        } else {
          classification = classifyFallback(basename(filePath), excluded)
        }
      }
    } else if (extractedText) {
      // No API key but we have extracted text
      classification = classifyFromText(extractedText, basename(filePath), excluded)
    } else {
      classification = classifyFallback(basename(filePath), excluded)
    }

    // 4. Supplement: if source is Unknown, try filename extraction
    if (classification.source === 'Unknown') {
      const exclusionRegex = buildExclusionRegex(excluded)
      const fileVendor = extractVendorFromFilename(basename(filePath), exclusionRegex)
      if (fileVendor) classification.source = fileVendor
    }

    const { documentType, source } = classification

    // 5. Determine date — prefer classification date, fall back to file mtime
    const fileStat = await stat(filePath)
    const date = parseDate(classification.date, fileStat.mtime)
    const year = date.getFullYear().toString()
    const monthNum = String(date.getMonth() + 1).padStart(2, '0')
    const monthName = date.toLocaleString('en-US', { month: 'short' })
    const month = `${monthNum} ${monthName}`

    // 6. Build destination: Documents/<Type>/<Source>/<Year>/<Month>/
    const destDir = join(settings.outputDir, 'Documents', documentType, source, year, month)
    await mkdir(destDir, { recursive: true })

    // 7. Collision handling
    const collision = await resolveCollision(destDir, basename(filePath), parentWindow)
    if (collision.choice === 'skip') {
      return {
        originalPath: filePath,
        destinationPath: '',
        location: `${documentType} / ${source}`,
        category: `${year} / ${month}`,
        error: 'Skipped — file already exists'
      }
    }
    const destPath = collision.path

    // 8. Copy
    await copyFile(filePath, destPath)

    return {
      originalPath: filePath,
      destinationPath: destPath,
      location: `${documentType} / ${source}`,
      category: `${year} / ${month}`,
      confidence: classification.confidence,
      classificationMethod: classification.classificationMethod,
      classificationReasoning: classification.reasoning
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
