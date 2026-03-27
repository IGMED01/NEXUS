export type ChunkKind = "code" | "test" | "spec" | "memory" | "doc" | "chat" | "log";

/**
 * Structural symbols extracted from a code chunk by the symbol extractor (NEXUS:1).
 * Populated by symbol-extractor.js; used by the noise-canceler for structural scoring.
 */
export interface ChunkSymbols {
  imports: string[];
  exports: string[];
  functions: string[];
  classes: string[];
  interfaces: string[];
  types: string[];
  dependencies: string[];
}

/**
 * Processing metadata attached to a chunk after NEXUS:1 enrichment.
 */
export interface ChunkProcessing {
  symbols?: ChunkSymbols;
  /** Structural match score cached from the last selection pass [0,1] */
  structuralScore?: number;
}

export interface Chunk {
  id: string;
  source: string;
  kind: ChunkKind;
  content: string;
  certainty?: number;
  recency?: number;
  teachingValue?: number;
  priority?: number;
  tokens?: string[];
  tags?: Record<string, unknown>;
  retrievalScore?: number;
  vectorScore?: number;
  /** Structural metadata from NEXUS:1 symbol extraction */
  processing?: ChunkProcessing;
}

export interface ChunkFile {
  chunks: Chunk[];
}

export interface ChunkDiagnostics {
  overlap: number;
  kindPrior: number;
  certainty: number;
  recency: number;
  teachingValue: number;
  priority: number;
  density: number;
  structuralOverlap: number;
  structuralPublicSurface: number;
  structuralDependency: number;
  structuralSignalCount: number;
  sourceAffinity: number;
  changeAnchor: number;
  changeAnchorWeight: number;
  relatedTestBoost: number;
  sourcePenalty: number;
  genericRunnerPenalty: number;
  implementationFit: number;
  retrievalBoost: number;
  customBoost: number;
  recallOriginBoost: number;
  narrativePenalty: number;
  redundancy: number;
  penalty: number;
}

export interface SelectedChunk extends Chunk {
  origin: "memory" | "workspace";
  tokenCount: number;
  score: number;
  diagnostics: ChunkDiagnostics;
}

export interface SuppressedChunk {
  id: string;
  source: string;
  kind: ChunkKind;
  origin?: "memory" | "workspace";
  tokenCount?: number;
  reason: string;
  score: number;
  diagnostics?: ChunkDiagnostics;
}

export interface SelectionSummary {
  selectedCount: number;
  suppressedCount: number;
  selectedOrigins: Record<string, number>;
  suppressedOrigins: Record<string, number>;
  suppressionReasons: Record<string, number>;
}

export interface ScoringWeights {
  overlap?: number;
  kindPrior?: number;
  certainty?: number;
  recency?: number;
  teachingValue?: number;
  priority?: number;
  density?: number;
  structuralOverlap?: number;
  structuralPublicSurface?: number;
  structuralDependency?: number;
  sourceAffinity?: number;
  implementationFit?: number;
  retrievalBoost?: number;
  changeAnchor?: number;
  relatedTestBoost?: number;
  recallOriginBoost?: number;
  customBoost?: number;
  redundancyPenalty?: number;
  sourcePenalty?: number;
  narrativePenalty?: number;
  genericRunnerPenalty?: number;
}

export interface SelectionOptions {
  focus?: string;
  tokenBudget?: number;
  maxChunks?: number;
  minScore?: number;
  sentenceBudget?: number;
  changedFiles?: string[];
  recallReserveRatio?: number;
  scoringProfile?: string;
  scoringWeights?: ScoringWeights;
  customScorers?: Array<(input: {
    chunk: Chunk;
    focus: string;
    selectedChunks: Array<Chunk | SelectedChunk>;
    options: SelectionOptions;
  }) => number>;
  _cachedFocusTokens?: string[];
  _cachedChunkTokens?: string[];
  _cachedScoringWeights?: ScoringWeights;
}

