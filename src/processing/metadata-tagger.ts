import type { Chunk } from "../types/core-contracts.d.ts";
import type {
  ChunkTags,
  TaggingContext,
  ExtractedEntities
} from "../types/core-contracts.d.ts";

// ── Stopwords ────────────────────────────────────────────────────────

const ENGLISH_STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must", "ought",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "its", "our", "their",
  "this", "that", "these", "those", "what", "which", "who", "whom",
  "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
  "neither", "each", "every", "all", "any", "few", "more", "most",
  "other", "some", "such", "no", "only", "own", "same", "than",
  "too", "very", "just", "also", "now", "then", "here", "there",
  "when", "where", "why", "how", "if", "because", "as", "until",
  "while", "of", "at", "by", "for", "with", "about", "against",
  "between", "through", "during", "before", "after", "above", "below",
  "to", "from", "up", "down", "in", "out", "on", "off", "over",
  "under", "again", "further", "once"
]);

const SPANISH_STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del",
  "al", "y", "e", "o", "u", "en", "con", "por", "para", "sin",
  "sobre", "entre", "hasta", "desde", "hacia", "durante", "mediante",
  "que", "se", "su", "sus", "es", "son", "fue", "ser", "está",
  "están", "como", "pero", "más", "ya", "muy", "si", "no", "lo",
  "le", "les", "me", "te", "nos", "os", "mi", "tu", "este", "esta",
  "estos", "estas", "ese", "esa", "esos", "esas", "aquel", "aquella",
  "hay", "ha", "han", "tiene", "tienen", "todo", "toda", "todos",
  "todas", "otro", "otra", "otros", "otras", "mismo", "misma",
  "cada", "donde", "cuando", "quien", "cual", "cuyo"
]);

const ALL_STOPWORDS = new Set([...ENGLISH_STOPWORDS, ...SPANISH_STOPWORDS]);

// ── Domain keyword maps ──────────────────────────────────────────────

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  legal: [
    "artículo", "articulo", "ley", "decreto", "resolución", "resolucion",
    "tribunal", "sentencia", "demanda", "jurisdicción", "jurisdiccion",
    "constitución", "constitucion", "normativa", "reglamento", "ordenanza",
    "contract", "clause", "statute", "plaintiff", "defendant", "court",
    "legal", "law", "regulation", "compliance", "liability", "attorney",
    "section", "subsection", "amendment", "precedent"
  ],
  medical: [
    "patient", "diagnosis", "treatment", "symptom", "clinical", "therapy",
    "hospital", "medical", "disease", "medication", "prescription",
    "paciente", "diagnóstico", "diagnostico", "tratamiento", "síntoma",
    "sintoma", "clínico", "clinico", "terapia", "enfermedad", "medicamento"
  ],
  technical: [
    "function", "class", "module", "api", "database", "server", "deploy",
    "algorithm", "interface", "component", "repository", "endpoint",
    "config", "pipeline", "runtime", "compiler", "debug", "refactor",
    "test", "implementation", "dependency", "framework", "library"
  ],
  financial: [
    "revenue", "profit", "loss", "balance", "asset", "liability",
    "investment", "stock", "bond", "dividend", "portfolio", "fiscal",
    "budget", "expense", "income", "tax", "audit", "accounting",
    "ingreso", "gasto", "presupuesto", "activo", "pasivo", "inversión",
    "inversion", "impuesto", "contable", "balance", "factura"
  ],
  educational: [
    "student", "teacher", "curriculum", "lesson", "course", "exam",
    "grade", "learning", "education", "school", "university", "lecture",
    "alumno", "estudiante", "docente", "profesor", "materia", "examen",
    "calificación", "calificacion", "aprendizaje", "educación", "educacion"
  ]
};

// ── Language detection words ─────────────────────────────────────────

const SPANISH_MARKERS = ["de", "el", "que", "en", "los", "las", "del", "por", "con", "una", "para", "está", "son", "como"];
const ENGLISH_MARKERS = ["the", "is", "and", "are", "for", "was", "with", "that", "this", "have", "from", "been", "has", "were"];

// ── Helpers ──────────────────────────────────────────────────────────

function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-záéíóúñüa-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter(w => w.length > 1);
}

