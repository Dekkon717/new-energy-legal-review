export type RelationEvidence = {
  label: string;
  state: 'found' | 'missing' | 'negated' | 'conditional';
  examples: string[];
};

export type RelationFinding = {
  id: string;
  dimension: string;
  title: string;
  severity: 'medium' | 'low';
  priority: 'P1' | 'P2';
  confidence: '高' | '中';
  evidenceCertainty: '充分' | '部分';
  materialityScore: number;
  message: string;
  recommendation: string;
  clause: string;
  evidence: RelationEvidence[];
  relationPath: string[];
  caseTags: string[];
  humanReview: string[];
};

export type PerformanceRelationGraph = {
  version: string;
  stages: { id: string; label: string }[];
  nodes: { id: string; stage: string; label: string; clauseIndex: number; clause: string; matchedTerms: string[] }[];
  edges: { from: string; to: string; label: string; status: 'identified' | 'protected' | 'review' }[];
  findings: RelationFinding[];
  summary: { nodeCount: number; edgeCount: number; findingCount: number; stageCounts: Record<string, number> };
  diagnostics: Record<string, boolean | number>;
};

export function buildPerformanceRelationGraph(text?: string): PerformanceRelationGraph;