export interface ContextSelectionResult {
  focus: string;
  tokenBudget: number;
  usedTokens: number;
  selected: SelectedChunk[];
  suppressed: SuppressedChunk[];
  summary: SelectionSummary;
}

export interface ScanStats {
  rootPath: string;
  discoveredFiles: number;
  includedFiles: number;
  ignoredFiles: number;
  truncatedFiles: number;
  redactedFiles: number;
  redactionCount: number;
  security: SecurityScanStats;
  kinds: Record<ChunkKind, number>;
}

export interface SecurityScanStats {
  ignoredSensitiveFiles: number;
  privateBlocks: number;
  inlineSecrets: number;
  tokenPatterns: number;
  jwtLike: number;
  connectionStrings: number;
}

export interface RuntimeMeta {
  generatedAt: string;
  cwd: string;
  durationMs: number;
  debug: boolean;
  scanStats: ScanStats | null;
}

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  fix?: string;
}

export interface DoctorSummary {
  pass: number;
  warn: number;
  fail: number;
}

export interface DoctorResult {
  cwd: string;
  summary: DoctorSummary;
  checks: DoctorCheck[];
}

export interface CliContractMeta {
  schemaVersion?: string;
  status?: "ok" | "error";
  degraded?: boolean;
  warnings?: string[];
  configPath?: string;
  configFound?: boolean;
  generatedAt?: string;
  cwd?: string;
  durationMs?: number;
  debug?: boolean;
  scanStats?: ScanStats | null;
}

export interface PacketChunk {
  id: string;
  source: string;
  kind: ChunkKind;
  score: number;
  content: string;
  memoryType?: string;
  origin?: "memory" | "workspace";
  tokenCount?: number;
  diagnostics?: ChunkDiagnostics;
}

export interface PacketSuppressedChunk {
  id: string;
  reason: string;
  score: number;
  source?: string;
  kind?: ChunkKind;
  origin?: "memory" | "workspace";
  tokenCount?: number;
  diagnostics?: ChunkDiagnostics;
}

export interface TeachingSections {
  codeFocus: PacketChunk | null;
  relatedTests: PacketChunk[];
  historicalMemory: PacketChunk[];
  supportingContext: PacketChunk[];
  flow: string[];
}

export interface LearningPacketDiagnostics {
  focus: string;
  tokenBudget: number;
  usedTokens: number;
  summary: SelectionSummary;
}

export interface LearningPacket {
  objective: string;
  task: string;
  changedFiles: string[];
  teachingChecklist: string[];
  teachingSections: TeachingSections;
  selectedContext: PacketChunk[];
  suppressedContext: PacketSuppressedChunk[];
  diagnostics: LearningPacketDiagnostics;
}

export interface MemoryRecallState {
  enabled: boolean;
  status: "disabled" | "skipped" | "recalled" | "empty" | "failed";
  degraded: boolean;
  reason: string;
  provider?: string;
  providerChain?: string[];
  fallbackProvider?: string;
  query: string;
  queriesTried: string[];
  matchedQueries: string[];
  project: string;
  recoveredChunks: number;
  recoveredMemoryIds: string[];
  firstMatchIndex: number;
  selectedChunks: number;
  suppressedChunks: number;
  error: string;
}

export interface TeachRecallResolution {
  chunks: Chunk[];
  memoryRecall: MemoryRecallState;
}

export interface TeachRecallQueryInput {
  task?: string;
  objective?: string;
  focus?: string;
  changedFiles?: string[];
  explicitQuery?: string;
  maxQueries?: number;
}

export interface MemorySearchOptions {
  project?: string;
  scope?: string;
  type?: string;
  limit?: number;
}

export interface MemorySaveInput {
  title: string;
  content: string;
  type?: string;
  project?: string;
  scope?: string;
  topic?: string;
  sourceKind?: string;
  protected?: boolean;
  reviewStatus?: string;
  signalScore?: number;
  duplicateScore?: number;
  durabilityScore?: number;
  healthScore?: number;
  reviewReasons?: string[];
  expiresAt?: string;
  supersedes?: string[];
}

