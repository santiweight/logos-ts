import type {
  ParsedJob,
  ParsedLocation,
  ParsedSalary,
  ParsedApply,
  ApplyMethod,
  SalaryPeriod,
} from "../../shared/types"

/**
 * Parse one raw HN comment into a structured posting.
 *
 * @pure deterministic, total, no I/O
 *
 * @rules
 * - HN headers have NO fixed column order. Classify each '|'-delimited header
 *   segment by WHAT IT IS — salary / flag / location / role / url / employment
 *   type / company — never by position.
 * - Pull multiple roles from header conjunctions ("X and Y") and body bullets.
 * - Distinguish company website (homepage) from application URL (careers/ATS).
 * - De-obfuscate emails ("name at co dot com" -> "name@co.com").
 * - Normalize salary ranges and currency prefixes ("CA$" -> CAD).
 * - Be conservative with ambiguous tech tags such as "Go".
 * - parseConfidence is honest: "parsed" = company + a strong signal
 *   (role/location/salary); "partial" = company but weak; "raw-only" otherwise.
 *   Never fabricate fields to look complete.
 *
 * @example
 * - in:  "Acme | Senior Engineer | SF / Remote (US) | VISA | $180k | https://acme.com/jobs"
 *   out: { company: "Acme", roles: ["Senior Engineer"], remote: true, visa: true,
 *          salary: { min: 180000, currency: "USD" }, apply: { method: "link" } }
 * - in:  "Santa Clara, CA | ONSITE | Android Engineer | Jefit | $115K-$125K"
 *   out: { company: "Jefit", roles: ["Android Engineer"], onsite: true,
 *          salary: { min: 115000, max: 125000 } }
 * - in:  "This Dot Labs"
 *   out: { company: "This Dot Labs", parseConfidence: "raw-only" }
 */
export function parseJob(rawText: string, rawHtml?: string, author?: string): ParsedJob {
  const text = rawText || ""
  const context = { author }

  const remote = /\bremote\b/i.test(text)
  const onsite = /\bon-?site\b/i.test(text) || /\bin[- ]office\b/i.test(text)
  const hybrid = /\bhybrid\b/i.test(text) || /\d+x\s*\/?\s*week/i.test(text)
  const visa = /\bvisa\b/i.test(text) || /\bh1-?b\b/i.test(text) || /\bsponsor/i.test(text)
  const intern = /\binterns?\b/i.test(text) || /\binternship\b/i.test(text)

  const header = headerLine(text)
  const parts = splitHeader(header)

  // Classify each header segment.
  const classified = parts.map((seg) => ({ seg, type: classify(seg) }))

  // Company = first clean segment classified as "company" (usually parts[0],
  // but for location-first headers like Jefit it's whichever segment is the
  // leftover). Sentence-like leftovers are treated as raw text, not companies.
  const rawCompany = classified.find((c) => c.type === "company")?.seg.slice(0, 120) ?? null
  const company = resolveCompany(rawCompany, header, classified)

  // Roles from the header (role-classified segments, conjunction-split).
  const headerRoleSegs = parts.length > 1 ? classified.filter((c) => c.type === "role").map((c) => c.seg) : []
  const rolesSet: string[] = []
  for (const seg of headerRoleSegs) {
    for (const r of splitRoleSegment(seg)) {
      const rr = r.slice(0, 80)
      if (rr && !rolesSet.includes(rr)) rolesSet.push(rr)
    }
  }
  // Augment with body-listed roles (bullets / "open roles:" lists).
  for (const r of bodyRoles(text)) if (!rolesSet.includes(r)) rolesSet.push(r)
  const roles = rolesSet.slice(0, 12)
  const role = roles[0] ?? null

  // Employment type.
  const employmentType =
    classified.map((c) => employmentLabel(c.seg)).find((v): v is string => !!v) ??
    employmentLabel(text) ??
    (intern ? "internship" : null)

  // Location from location-classified header segments.
  const locParts = classified.filter((c) => c.type === "location").map((c) => c.seg)
  const remoteScope = detectRemoteScope(text)
  const location = buildLocation(locParts, { remote, onsite, hybrid }, remoteScope)

  const salary = parseSalary(text)
  const { website, apply } = parseLinks(text, rawHtml, company, header, context)
  const tags = detectTags(text)

  // Confidence: did we get a company plus at least one other strong signal?
  const strongSignals = [role, location.display, salary.min !== null ? "s" : null].filter(Boolean).length
  let parseConfidence: ParsedJob["parseConfidence"] = "raw-only"
  if (company && (parts.length >= 3 || strongSignals >= 1) && strongSignals >= 1) parseConfidence = "parsed"
  else if (company) parseConfidence = "partial"

  return {
    company,
    website,
    role,
    roles,
    employmentType,
    remote,
    onsite,
    hybrid,
    visa,
    intern,
    location,
    salary,
    apply,
    tags,
    parseConfidence,
  }
}

