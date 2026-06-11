import type { ParsedJob, JobTaxonomy, ClassificationConfidence } from "../../shared/types"

export const TAXONOMY_VERSION = "role-taxonomy-v1"

export const ROLE_FAMILIES = [
  "engineering", "data", "ml-ai", "design", "product", "devops-sre",
  "security", "qa", "mobile", "frontend", "backend", "fullstack",
  "research", "management", "sales", "marketing", "support", "operations",
] as const

export const SENIORITY_LEVELS = [
  "intern", "junior", "mid", "senior", "staff", "principal", "lead",
  "manager", "director", "vp",
] as const

/**
 * Second pure pass: normalize a ParsedJob's free-text roles/locations into
 * controlled facets.
 *
 * @pure
 *
 * @rules
 * - roleFamilies and seniority must be drawn from ROLE_FAMILIES / SENIORITY_LEVELS.
 * - locationRegions are coarse buckets ("north-america", "emea", "apac", "remote").
 * - salaryBucket = "disclosed" if any salary number is present, else "undisclosed".
 * - Set needsReview + reviewReason when confidence is low or signals conflict
 *   (e.g. parseConfidence is "raw-only", or no role family could be assigned).
 *
 * @example
 * - in:  { roles: ["Senior Android Engineer"], salary: { min: 115000 } }
 *   out: { roleFamilies: ["mobile"], seniority: "senior", salaryBucket: "disclosed" }
 */

interface RoleMatch {
  families: string[]
  specialties: string[]
  strength: "strong" | "weak"
}

const VAGUE_ROLE =
  /^(senior|sr|staff|principal|lead|junior|jr|mid|engineering|engineers?|software|product|ai|ml|backend|frontend|fullstack|full-stack|devops|sre|rails|python|react|ruby|rust|go|java|php|i)$/i
const SUSPICIOUS_ROLE = /(\^|\$|\\b|^\d+$|caused customers|all managers are|mature product)/i
const ROLE_CUE =
  /\b(engineers?|developers?|designers?|managers?|scientists?|researchers?|architects?|analysts?|leads?|devops|sre|founders?|sales|marketing|growth|support|success|devrel|advocates?|ops|gtm|product|data|security|hardware|robotics?|embedded|firmware|fde)\b/i

function addUnique(out: string[], values: string[]) {
  for (const value of values) {
    if (!out.includes(value)) out.push(value)
  }
}