export interface MemoryCloseInput {
  summary: string;
  learned?: string;
  next?: string;
  title?: string;
  project?: string;
  scope?: string;
  type?: string;
  sourceKind?: string;
  protected?: boolean;
  reviewStatus?: string;
  signalScore?: number;
  duplicateScore?: number;
  durabilityScore?: number;
  healthScore?: number;
  reviewReasons?: string[];
  expiresAt?: string;
  supersedes?: string[];
}

export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  type: string;
  project: string;
  scope: string;
  topic: string;
  createdAt: string;
  sourceKind?: string;
  protected?: boolean;
  reviewStatus?: string;
  signalScore?: number;
  duplicateScore?: number;
  durabilityScore?: number;
  healthScore?: number;
  reviewReasons?: string[];
  expiresAt?: string;
  supersedes?: string[];
}

export interface MemorySearchResult {
  entries: MemoryEntry[];
  stdout: string;
  provider: string;
  providerChain?: string[];
  fallbackProvider?: string;
  degraded?: boolean;
  warning?: string;
  error?: string;
  failureKind?: string;
  fixHint?: string;
}

export interface MemorySaveResult {
  id: string;
  stdout: string;
  provider: string;
  providerChain?: string[];
  fallbackProvider?: string;
  degraded?: boolean;
  warning?: string;
}

export interface MemoryHealthResult {
  healthy: boolean;
  provider: string;
  detail: string;
}

/**
 * Formal contract for all memory backends.
 * Implemented by: LocalProvider, ExternalBatteryProvider, ResilientProvider.
 */
export interface MemoryProvider {
  readonly name: string;

  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult>;
  save(input: MemorySaveInput): Promise<MemorySaveResult>;
  delete(id: string, project?: string): Promise<{ deleted: boolean; id: string }>;
  list(options?: { project?: string; limit?: number }): Promise<MemoryEntry[]>;
  health(): Promise<MemoryHealthResult>;

  /** Legacy compatibility — delegates to search/list internally */
  recallContext(project?: string): Promise<Record<string, unknown> & { stdout: string; provider: string }>;
  searchMemories(query: string, options?: MemorySearchOptions): Promise<Record<string, unknown> & { stdout: string; provider: string }>;
  saveMemory(input: MemorySaveInput): Promise<Record<string, unknown> & { provider: string }>;
  closeSession(input: MemoryCloseInput): Promise<Record<string, unknown> & { provider: string }>;
}

/** @deprecated Use MemorySearchOptions instead */
export interface EngramSearchOptions {
  project?: string;
  scope?: string;
  type?: string;
  limit?: number;
}

export interface EngramSearchResult {
  stdout: string;
  degraded?: boolean;
  warning?: string;
  provider?: string;
  failureKind?: string;
  fixHint?: string;
}

export interface EngramResolvedConfig {
  cwd: string;
  binaryPath: string;
  dataDir: string;
}

export interface EngramCommandResult extends EngramResolvedConfig {
  args: string[];
  stdout: string;
  stderr: string;
}

// ── Guard Layer Contracts ─────────────────────────────────────────────

/**
 * Verdict from a single guard rule evaluation.
 * - "allow": query passes this rule
 * - "block": query is rejected by this rule
 * - "warn": query is allowed but flagged for review
 */
export type GuardVerdict = "allow" | "block" | "warn";

/**
 * Result of evaluating a single guard rule against a query.
 */
export interface GuardRuleResult {
  rule: string;
  verdict: GuardVerdict;
  reason: string;
  /** Confidence in the verdict (0-1). Higher = more certain. */
  confidence: number;
}

/**
 * Aggregate result from the full guard pipeline.
 */
export interface GuardEvaluation {
  /** Whether the query was blocked by any rule */
  blocked: boolean;
  /** Whether any rule issued a warning */
  warned: boolean;
  /** The rule that caused the block (if any) */
  blockedBy: string;
  /** Human-readable response for blocked queries */
  userMessage: string;
  /** All individual rule results */
  results: GuardRuleResult[];
  /** Evaluation time in milliseconds */
  durationMs: number;
}