/**
 * Strip HN comment HTML to plain text (unescape entities, <p> -> newlines,
 * keep link text). No parsing opinions.
 * @pure
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<p>/gi, "\n\n")
    .replace(/<\/p>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// --- tech tags ---------------------------------------------------------------

interface TechKeyword {
  label: string
  pattern: RegExp
}

const TECH_KEYWORDS: TechKeyword[] = [
  { label: "TypeScript", pattern: /\btypescript\b/i },
  { label: "JavaScript", pattern: /\bjavascript\b/i },
  { label: "React", pattern: /\breact(?:\.js)?\b/i },
  { label: "Next.js", pattern: /\bnext\.?js\b/i },
  { label: "Node.js", pattern: /\bnode(?:\.js)?\b/i },
  { label: "Python", pattern: /\bpython\b/i },
  { label: "Go", pattern: /\bGolang\b|\bGo\b(?=[,/.)]|\s(?:and|engineers?|developers?|programmers?|backend|microservices?|services?|lang))/ },
  { label: "Rust", pattern: /\brust\b/i },
  { label: "Java", pattern: /\bjava\b(?!script)/i },
  { label: "Kotlin", pattern: /\bkotlin\b/i },
  { label: "Swift", pattern: /\bswift\b/i },
  { label: "Ruby", pattern: /\bruby(?:\s+on\s+rails)?\b/i },
  { label: "Rails", pattern: /\brails\b/i },
  { label: "C++", pattern: /\bc\+\+\b/i },
  { label: "C#", pattern: /\bc#\b/i },
  { label: "Elixir", pattern: /\belixir\b/i },
  { label: "Scala", pattern: /\bscala\b/i },
  { label: "PHP", pattern: /\bphp\b/i },
  { label: "Django", pattern: /\bdjango\b/i },
  { label: "PostgreSQL", pattern: /\b(?:postgres(?:ql)?|postgis)\b/i },
  { label: "MySQL", pattern: /\bmysql\b/i },
  { label: "Kubernetes", pattern: /\b(?:kubernetes|k8s)\b/i },
  { label: "Docker", pattern: /\bdocker\b/i },
  { label: "AWS", pattern: /\baws\b/i },
  { label: "GCP", pattern: /\b(?:gcp|google cloud)\b/i },
  { label: "Azure", pattern: /\bazure\b/i },
  { label: "GraphQL", pattern: /\bgraphql\b/i },
  { label: "Terraform", pattern: /\bterraform\b/i },
  { label: "ML/AI", pattern: /\b(?:machine learning|deep learning|\bml\b|\bai\b|llm|pytorch|tensorflow)\b/i },
  { label: "iOS", pattern: /\bios\b/i },
  { label: "Android", pattern: /\bandroid\b/i },
]

function detectTags(text: string): string[] {
  const found = new Set<string>()
  for (const { label, pattern } of TECH_KEYWORDS) {
    if (pattern.test(text)) found.add(label)
  }
  return Array.from(found)
}

// Plural-friendly role nouns ("Engineers", "Leads", "Architects" all match).
const ROLE_HINT = /\b(engineers?|developers?|designers?|managers?|scientists?|architects?|leads?|founders?|devops|sre|analysts?|researchers?|product|fullstack|full[- ]stack|frontend|front[- ]end|backend|back[- ]end|interns?|programmers?|administrators?|consultants?)\b/i

// --- application method -----------------------------------------------------

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PLACEHOLDER_EMAIL_RE =
  /(?:^|[^A-Z0-9._%+-])\(?\s*(my\s+HN\s+username|my\s+hacker\s+news\s+username|HN\s+username|hacker\s+news\s+username|my\s+first\s+name|my\s+name|your\s+name|first(?:\s|-)?name|name)\s*\)?\s*@\s*([A-Z0-9.-]+\.[A-Z]{2,})/i
const CONTACT_NAME_STOPWORDS = /^(?:hiring|looking|building|seeking|the|a|an|one|co|founder|founders?|ceo|cto|engineer|recruiter)$/i

function cleanEmail(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/[.,;]$/, "")
}

function isPlaceholderEmail(raw: string): boolean {
  const local = raw.split("@")[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? ""
  return ["name", "firstname", "yourname", "myname", "myfirstname", "firstnamelastname"].includes(local)
}

function inferContactLocalPart(text: string): string | null {
  const patterns = [
    /\bI(?:'|')?m\s+([A-Z][a-z]{1,29})\b/,
    /\bI\s+am\s+([A-Z][a-z]{1,29})\b/,
    /\bMy\s+name\s+is\s+([A-Z][a-z]{1,29})\b/,
    /\bThis\s+is\s+([A-Z][a-z]{1,29})\b/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const name = match?.[1]
    if (name && !CONTACT_NAME_STOPWORDS.test(name)) return name.toLowerCase()
  }
  return null
}

function authorLocalPart(author?: string): string | null {
  const clean = (author ?? "").trim().toLowerCase()
  if (!clean) return null
  const result = clean.replace(/[^a-z0-9._%+-]/g, "")
  return result || null
}

function placeholderLocalPart(placeholder: string, text: string, author?: string): string | null {
  if (/\b(?:hn|hacker\s+news)\s+username\b/i.test(placeholder)) {
    return authorLocalPart(author)
  }
  return inferContactLocalPart(text)
}

function resolveEmailCandidate(raw: string, text: string, author?: string): string | null {
  const email = cleanEmail(raw)
  if (!isPlaceholderEmail(email)) return email
  const domain = email.split("@")[1]
  const local = placeholderLocalPart(email.split("@")[0] ?? "", text, author)
  return domain && local ? `${local}@${domain}` : null
}

function detectEmail(text: string, author?: string): string | null {
  const direct = text.match(EMAIL_RE)
  if (direct) return resolveEmailCandidate(direct[0], text, author)

  // De-obfuscate clearly-delimited "at"/"dot" (bracketed or space-padded),
  // consuming surrounding whitespace. Never bare substrings ("creating").
  const deob = text
    .replace(/\s*\(\s*at\s*\)\s*|\s*\[\s*at\s*\]\s*/gi, "@")
    .replace(/\s*<\s*at\s*>\s*|\s*\{\s*at\s*\}\s*/gi, "@")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s*\(\s*dot\s*\)\s*|\s*\[\s*dot\s*\]\s*/gi, ".")
    .replace(/\s*<\s*dot\s*>\s*|\s*\{\s*dot\s*\}\s*/gi, ".")
    .replace(/\s+dot\s+/gi, ".")

  const deobEmail = deob.match(EMAIL_RE)
  if (deobEmail) return resolveEmailCandidate(deobEmail[0], text, author)

  const placeholder = deob.match(PLACEHOLDER_EMAIL_RE)
  if (placeholder) {
    const local = placeholderLocalPart(placeholder[1], text, author)
    return local ? `${local}@${placeholder[2]}` : null
  }

  return null
}