function detectLanguage(words: string[]): string {
  let esScore = 0;
  let enScore = 0;

  for (const word of words) {
    if (SPANISH_MARKERS.includes(word)) esScore++;
    if (ENGLISH_MARKERS.includes(word)) enScore++;
  }

  if (esScore > enScore * 1.2) return "es";
  if (enScore > esScore * 1.2) return "en";
  if (esScore > 0 && enScore === 0) return "es";
  return "en";
}

function detectDomain(words: string[]): string {
  const scores: Record<string, number> = {};

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    scores[domain] = 0;
    for (const word of words) {
      if (keywords.includes(word)) {
        scores[domain]++;
      }
    }
  }

  let bestDomain = "general";
  let bestScore = 0;

  for (const [domain, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  // Require a minimum signal to avoid false positives
  return bestScore >= 2 ? bestDomain : "general";
}

function extractTopics(words: string[], limit: number = 5): string[] {
  const freq = new Map<string, number>();

  for (const word of words) {
    if (word.length < 3) continue;
    if (ALL_STOPWORDS.has(word)) continue;

    freq.set(word, (freq.get(word) || 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function computeComplexity(sentences: string[], words: string[]): "low" | "medium" | "high" {
  if (sentences.length === 0 || words.length === 0) return "low";

  const avgSentenceLen = words.length / sentences.length;
  const uniqueWords = new Set(words).size;
  const diversity = uniqueWords / words.length;

  // Combined heuristic
  const score = (avgSentenceLen / 20) + (diversity * 2);

  if (score > 2.0) return "high";
  if (score > 1.2) return "medium";
  return "low";
}

function computeReadingLevel(words: string[]): "basic" | "intermediate" | "advanced" {
  if (words.length === 0) return "basic";

  const avgLen = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  const longWordRatio = words.filter(w => w.length > 8).length / words.length;

  if (avgLen > 6.5 || longWordRatio > 0.25) return "advanced";
  if (avgLen > 5.0 || longWordRatio > 0.12) return "intermediate";
  return "basic";
}

function detectSentiment(text: string): "neutral" | "positive" | "negative" {
  const lower = text.toLowerCase();
  const positiveWords = ["good", "great", "excellent", "benefit", "improve", "success", "advantage", "bueno", "excelente", "beneficio", "mejor", "éxito"];
  const negativeWords = ["bad", "fail", "error", "problem", "issue", "risk", "danger", "wrong", "malo", "fallo", "error", "problema", "riesgo", "peligro"];

  let posCount = 0;
  let negCount = 0;

  for (const word of positiveWords) {
    if (lower.includes(word)) posCount++;
  }
  for (const word of negativeWords) {
    if (lower.includes(word)) negCount++;
  }

  if (posCount > negCount + 1) return "positive";
  if (negCount > posCount + 1) return "negative";
  return "neutral";
}

/**
 * Automatically tag a chunk with metadata.
 *
 * Detects: domain, topics, language, complexity, code presence,
 * legal references, sentiment, word count, and reading level.
 */
export function tagChunk(chunk: Chunk, context?: TaggingContext): ChunkTags {
  const text = chunk.content;
  const words = tokenizeWords(text);
  const sentences = splitSentences(text);
  const language = detectLanguage(words);
  const domain = context?.sourceType === "legal" ? "legal" : detectDomain(words);
  const topics = extractTopics(words);
  const complexity = computeComplexity(sentences, words);
  const readingLevel = computeReadingLevel(words);
  const sentiment = detectSentiment(text);
  const hasCode = /```|`[^`]+`|\bfunction\b|\bclass\b|\bconst\b|\bimport\b|\bexport\b/.test(text);
  const hasLegalRef = /\b(?:Art(?:[íi]culo|\.)\s*\d|Section\s+\d|§\s*\d|Ley\s+\d)/i.test(text);
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  return {
    domain,
    topics,
    language,
    complexity,
    hasCode,
    hasLegalRef,
    sentiment,
    wordCount,
    readingLevel
  };
}

/**
 * Backward-compatible alias used by legacy JS modules.
 */
export function tagChunkMetadata(chunk: Chunk, context?: TaggingContext): ChunkTags {
  return tagChunk(chunk, context);
}
