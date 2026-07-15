export interface Observation {
  id: number;
  memory_session_id: string;
  project: string;
  merged_into_project?: string | null;
  platform_source: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  text: string | null;
  facts: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  prompt_number: number | null;
  created_at: string;
  created_at_epoch: number;
}

export interface Summary {
  id: number;
  session_id: string;
  project: string;
  platform_source: string;
  request?: string;
  investigated?: string;
  learned?: string;
  completed?: string;
  next_steps?: string;
  created_at_epoch: number;
}

export interface UserPrompt {
  id: number;
  content_session_id: string;
  project: string;
  platform_source: string;
  prompt_number: number;
  prompt_text: string;
  created_at_epoch: number;
}

export type FeedItem =
  | (Observation & { itemType: 'observation' })
  | (Summary & { itemType: 'summary' })
  | (UserPrompt & { itemType: 'prompt' });

export interface StreamEvent {
  type: 'initial_load' | 'new_observation' | 'new_summary' | 'new_prompt' | 'processing_status';
  observations?: Observation[];
  summaries?: Summary[];
  prompts?: UserPrompt[];
  projects?: string[];
  observation?: Observation;
  summary?: Summary;
  prompt?: UserPrompt;
  isProcessing?: boolean;
  queueDepth?: number;
}

export interface ProjectCatalog {
  projects: string[];
  sources: string[];
  projectsBySource: Record<string, string[]>;
}

export interface Settings {
  CLAUDE_MEM_MODEL: string;
  CLAUDE_MEM_CONTEXT_OBSERVATIONS: string;
  CLAUDE_MEM_WORKER_PORT: string;
  CLAUDE_MEM_WORKER_HOST: string;

  CLAUDE_MEM_PROVIDER?: string;  
  CLAUDE_MEM_GEMINI_MODEL?: string;  
  CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED?: string;  
  CLAUDE_MEM_OPENROUTER_MODEL?: string;
  CLAUDE_MEM_OPENROUTER_SITE_URL?: string;
  CLAUDE_MEM_OPENROUTER_APP_NAME?: string;

  CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS?: string;
  CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS?: string;
  CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT?: string;
  CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT?: string;

  CLAUDE_MEM_CONTEXT_FULL_COUNT?: string;
  CLAUDE_MEM_CONTEXT_FULL_FIELD?: string;
  CLAUDE_MEM_CONTEXT_SESSION_COUNT?: string;

  CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY?: string;
  CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE?: string;

  providerConfig?: ProviderConfig;
  secretStatus?: Record<string, boolean>;
}

export type ProviderMode = 'local' | 'cc-switch-auto' | 'direct';
export type ProviderProtocol = 'anthropic' | 'openai-compatible';
export type ProjectClassification = 'public' | 'internal' | 'confidential';

export interface ProviderProfile {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  model: string;
  modelPath?: string;
  secretRef?: string;
  preset?: string;
  enabled: boolean;
}

export interface ProviderConfig {
  providerConfigVersion: 1;
  providerMode: ProviderMode;
  activeProviderProfileId: string | null;
  legacyProvider: 'claude' | 'gemini' | 'openrouter';
  ccSwitch: {
    explicitUrl: string;
    modelPolicy: 'summary-role' | 'main-role' | 'fixed-alias' | 'follow-session';
    fixedModel: string;
    advancedPortDiscovery: boolean;
    candidatePorts: number[];
  };
  providerProfiles: ProviderProfile[];
  privacy: {
    localOnly: boolean;
    defaultClassification: ProjectClassification;
    projects: Record<string, ProjectClassification>;
  };
}

export interface ProviderStatus {
  status: 'healthy' | 'blocked' | 'unavailable';
  mode: ProviderMode;
  providerId?: string;
  profileId?: string;
  code?: string;
  ccSwitch?: { source: string; version?: string; port: number };
}

export interface ProviderImportPreview {
  schemaVersion: 13;
  sourceKind: 'sql-export' | 'sqlite';
  profiles: Array<{
    sourceId: string;
    name: string;
    protocol: ProviderProtocol;
    baseUrl: string;
    model: string;
    secretAvailable: boolean;
  }>;
}

export interface DoctorCheck {
  id: 'worker' | 'cc-switch' | 'protocol' | 'cloud-sync' | 'telemetry' | 'secret-store' | 'sqlite' | 'chroma' | 'egress';
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
}