// Known applicant-tracking systems and application-form hosts.
const ATS_HOSTS = /(lever\.co|greenhouse\.io|ashbyhq\.com|workable\.com|breezy\.hr|recruitee\.com|smartrecruiters\.com|bamboohr\.com|myworkdayjobs\.com|workday\.com|tally\.so|airtable\.com|typeform\.com|fillout\.com|jobvite\.com|teamtailor\.com|rippling\.com|pinpointhq\.com|hire\.withgoogle\.com|join\.com|wellfound\.com|dover\.com|paylocity\.com|gusto\.com)/i
const APPLY_PATH = /\/(careers?|jobs?|join|apply|positions?|openings?|hiring|vacancies|work-with-us)\b/i
const APPLY_SUB = /^(jobs?|careers?|apply|boards?|join|work|hiring)\./i
const FREE_EMAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|live|proton|protonmail|pm\.me|icloud|me\.com|aol|hey\.com|fastmail|zoho|gmx)/i
const BARE_DOMAIN = /\b(?:[a-z0-9][a-z0-9-]*\.)+(?:com|io|org|co|dev|ai|net|app|so|xyz|tech|gov|edu|sh|fyi)\b(?:\/[^\s|)]*)?/gi

function hostOf(u: string): string {
  return u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase()
}