/**
 * Input context for guard evaluation.
 */
export interface GuardInput {
  query: string;
  project: string;
  command: string;
  /** Additional context like user role, session ID, etc. */
  metadata?: Record<string, string>;
}

/**
 * Configuration for a single guard rule in the project config.
 */
export interface GuardRuleConfig {
  /** Rule type: "input-validation", "domain-scope", "jurisdiction", "rate-limit", "keyword-block" */
  type: string;
  /** Whether this rule is active */
  enabled: boolean;
  /** Rule-specific parameters */
  params: Record<string, unknown>;
}

/**
 * Full guard configuration for a project.
 */
export interface GuardConfig {
  enabled: boolean;
  /** Rules are evaluated in order; first block wins */
  rules: GuardRuleConfig[];
  /** Message shown when a query is blocked (default provided) */
  defaultBlockMessage: string;
}

// ── API Layer Contracts ──────────────────────────────────────────────

export interface ApiRequest {
  method: string;
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  query: Record<string, string>;
}

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface ApiRoute {
  method: "GET" | "POST";
  path: string;
  handler: (req: ApiRequest) => Promise<ApiResponse>;
}

export interface ApiServerConfig {
  port: number;
  host: string;
  corsOrigin: string;
  guardEnabled: boolean;
}

// ── Eval Contracts (S5) ──────────────────────────────────────────────

export type EvalMetricName = "accuracy" | "relevance" | "consistency";

export interface EvalCase {
  id: string;
  query: string;
  expectedAnswer: string;
  expectedChunkIds?: string[];
  tags?: string[];
}

export interface EvalSuite {
  name: string;
  project: string;
  cases: EvalCase[];
}

export interface EvalCaseResult {
  caseId: string;
  query: string;
  passed: boolean;
  scores: Record<EvalMetricName, number>;
  actualAnswer: string;
  actualChunkIds: string[];
  durationMs: number;
}

export interface EvalReport {
  suite: string;
  project: string;
  runAt: string;
  durationMs: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  averageScores: Record<EvalMetricName, number>;
  results: EvalCaseResult[];
  ciGate: {
    passed: boolean;
    minimumScore: number;
    actualScore: number;
  };
}

// ── Observability Contracts (S6) ─────────────────────────────────────

export interface RequestTrace {
  traceId: string;
  command: string;
  startedAt: string;
  durationMs: number;
  layers: TraceLayer[];
  outcome: "success" | "degraded" | "blocked" | "error";
  error?: string;
}