function cleanRoleCandidate(role: string): string {
  return role
    .replace(/^[*•\-\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .replace(/\s*[|:]\s*https?:\/\/.*$/i, "")
    .trim()
}

function compactCandidates(roles: string[], primaryRole: string | null): string[] {
  const out: string[] = []
  for (const role of [...roles, primaryRole ?? ""]) {
    const cleaned = cleanRoleCandidate(role)
    if (cleaned && cleaned.length <= 100 && !out.includes(cleaned)) out.push(cleaned)
  }
  return out
}

function fallbackCandidates(rawText: string): string[] {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5)
  const out: string[] = []
  for (const line of lines) {
    const parts = line.includes("|") ? line.split("|") : [line]
    for (const part of parts) {
      const cleaned = cleanRoleCandidate(part)
        .replace(/^(hiring|we(?:'| a)?re hiring|roles?:|multiple roles?:)\s+/i, "")
        .trim()
      if (
        cleaned.length >= 3 &&
        cleaned.length <= 140 &&
        ROLE_CUE.test(cleaned) &&
        !/^https?:\/\//i.test(cleaned) &&
        !/\b(remote|onsite|on-site|hybrid|full[- ]time|part[- ]time|contract)\b/i.test(cleaned) &&
        !out.includes(cleaned)
      ) {
        out.push(cleaned)
      }
    }
  }
  return out
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

// Map original role family names to our vocabulary
function mapRoleFamily(originalFamily: string): string {
  const mapping: Record<string, string> = {
    "Software Engineering": "engineering",
    Frontend: "frontend",
    Backend: "backend",
    "Full-stack / Product Engineering": "fullstack",
    Mobile: "mobile",
    "Infrastructure / SRE / DevOps": "devops-sre",
    "AI / ML / Research": "ml-ai",
    "Data / Analytics": "data",
    Security: "security",
    "Hardware / Robotics / Embedded": "research",
    "Product Management": "product",
    Design: "design",
    "Customer / Field / DevRel": "operations",
    "GTM / Business / Ops": "operations",
    "Leadership / Management": "management",
  }
  return mapping[originalFamily] || "engineering"
}

// Map original seniority names to our vocabulary
function mapSeniority(originalSeniority: string | null): string | null {
  if (!originalSeniority) return null
  const mapping: Record<string, string> = {
    Intern: "intern",
    Junior: "junior",
    Mid: "mid",
    Senior: "senior",
    "Staff / Principal": "staff",
    "Lead / Manager": "lead",
    "Director / Head / VP": "director",
    "Founder / Cofounder": "principal",
  }
  return mapping[originalSeniority] || null
}

// Classify a single role candidate using the original logic
function classifyRoleCandidate(candidate: string): RoleMatch {
  const text = candidate.toLowerCase()
  const families: string[] = []
  const specialties: string[] = []
  let strength: "strong" | "weak" = VAGUE_ROLE.test(candidate) ? "weak" : "strong"

  // Product Management
  const productManagement = matchesAny(text, [
    /\bproduct\s+managers?\b/,
    /\bprincipal\s+pm\b/,
    /\bsenior\s+pm\b/,
    /\bgroup\s+pm\b/,
    /\btechnical\s+product\s+managers?\b/,
    /\bproduct\s+owners?\b/,
  ])
  if (productManagement) {
    addUnique(families, ["Product Management"])
    addUnique(specialties, ["Product Management"])
  }

  // Product Engineering (fullstack)
  const productEngineering = matchesAny(text, [
    /\bproduct\s+engineers?\b/,
    /\bfull[- ]?stack\b/,
    /\bfullstack\b/,
  ])
  if (productEngineering) {
    addUnique(families, ["Full-stack / Product Engineering"])
    addUnique(specialties, text.includes("product engineer") ? ["Product Engineering"] : ["Full-stack"])
  }

  // Frontend
  const designEngineer = /\bdesign\s+engineers?\b/.test(text)
  const frontend =
    designEngineer ||
    matchesAny(text, [
      /\bfront[- ]?end\b/,
      /\bfrontend\b/,
      /\bui\s+engineers?\b/,
      /\bweb\s+engineers?\b/,
      /\breact\s+(?:native\s+)?(?:engineers?|developers?)\b/,
    ])
  if (frontend) {
    addUnique(families, ["Frontend"])
    addUnique(specialties, ["Frontend"])
  }

  // Backend
  const backend = matchesAny(text, [
    /\bback[- ]?end\b/,
    /\bbackend\b/,
    /\bapi\s+engineers?\b/,
    /\bserver(?:s|[- ]side)?\b/,
    /\bdatabase\s+(?:engineers?|experts?)\b/,
  ])
  if (backend) {
    addUnique(families, ["Backend"])
    addUnique(specialties, ["Backend"])
  }

  // Mobile
  const mobile = matchesAny(text, [
    /\bmobile\b/,
    /\bios\b/,
    /\bandroid\b/,
    /\breact\s+native\b/,
  ])
  if (mobile) {
    addUnique(families, ["Mobile"])
    if (/\bios\b/.test(text)) addUnique(specialties, ["iOS"])
    if (/\bandroid\b/.test(text)) addUnique(specialties, ["Android"])
    if (/\breact\s+native\b/.test(text)) addUnique(specialties, ["React Native"])
    if (!matchesAny(text, [/\bios\b/, /\bandroid\b/, /\breact\s+native\b/])) addUnique(specialties, ["Mobile"])
  }

  // Infrastructure / SRE / DevOps
  const infrastructure = matchesAny(text, [
    /\bsre\b/,
    /\bsite\s+reliability\b/,
    /\bdevops\b/,
    /\binfra(?:structure)?\b/,
    /\bplatform\s+engineers?\b/,
    /\bcloud\s+(?:engineers?|architects?|infrastructure)\b/,
    /\bkubernetes\s+engineers?\b/,
    /\bobservability\b/,
    /\breliability\b/,
    /\bmlops\b/,
  ])
  if (infrastructure) {
    addUnique(families, ["Infrastructure / SRE / DevOps"])
    if (/\bsre\b|\bsite\s+reliability\b/.test(text)) addUnique(specialties, ["SRE"])
    if (/\bdevops\b/.test(text)) addUnique(specialties, ["DevOps"])
    if (/\bplatform\b/.test(text)) addUnique(specialties, ["Platform"])
    if (/\bmlops\b/.test(text)) addUnique(specialties, ["MLOps"])
    if (specialties.length === 0) addUnique(specialties, ["Infrastructure"])
  }

  // AI / ML / Research
  const aiMl = matchesAny(text, [
    /\bai\s+(?:engineers?|scientists?|researchers?|architects?)\b/,
    /\bai\s+solutions?\s+engineers?\b/,
    /\bapplied\s+ai\b/,
    /\bmachine\s+learning\b/,
    /\bml\s+engineers?\b/,
    /\bmle\b/,
    /\bllm\b/,
    /\bmlops\b/,
    /\bresearch\s+(?:engineers?|scientists?)\b/,
    /\bapplied\s+scientists?\b/,
    /\bcomputer\s+vision\b/,
    /\bnlp\b/,
  ])
  if (aiMl) {
    addUnique(families, ["AI / ML / Research"])
    if (/\bllm\b/.test(text)) addUnique(specialties, ["LLM"])
    if (/\bmlops\b/.test(text)) addUnique(specialties, ["MLOps"])
    if (/\bresearch\b/.test(text)) addUnique(specialties, ["Research"])
    if (/\bcomputer\s+vision\b/.test(text)) addUnique(specialties, ["Computer Vision"])
    if (/\bnlp\b/.test(text)) addUnique(specialties, ["NLP"])
    if (!specialties.some((s) => ["LLM", "MLOps", "Research", "Computer Vision", "NLP"].includes(s))) {
      addUnique(specialties, ["Machine Learning"])
    }
  }

  // Data / Analytics
  const data = matchesAny(text, [
    /\bdata\s+engineers?\b/,
    /\banalytics?\s+engineers?\b/,
    /\bdata\s+scientists?\b/,
    /\bdata\s+platform\b/,
    /\bbi\s+(?:engineers?|analysts?)\b/,
    /\bbusiness\s+intelligence\b/,
    /\bdata\s+analysts?\b/,
  ])
  if (data) {
    addUnique(families, ["Data / Analytics"])
    if (/\bdata\s+scientists?\b/.test(text)) addUnique(specialties, ["Data Science"])
    else if (/\banalytics?\s+engineers?\b/.test(text)) addUnique(specialties, ["Analytics Engineering"])
    else if (/\bbi\b|\bbusiness\s+intelligence\b/.test(text)) addUnique(specialties, ["BI"])
    else addUnique(specialties, ["Data Engineering"])
  }

  // Security
  if (/\bsecurity\b|\bappsec\b|\bsecops\b|\bcybersecurity\b/.test(text)) {
    addUnique(families, ["Security"])
    addUnique(specialties, /\bblockchain\b/.test(text) ? ["Blockchain Security"] : ["Security"])
  }

  // Hardware / Robotics / Embedded
  const hardware = matchesAny(text, [
    /\bhardware\b/,
    /\brobotics?\b/,
    /\bembedded\b/,
    /\bfirmware\b/,
    /\bfpga\b/,
    /\belectrical\b/,
    /\bmechanical\b/,
    /\bcontrols?\s+engineers?\b/,
    /\bsemiconductor\b/,
    /\bavionics?\b/,
  ])
  if (hardware) {
    addUnique(families, ["Hardware / Robotics / Embedded"])
    if (/\brobotics?\b/.test(text)) addUnique(specialties, ["Robotics"])
    if (/\bembedded\b|\bfirmware\b/.test(text)) addUnique(specialties, ["Embedded"])
    if (/\bcontrols?\b/.test(text)) addUnique(specialties, ["Controls"])
    if (specialties.length === 0) addUnique(specialties, ["Hardware"])
  }

  // Design
  const design =
    designEngineer ||
    matchesAny(text, [
      /\bproduct\s+designers?\b/,
      /\bux\b/,
      /\bui\/ux\b/,
      /\bux\/ui\b/,
      /\bvisual\s+designers?\b/,
      /\bbrand\s+designers?\b/,
      /\bdesign\s+systems?\b/,
      /\binteraction\s+designers?\b/,
      /\bcourse\s+designers?\b/,
    ])
  if (design) {
    addUnique(families, ["Design"])
    addUnique(specialties, designEngineer ? ["Design Engineering"] : ["Design"])
  }

  // Customer / Field / DevRel
  const customerField = matchesAny(text, [
    /\bsolutions?\s+engineers?\b/,
    /\bsales\s+engineers?\b/,
    /\bforward\s+deployed\b/,
    /\bfield\s+engineers?\b/,
    /\bdeveloper\s+(?:relations?|advocates?)\b/,
    /\bdevrel\b/,
    /\btechnical\s+account\b/,
    /\btam\b/,
    /\bimplementation\s+(?:engineers?|consultants?)\b/,
    /\bprofessional\s+services\b/,
    /\bcustomer\s+(?:success|support)\b/,
  ])
  if (customerField) {
    addUnique(families, ["Customer / Field / DevRel"])
    if (/\bforward\s+deployed\b/.test(text)) addUnique(specialties, ["Forward Deployed"])
    else if (/\bsolutions?\s+engineers?\b/.test(text)) addUnique(specialties, ["Solutions Engineering"])
    else if (/\bsales\s+engineers?\b/.test(text)) addUnique(specialties, ["Sales Engineering"])
    else if (/\bdevrel\b|\bdeveloper\s+(?:relations?|advocates?)\b/.test(text)) addUnique(specialties, ["DevRel"])
    else addUnique(specialties, ["Customer Engineering"])
  }

  // GTM / Business / Ops
  const gtmOps = matchesAny(text, [
    /\bsales\b(?!\s+engineer)/,
    /\bmarketing\b/,
    /\bgrowth\b/,
    /\bbizops\b/,
    /\bbusiness\s+operations\b/,
    /\boperations\b/,
    /\bpeople\s*ops\b/,
    /\bhr\b/,
    /\brecruit(?:er|ing)\b/,
    /\baffiliate\b/,
    /\becosystem\b/,
    /\bfinance\b/,
    /\bchief\s+of\s+staff\b/,
  ])
  if (gtmOps) {
    addUnique(families, ["GTM / Business / Ops"])
    addUnique(specialties, ["GTM / Ops"])
  }

  // Leadership / Management
  const leadership = matchesAny(text, [
    /\bengineering\s+managers?\b/,
    /\bem\b/,
    /\btech(?:nical)?\s+leads?\b/,
    /\bteam\s+leads?\b/,
    /\bhead\s+of\b/,
    /\bdirectors?\b/,
    /\bvp\b/,
    /\bcto\b/,
    /\bco-?founders?\b/,
    /\bfounders?\b(?!\s+engineer)/,
  ])
  if (leadership) {
    addUnique(families, ["Leadership / Management"])
    addUnique(specialties, ["Leadership"])
  }

  // Generic Software Engineering fallback
  const genericSoftware = matchesAny(text, [
    /\bsoftware\s+(?:engineers?|developers?)\b/,
    /\bsoftware\s+engineering\b/,
    /\bdevelopers?\b/,
    /\bengineers?\b/,
    /\bprogrammers?\b/,
  ])
  const hasSpecificEngineering = families.some((f) =>
    [
      "Frontend",
      "Backend",
      "Full-stack / Product Engineering",
      "Mobile",
      "Infrastructure / SRE / DevOps",
      "AI / ML / Research",
      "Data / Analytics",
      "Security",
      "Hardware / Robotics / Embedded",
      "Customer / Field / DevRel",
      "Design",
    ].includes(f)
  )
  if (genericSoftware && !hasSpecificEngineering && !/\bforward\s+deployed\b/.test(text)) {
    addUnique(families, ["Software Engineering"])
    addUnique(specialties, ["Software Engineering"])
  }

  return { families, specialties, strength }
}

function detectSeniority(
  employmentType: string | null,
  intern: boolean,
  candidates: string[]
): string | null {
  const text = `${candidates.join(" ")} ${employmentType ?? ""}`.toLowerCase()
  if (intern || employmentType === "internship" || /\binterns?\b|\bco-?op\b/.test(text)) return "Intern"
  if (/\bco-?founders?\b|\bfounders?\b(?!\s+engineer)/.test(text)) return "Founder / Cofounder"
  if (/\b(head\s+of|director|vp|vice\s+president|cto|chief)\b/.test(text)) return "Director / Head / VP"
  if (/\b(staff|principal|distinguished)\b/.test(text)) return "Staff / Principal"
  if (/\b(lead|tech\s+lead|engineering\s+manager|manager,\s*engineering)\b/.test(text)) return "Lead / Manager"
  if (/\b(senior|sr\.?|senior\+)\b/.test(text)) return "Senior"
  if (/\b(junior|jr\.?|entry[- ]level|new\s+grad)\b/.test(text)) return "Junior"
  if (/\b(mid[- ]level|intermediate)\b/.test(text)) return "Mid"
  return null
}

function normalizeRegion(raw: string): string | null {
  const text = raw.toLowerCase()
  if (/\b(worldwide|anywhere|global|international|world)\b/.test(text)) return "Worldwide"
  if (/\b(us|usa|u\.s\.|united states|north america|americas?)\b/.test(text)) return "US"
  if (/\b(eu|europe|european)\b/.test(text)) return "EU"
  if (/\b(uk|united kingdom|britain|ireland)\b/.test(text)) return "UK"
  if (/\bcanada\b/.test(text)) return "Canada"
  if (/\bemea\b/.test(text)) return "EMEA"
  if (/\b(apac|asia|singapore|japan|korea|india)\b/.test(text)) return "APAC"
  if (/\b(latam|latin america|south america|brazil|mexico)\b/.test(text)) return "LATAM"
  if (/\baustralia\b/.test(text)) return "Australia"
  return null
}

function detectLocationRegions(
  remoteScope: string | null,
  locationDisplay: string | null,
  places: string[]
): string[] {
  const out: string[] = []
  for (const part of [remoteScope, locationDisplay, ...places]) {
    if (!part) continue
    const region = normalizeRegion(part)
    if (region && !out.includes(region)) out.push(region)
  }
  return out
}

export function classifyJobTaxonomy(parsed: ParsedJob, rawText: string): JobTaxonomy {
  // Build candidates from parsed roles
  const parsedCandidates = compactCandidates(parsed.roles, parsed.role)
  const usedFallback = parsedCandidates.length === 0
  const candidates = usedFallback ? fallbackCandidates(rawText) : parsedCandidates

  const families: string[] = []
  const specialties: string[] = []
  const reviewReasons: string[] = []
  let weakOnly = candidates.length === 0

  // Classify each candidate role
  for (const candidate of candidates) {
    if (SUSPICIOUS_ROLE.test(candidate)) reviewReasons.push("suspicious role title")
    if (VAGUE_ROLE.test(candidate)) reviewReasons.push("vague role title")
    const match = classifyRoleCandidate(candidate)
    if (match.families.length > 0 && match.strength === "strong") weakOnly = false
    addUnique(families, match.families)
    addUnique(specialties, match.specialties)
  }

  // Determine if we need review
  if (families.length === 0) {
    reviewReasons.push(candidates.length > 0 ? "unknown role family" : "missing role")
  }
  if (parsed.parseConfidence === "raw-only") reviewReasons.push("raw-only parse")

  // Map original families to our vocabulary
  const mappedFamilies = families.map(mapRoleFamily)
  const uniqueFamilies = Array.from(new Set(mappedFamilies))

  // Determine classification confidence
  let classificationConfidence: ClassificationConfidence
  if (families.length === 0) classificationConfidence = "unknown"
  else if (parsed.parseConfidence === "raw-only" || weakOnly) classificationConfidence = "low"
  else if (usedFallback || parsed.parseConfidence === "partial" || reviewReasons.length > 0)
    classificationConfidence = "medium"
  else classificationConfidence = "high"

  const needsReview =
    classificationConfidence === "low" ||
    classificationConfidence === "unknown" ||
    reviewReasons.includes("suspicious role title")

  const uniqueReasons = Array.from(new Set(reviewReasons))

  // Detect seniority and map to our vocabulary
  const detectedSeniority = detectSeniority(parsed.employmentType, parsed.intern, candidates)
  const mappedSeniority = mapSeniority(detectedSeniority)

  // Detect location regions
  const locationRegions = detectLocationRegions(
    parsed.location.remoteScope,
    parsed.location.display,
    parsed.location.places
  )

  return {
    roleFamilies: uniqueFamilies,
    roleSpecialties: specialties,
    seniority: mappedSeniority,
    locationRegions,
    salaryBucket: parsed.salary.min != null || parsed.salary.max != null ? "disclosed" : "undisclosed",
    taxonomyVersion: TAXONOMY_VERSION,
    classificationConfidence,
    needsReview,
    reviewReason: uniqueReasons.length > 0 ? uniqueReasons.join("; ") : null,
  }
}