function originOf(u: string): string {
  const m = u.match(/^https?:\/\/[^/]+/i)
  return m ? m[0] : "https://" + hostOf(u)
}

function bareUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : "https://" + raw
}

function websiteOriginOf(u: string): string {
  const host = hostOf(u).replace(/^(jobs?|careers?|apply|boards?|join|work|hiring)\./i, "")
  return "https://" + host
}

function baseName(host: string): string {
  const h = host.replace(/^(www|about|go|get|app|jobs?|careers?|apply|boards?|join|work|hiring)\./i, "")
  const parts = h.split(".")
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0]
}

function isApplyUrl(u: string): boolean {
  return ATS_HOSTS.test(u) || APPLY_SUB.test(hostOf(u)) || APPLY_PATH.test(u)
}

function domainCompanyName(raw: string): string | null {
  const url = bareUrl(raw)
  if (isApplyUrl(url)) return null
  const base = baseName(hostOf(url))
  if (!base || base.length < 3) return null
  if (/^(github|linkedin|youtube|notion|levels|google|docs|forms|airtable|typeform)$/i.test(base)) return null
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function companyTokens(company: string | null): string[] {
  return (company || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4)
}

function collectHttpUrls(text: string, rawHtml?: string): string[] {
  const urls: string[] = []
  const push = (raw: string) => {
    const u = raw.replace(/&#x2F;/g, "/").replace(/&amp;/g, "&").replace(/[.,;]+$/, "")
    if (/^https?:\/\//i.test(u) && !/news\.ycombinator\.com/i.test(u) && !urls.includes(u)) urls.push(u)
  }
  if (rawHtml) {
    const re = /href="([^"]+)"/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(rawHtml))) if (!/^mailto:/i.test(m[1])) push(m[1])
  }
  const re2 = /https?:\/\/[^\s)<>"]+/gi
  let m2: RegExpExecArray | null
  while ((m2 = re2.exec(text))) push(m2[0])
  return urls
}

function mailtoFromHtml(html?: string): string | null {
  if (!html) return null
  const m = html.match(/href="mailto:([^"?]+)/i)
  return m ? m[1].replace(/&#x2F;/g, "/") : null
}

