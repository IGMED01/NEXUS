export type ChunkKind = "code" | "test" | "spec" | "memory" | "doc" | "chat" | "log";

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
  retrievalScore?: number;
  vectorScore?: number;
  processing?: Record<string, unknown>;
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
  origin: "engram" | "workspace";
  tokenCount: number;
  score: number;
  diagnostics: ChunkDiagnostics;
}

export interface SuppressedChunk {
  id: string;
  source: string;
  kind: ChunkKind;
  origin?: "engram" | "workspace";
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
  origin?: "engram" | "workspace";
  tokenCount?: number;
  diagnostics?: ChunkDiagnostics;
}

export interface PacketSuppressedChunk {
  id: string;
  reason: string;
  score: number;
  source?: string;
  kind?: ChunkKind;
  origin?: "engram" | "workspace";
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