export interface TraceLayer {
  name: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface MetricsSnapshot {
  timestamp: string;
  uptime: number;
  requests: {
    total: number;
    perMinute: number;
    byCommand: Record<string, number>;
  };
  latency: {
    p50: number;
    p95: number;
    p99: number;
    average: number;
  };
  recall: {
    hitRate: number;
    avgChunksReturned: number;
  };
  errors: {
    total: number;
    rate: number;
    byLayer: Record<string, number>;
  };
  guard: {
    blocked: number;
    blockRate: number;
  };
}

export interface AlertRule {
  name: string;
  condition: "error_rate_above" | "latency_above" | "block_rate_above";
  threshold: number;
  webhookUrl?: string;
}

// ── Orchestration Contracts (S7) ─────────────────────────────────────

export type WorkflowStepType = "ingest" | "recall" | "guard" | "teach" | "remember" | "action" | "respond";

export interface WorkflowStepDef {
  name: string;
  type: WorkflowStepType;
  params: Record<string, unknown>;
  /** If set, skip this step when condition returns false */
  condition?: string;
  /** Continue workflow even if this step fails */
  optional?: boolean;
}

export interface WorkflowDef {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStepDef[];
}

export interface WorkflowStepResult {
  stepName: string;
  type: WorkflowStepType;
  status: "success" | "skipped" | "error";
  durationMs: number;
  output: Record<string, unknown>;
  error?: string;
}

export interface WorkflowResult {
  workflowId: string;
  workflowName: string;
  status: "completed" | "failed" | "partial";
  startedAt: string;
  durationMs: number;
  steps: WorkflowStepResult[];
  finalOutput: Record<string, unknown>;
}

export interface ConversationTurn {
  role: "user" | "system";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationSession {
  sessionId: string;
  project: string;
  turns: ConversationTurn[];
  createdAt: string;
  updatedAt: string;
  context: Record<string, unknown>;
}

export type ActionType = "save_to_memory" | "webhook" | "log" | "notify";

export interface ActionDef {
  type: ActionType;
  params: Record<string, unknown>;
}

export interface ActionResult {
  type: ActionType;
  status: "success" | "error";
  durationMs: number;
  output?: Record<string, unknown>;
  error?: string;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

// ── Versioning Contracts (S8) ────────────────────────────────────────

export interface PromptVersion {
  id: string;
  name: string;
  version: number;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface PromptVersionHistory {
  name: string;
  currentVersion: number;
  versions: PromptVersion[];
}

export interface ContextSnapshot {
  snapshotId: string;
  project: string;
  command: string;
  query: string;
  timestamp: string;
  selectedChunkIds: string[];
  guardResult?: { blocked: boolean; blockedBy: string };
  evalScore?: number;
  promptVersionId?: string;
  modelConfig?: ModelVersionConfig;
}

export interface ModelVersionConfig {
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  version: number;
  activeSince: string;
}

export interface RollbackCheck {
  shouldRollback: boolean;
  reason: string;
  previousScore: number;
  currentScore: number;
  dropPercent: number;
  threshold: number;
  rolledBackTo?: number;
}

// ── Processing Contracts ─────────────────────────────────────────────

export interface ChunkOptions {
  maxChunkChars?: number;
  minChunkChars?: number;
  overlap?: number;
  strategy?: "section" | "paragraph" | "semantic" | "auto";
}

export interface SmartChunk {
  id: string;
  content: string;
  startLine: number;
  endLine: number;
  section?: string;
  strategy?: "section" | "paragraph" | "semantic";
}

export interface DateRef {
  raw: string;
  normalized: string;
}

export interface ArticleRef {
  raw: string;
  number: string;
  law?: string;
}

export interface EntityPattern {
  name: string;
  pattern: string;
  flags?: string;
}

export interface EntityExtractorOptions {
  customPatterns?: EntityPattern[];
}

export interface ExtractedEntities {
  people: string[];
  organizations: string[];
  dates: DateRef[];
  articles: ArticleRef[];
  locations: string[];
  emails: string[];
  urls: string[];
  custom: Record<string, string[]>;
}

export interface ChunkTags {
  domain: string;
  topics: string[];
  language: string;
  complexity: "low" | "medium" | "high";
  hasCode: boolean;
  hasLegalRef: boolean;
  sentiment: "neutral" | "positive" | "negative";
  wordCount: number;
  readingLevel: "basic" | "intermediate" | "advanced";
}

export interface TaggingContext {
  sourceType?: string;
}

export interface Section {
  heading: string;
  level: number;
  content: string;
  startLine: number;
  endLine: number;
}

export interface TableRef {
  startLine: number;
  endLine: number;
  headers: string[];
  rowCount: number;
}

export interface CodeBlockRef {
  startLine: number;
  endLine: number;
  language: string;
  content: string;
}

export interface ListRef {
  startLine: number;
  endLine: number;
  items: string[];
  ordered: boolean;
}

export interface DocumentStructure {
  sections: Section[];
  tables: TableRef[];
  codeBlocks: CodeBlockRef[];
  lists: ListRef[];
  metadata: Record<string, string>;
}

export interface SecretRedactionBreakdown {
  privateBlocks: number;
  inlineSecrets: number;
  tokenPatterns: number;
  jwtLike: number;
  connectionStrings: number;
}

export interface SecretRedactionResult {
  content: string;
  redacted: boolean;
  redactionCount: number;
  breakdown: SecretRedactionBreakdown;
}

// ── Storage Contracts (NEXUS:2) ──────────────────────────────────────

export interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

export interface ChunkRepositoryStats {
  totalChunks: number;
  byKind: Record<string, number>;
  sizeBytes: number;
}

export interface ChunkRepository {
  save(projectId: string, chunks: Chunk[]): Promise<{ saved: number }>;
  load(projectId: string): Promise<Chunk[]>;
  remove(projectId: string, chunkIds: string[]): Promise<{ removed: number }>;
  search(projectId: string, query: string, limit?: number): Promise<ScoredChunk[]>;
  stats(projectId: string): Promise<ChunkRepositoryStats>;
  listProjects(): Promise<string[]>;
  clear(projectId: string): Promise<void>;
}

export interface BM25Result {
  id: string;
  score: number;
}

export interface BM25Index {
  addDocument(id: string, text: string): void;
  addDocuments(docs: Array<{ id: string; text: string }>): void;
  removeDocument(id: string): void;
  search(query: string, limit?: number): BM25Result[];
  clear(): void;
  size(): number;
}

export interface HybridRetrieverOptions {
  bm25Weight?: number;
  tfidfWeight?: number;
  signalWeight?: number;
}

export interface HybridResultBreakdown {
  bm25: number;
  tfidf: number;
  signal: number;
}

export interface HybridResult {
  chunk: Chunk;
  score: number;
  breakdown: HybridResultBreakdown;
}

export interface HybridRetriever {
  index(chunks: Chunk[]): void;
  search(query: string, options?: {
    limit?: number;
    minScore?: number;
    kindFilter?: ChunkKind[];
  }): HybridResult[];
  size(): number;
}

// ── Code Gate Contracts (NEXUS:4 GUARD) ──────────────────────────────

/** Status of a Code Gate run */
export type CodeGateStatus = "pass" | "fail" | "skipped" | "degraded";

/** A single structured error from a gate tool */
export interface CodeGateError {
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
  severity: "error" | "warning";
  tool: "lint" | "typecheck" | "build" | "test";
}

/** Result of running one Code Gate tool */
export interface CodeGateToolResult {
  tool: "lint" | "typecheck" | "build" | "test";
  status: CodeGateStatus;
  errors: CodeGateError[];
  durationMs: number;
  raw?: string;
}

/** Aggregate result of the full Code Gate */
export interface CodeGateResult {
  status: CodeGateStatus;
  tools: CodeGateToolResult[];
  errorCount: number;
  warningCount: number;
  durationMs: number;
  passed: boolean;
}

// ── Axiom Memory Contracts (NEXUS:2 / NEXUS:9) ───────────────────────

export type AxiomType =
  | "code-axiom"
  | "library-gotcha"
  | "security-rule"
  | "testing-pattern"
  | "api-contract";

/** A stored axiom — reusable knowledge for codegen */
export interface Axiom {
  id: string;
  type: AxiomType;
  title: string;
  body: string;
  /** Language scope: "typescript", "python", "*" */
  language: string;
  /** Path prefix scope: "src/auth", "*" */
  pathScope: string;
  /** Framework scope: "express", "react", "*" */
  framework: string;
  /** Version constraint: ">=18.0.0", "*" */
  version?: string;
  createdAt: string;
  expiresAt?: string;
  tags: string[];
}

// ── Architecture Gate Contracts (NEXUS:4 / NEXUS:10) ─────────────────

/** A declared architecture boundary rule */
export interface ArchitectureRule {
  id: string;
  description: string;
  type: "forbidden-import" | "layer-crossing" | "allowed-boundary";
  from?: string;
  to?: string;
  pattern?: string;
}

/** Result of an architecture gate check */
export interface ArchitectureViolation {
  rule: string;
  file: string;
  line?: number;
  importPath?: string;
  description: string;
}

export interface ArchitectureGateResult {
  passed: boolean;
  violations: ArchitectureViolation[];
  checkedFiles: number;
  durationMs: number;
}