function bareDomains(header: string): string[] {
  // Strip http urls + emails so we don't double-count, then scan for domains.
  const cleaned = header
    .replace(/https?:\/\/[^\s|]+/gi, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
  return (cleaned.match(BARE_DOMAIN) || []).map((d) => d.trim())
}

// Resolve the company website and the application/careers link separately.
function parseLinks(
  text: string,
  rawHtml: string | undefined,
  company: string | null,
  header: string,
  context?: { author?: string }
): { website: string | null; apply: ParsedApply } {
  const urls = collectHttpUrls(text, rawHtml)
  const bares = bareDomains(header)
  const bareUrls = bares.map(bareUrl)
  const email = detectEmail(text, context?.author) ?? mailtoFromHtml(rawHtml)
  const tokens = companyTokens(company)

  // 1) Website: a link/domain whose base name matches the company name.
  const candidates = [...urls.map(websiteOriginOf), ...bareUrls.map(websiteOriginOf)]
  let website: string | null = null
  for (const c of candidates) {
    const bn = baseName(hostOf(c))
    if (bn.length >= 3 && tokens.some((t) => bn.includes(t) || t.includes(bn))) {
      website = c
      break
    }
  }

  // 2) Apply link: first ATS/careers URL.
  let applyUrl = [...urls, ...bareUrls].find(isApplyUrl) ?? null

  // 3) No company-matched website? Use the first non-apply link, else the
  //    email's domain (if it's a company domain, not a free provider).
  if (!website) {
    const nonApply = urls.find((u) => !isApplyUrl(u))
    if (nonApply) website = websiteOriginOf(nonApply)
    else if (email) {
      const dom = email.split("@")[1]
      if (dom && !FREE_EMAIL.test(dom)) website = "https://" + dom
    }
  }

  // 4) No explicit apply link? Any link that isn't the website can serve as one.
  if (!applyUrl) {
    const other = urls.find((u) => websiteOriginOf(u) !== website)
    if (other) applyUrl = other
  }

  let method: ApplyMethod
  if (applyUrl) method = "link"
  else if (email) method = "email"
  else if (/\b(reply|respond|comment)\b.{0,20}\b(here|below|to this|to me)\b/i.test(text)) method = "hn-reply"
  else method = "other"

  return { website, apply: { method, url: applyUrl, email } }
}

// --- salary ------------------------------------------------------------------

function codeToCurrency(prefix: string, sym: string): string | null {
  const p = prefix.toUpperCase()
  if (p === "CA" || p === "C") return "CAD"
  if (p === "AU" || p === "A") return "AUD"
  if (p === "NZ") return "NZD"
  if (p === "US") return "USD"
  if (p === "R") return "ZAR"
  switch (sym) {
    case "$":
      return "USD"
    case "€":
      return "EUR"
    case "£":
      return "GBP"
    default:
      return null
  }
}

function toNumber(raw: string, hasK: boolean): number {
  const n = Number(raw.replace(/,/g, ""))
  if (!Number.isFinite(n)) return NaN
  return hasK ? n * 1000 : n
}

function parseSalary(text: string): ParsedSalary {
  const equity = /\b(equity|stock options?|RSUs?)\b/i.test(text)
  const empty: ParsedSalary = { min: null, max: null, currency: null, period: null, equity, text: null }

  // Optional currency-letters + symbol, number, optional k, optional range.
  const num = `([A-Z]{0,2})?\\s?([$€£])?\\s?(\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?)\\s?(k)?`
  const range = text.match(new RegExp(`${num}\\s?(?:[-–—]|to)\\s?${num}`, "i"))
  const single = text.match(new RegExp(`([A-Z]{0,2})?\\s?([$€£])\\s?(\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?)\\s?(k)?`, "i"))

  let min: number | null = null
  let max: number | null = null
  let currency: string | null = null
  let snippet: string | null = null

  if (range) {
    const a = toNumber(range[3], !!range[4])
    const b = toNumber(range[7], !!range[8])
    const sym = range[2] || range[6] || ""
    const pre = range[1] || range[5] || ""
    if (Number.isFinite(a) && Number.isFinite(b)) {
      min = Math.min(a, b)
      max = Math.max(a, b)
      currency = sym ? codeToCurrency(pre, sym) : null
      snippet = range[0].trim()
    }
  }

  if (min === null && single) {
    const a = toNumber(single[3], !!single[4])
    if (Number.isFinite(a)) {
      min = a
      max = a
      currency = codeToCurrency(single[1] || "", single[2])
      snippet = single[0].trim()
    }
  }

  if (min !== null && !currency) {
    const code = text.match(/\b(USD|EUR|GBP|CAD|AUD|CHF|SEK|INR|NZD)\b/)
    if (code) currency = code[1]
  }

  let period: SalaryPeriod | null = null
  if (min !== null) {
    if (/\b(per\s*hour|\/\s*h(?:r|our)?|hourly)\b/i.test(text)) period = "hour"
    else if (/\b(per\s*month|\/\s*mo(?:nth)?|monthly)\b/i.test(text)) period = "month"
    else if (/\b(per\s*year|\/\s*y(?:r|ear)?|annual(?:ly)?|p\.?a\.?)\b/i.test(text)) period = "year"
    else if (max !== null && max >= 1000) period = "year"
  }

  if (min !== null && (max ?? min) < 1000 && period === null) return empty

  return { min, max, currency, period, equity, text: snippet }
}

// --- location ----------------------------------------------------------------

const US_STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC"

const PLACE_WORDS = new RegExp(
  "\\b(" +
    "remote|onsite|on-site|hybrid|anywhere|worldwide|global|" +
    "us|usa|u\\.s\\.|uk|eu|emea|apac|europe|america|americas|" +
    "san francisco|sf bay|bay area|\\bsf\\b|nyc|new york|los angeles|\\bla\\b|seattle|austin|boston|" +
    "chicago|denver|atlanta|portland|miami|toronto|vancouver|montreal|london|berlin|munich|paris|" +
    "amsterdam|dublin|madrid|barcelona|lisbon|zurich|stockholm|copenhagen|warsaw|prague|" +
    "bangalore|bengaluru|mumbai|delhi|singapore|sydney|melbourne|tokyo|seoul|tel aviv|" +
    "canada|germany|france|spain|india|australia|japan|israel|netherlands|poland|brazil|mexico" +
    ")\\b",
  "i"
)

const ORG_WORDS = /\b(department|agency|institute|university|college|laboratory|ministry|inc|llc|ltd|gmbh|corp|co\.|systems|technologies|solutions|labs)\b/i

function looksLikeLocation(seg: string): boolean {
  if (new RegExp(`,\\s*(?:${US_STATES})\\b`).test(seg)) return true // "Santa Clara, CA"
  if (/\(\s*(?:remote|us|usa|eu|europe|global|worldwide|anywhere)[^)]*\)/i.test(seg)) return true
  if (/\b(remote|on-?site|hybrid)\b/i.test(seg) && seg.length <= 48) return true
  if (PLACE_WORDS.test(seg)) {
    // Avoid grabbing org names like "Maryland Department of Information Technology".
    if (ORG_WORDS.test(seg) && seg.split(/\s+/).length > 3) return false
    return true
  }
  return false
}

function normalizeScope(raw: string): string {
  let s = raw.trim().replace(/\bonly\b/i, "").replace(/^(in|within|the)\s+/i, "").trim()
  const l = s.toLowerCase()
  if (/^(worldwide|anywhere|global|earth)/.test(l)) return "Worldwide"
  if (/^(us|usa|u\.s\.?|united states|north america|americas?)/.test(l)) return "US"
  if (/^(eu|europe|european)/.test(l)) return "EU"
  if (/^(uk|united kingdom|britain)/.test(l)) return "UK"
  if (/^emea/.test(l)) return "EMEA"
  if (/^(apac|asia)/.test(l)) return "APAC"
  return s.replace(/\s+/g, " ").slice(0, 40)
}

function detectRemoteScope(text: string): string | null {
  const paren = text.match(/remote\s*\(([^)]{1,48})\)/i)
  if (paren) return normalizeScope(paren[1])
  // Otherwise only pick up a *known region word* near "remote" — don't slurp
  // prose like "remote with US time zone overlap required".
  const near = text.match(
    /remote\b[^.|]{0,25}?\b(worldwide|anywhere|global|usa?|u\.s\.?|united states|eu|europe|uk|emea|apac|americas?|canada|germany|india|australia)\b/i
  )
  if (near) return normalizeScope(near[1])
  return null
}

function cleanPlace(part: string): string {
  return part
    .replace(/\(?\s*remote[^)]*\)?/gi, "")
    .replace(/\b(onsite|on-site|hybrid|visa|interns?|h1b|full[- ]?time|part[- ]?time|contract)\b/gi, "")
    .replace(/[()]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,/|·•-]+|[\s,/|·•-]+$/g, "")
    .trim()
}

function buildLocation(
  locParts: string[],
  flags: { remote: boolean; onsite: boolean; hybrid: boolean },
  remoteScope: string | null
): ParsedLocation {
  const places: string[] = []
  for (const p of locParts) {
    const c = cleanPlace(p)
    if (c && !places.includes(c)) places.push(c)
  }

  const segments: string[] = []
  if (places.length > 0) segments.push(places.join(" / "))
  if (flags.remote) segments.push(`Remote${remoteScope ? ` (${remoteScope})` : ""}`)
  else if (flags.onsite && places.length === 0) segments.push("On-site")
  let display = segments.join(" · ") || null
  if (display && flags.hybrid && !/hybrid/i.test(display)) display += " · Hybrid"

  return { display, places, remoteScope: flags.remote ? remoteScope : null }
}

// --- roles -------------------------------------------------------------------

// Split a header role segment on conjunctions, keeping multi-word roles intact.
function splitRoleSegment(seg: string): string[] {
  const pieces = seg.split(/\s*\/\s*|\s*&\s*|\s+and\s+/i).map((p) => p.trim()).filter(Boolean)
  return pieces.length > 1 ? pieces : [seg.trim()]
}

// Pull additional roles from the body: bullet lines, or lines shortly after an
// "Open roles:" / "We're hiring:" cue. Trims trailing "(url)" / ": url".
function bodyRoles(text: string): string[] {
  const lines = text.split("\n").map((l) => l.trim())
  const out: string[] = []
  let cueWindow = 0
  for (const line of lines) {
    if (/\b(open roles|we(?:'| a)?re hiring|roles?:|positions?:|hiring for)\b/i.test(line)) {
      cueWindow = 6
    }
    const bullet = /^[*••\-–]\s+/.test(line)
    const candidate = line.replace(/^[*••\-–]\s+/, "").replace(/\s*[:(].*$/, "").trim()
    if ((bullet || cueWindow > 0) && candidate.length >= 3 && candidate.length <= 60 && ROLE_HINT.test(candidate)) {
      if (!out.includes(candidate)) out.push(candidate)
    }
    if (cueWindow > 0) cueWindow--
    if (out.length >= 10) break
  }
  return out
}

// --- header classification --------------------------------------------------

type SegType = "salary" | "flag" | "employment" | "url" | "location" | "role" | "date" | "company"

const FLAG_ONLY = /^(remote|onsite|on-site|hybrid|visa|interns?|h1b|relocation)$/i
const EMPLOYMENT = /\b(full[- ]?time|part[- ]?time|full or part-time|contract|contractor|freelance|internship|w-?2|c2c|permanent)\b/i
const DATE_SEG = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i
const NOISE_HEADER = /^(?:\[flagged\]|>|@|edit:|update:|applied\b|curious\b|don['']?t\b|good luck\b|sent an email\b|what['']?s up\b|in addition\b|aggregated\b|\d+\s+comments\b)/i

function classify(seg: string): SegType {
  const s = seg.trim()
  if (!s) return "company"
  if (/^https?:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+\/?$/i.test(s)) return "url"
  if (/[$€£]\s?\d/.test(s) || /\b\d{2,3}\s?k\b/i.test(s)) return "salary"
  if (FLAG_ONLY.test(s)) return "flag"
  if (looksLikeLocation(s)) return "location"
  if (EMPLOYMENT.test(s) && s.split(/\s+/).length <= 4) return "employment"
  if (DATE_SEG.test(s)) return "date"
  if (ROLE_HINT.test(s)) return "role"
  return "company"
}

function splitHeader(header: string): string[] {
  return header
    .split(/\s*[|]\s*|\s*[•·]\s*|\s+[—–]\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

function isStructuredHeaderLine(line: string): boolean {
  const parts = splitHeader(line)
  if (parts.length < 2) return false
  const types = parts.map(classify)
  return types.some((t) => t !== "company" && t !== "date")
}

function headerLine(text: string): string {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean)
  const structured = lines.find((line) => !NOISE_HEADER.test(line) && isStructuredHeaderLine(line))
  if (structured) return structured
  return lines.find((line) => !NOISE_HEADER.test(line)) ?? lines[0] ?? ""
}

function employmentLabel(seg: string): string | null {
  const m = seg.match(EMPLOYMENT)
  if (!m) return null
  const v = m[0].toLowerCase().replace(/\s+/g, "-")
  if (/full/.test(v) && /part/.test(v)) return "full-time"
  if (/full/.test(v)) return "full-time"
  if (/part/.test(v)) return "part-time"
  if (/intern/.test(v)) return "internship"
  if (/contract|freelance|c2c|w-?2/.test(v)) return "contract"
  return v
}

function cleanCompanyName(raw: string | null): string | null {
  if (!raw) return null
  const clean = raw
    .replace(/\s+/g, " ")
    .replace(/^[*•]+\s*/, "")
    .replace(/\s*\(?https?:\/\/.*$/i, "")
    .trim()
    .replace(/[.,;:]+$/, "")
  return clean || null
}

function looksLikeCompanyName(raw: string | null): raw is string {
  const clean = cleanCompanyName(raw)
  if (!clean) return false
  const words = clean.split(/\s+/)
  if (clean.length > 80 || words.length > 8) return false
  if (
    /^(?:\[flagged\]|>|@|i\b|i['']m\b|we\b|we['']re\b|hi\b|hey\b|not hiring\b|full[- ]?time\b|part[- ]?time\b|applied\b|curious\b|don['']?t\b|good luck\b|sent an email\b|what['']?s up\b|in addition\b|aggregated\b|edit:|update:|\d+\s+comments\b)/i.test(
      clean
    )
  ) {
    return false
  }
  if (/[!?]{2,}/.test(clean)) return false
  if (/\b(?:companies|startups|job boards?|search tools?|looking for someone|actively helping|ghost job|comments as of|generic rejection|please only post)\b/i.test(clean)) {
    return false
  }
  return true
}

function companyFromProse(header: string): string | null {
  const patterns = [
    /^At\s+(.+?)(?:\s*\(|,|\s+we\b)/i,
    /^Hey HN!.*?\bteam at\s+(.+?)(?:\s*\(|,|\.|$)/i,
    /^Hi[^.\n]{0,100}?\bat\s+(.+?)(?:\s*\(|,|\.|$)/i,
    /\bco-?founder of\s+(.+?)(?:\s+with|,|\.|$)/i,
    /^Hiring for several roles at\s+(.+?)(?:,|\s+an?\b|\s+is\b|$)/i,
    /^Full Time and Part Time roles\s+(.+?)\s+is hiring\b/i,
    /^([A-Z][A-Za-z0-9&.' -]{1,60}?)\s*\(https?:/i,
    /^([A-Z][A-Za-z0-9&.' -]{1,60}?)\s+(?:is|are)\s+\b/i,
    /^([A-Z][A-Za-z0-9&.' -]{1,60}?),\s+(?:founded|is|we)\b/i,
    /^([A-Z][A-Za-z0-9&.' -]{1,60}?)\s+[-–—]\s+/i,
  ]

  for (const pattern of patterns) {
    const match = header.match(pattern)
    const company = cleanCompanyName(match?.[1] ?? null)
    if (looksLikeCompanyName(company)) return company
  }
  return null
}

interface ClassifiedSegment {
  seg: string
  type: SegType
}

function companyFromHeaderUrl(header: string, classified: ClassifiedSegment[]): string | null {
  const urlSegs = classified.filter((c) => c.type === "url").map((c) => c.seg)
  const urlish = [...urlSegs, ...collectHttpUrls(header), ...bareDomains(header)]
  for (const raw of urlish) {
    const company = domainCompanyName(raw)
    if (company) return company
  }
  return null
}

function resolveCompany(
  rawCandidate: string | null,
  header: string,
  classified: ClassifiedSegment[]
): string | null {
  const candidate = cleanCompanyName(rawCandidate)
  if (looksLikeCompanyName(candidate)) return candidate
  return companyFromProse(header) ?? companyFromHeaderUrl(header, classified)
}
