'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from 'react';
import riskPolicyData from '../public/data/risk_policy.json';
import sourceValidationData from '../public/data/source_validation.json';
import { buildPerformanceRelationGraph } from '../lib/performance-relation-engine.mjs';

type RiskCategory = '法律红线' | '履约风险' | '完善建议';
type PerformanceImpact = '直接' | '间接' | '有限';
type RiskPolicy = {
  version: string;
  label: string;
  legal_redline_dimensions: string[];
  direct_performance_dimensions: string[];
  low_impact_dimensions: string[];
  explicit_violation_terms: string[];
  binding_source_types: string[];
  broad_article_markers: string[];
  scenario_gates: { id: string; rule_terms: string[]; required_any: string[]; label: string }[];
};

const RISK_POLICY = riskPolicyData as RiskPolicy;
const SOURCE_VALIDATION = sourceValidationData as {
  default_by_source_type: Record<string, { binding_force: string; validity_status: string; requires_exact_provision: boolean; may_support_legal_redline: boolean }>;
  overrides: { source_id: string; application_scope?: string; note?: string }[];
};

type Rule = {
  id: string;
  scenario: string;
  dimension: string;
  title: string;
  severity: string;
  apply_mode: string;
  trigger_terms?: string[];
  required_groups?: string[][];
  missing_message: string;
  recommendation: string;
  legal_basis?: { source_id: string; articles: string[] }[];
  case_tags?: string[];
  human_review?: string[];
};

type CompactRuleExpansion = {
  id: string;
  scenario: string;
  dimension: string;
  title: string;
  severity: string;
  apply_mode?: string;
  trigger_terms?: string[];
  required_groups?: string[][];
  missing_message?: string;
  recommendation: string;
  legal_basis?: { source_id: string; articles: string[] }[];
  source_id?: string;
  articles?: string[];
  case_tags?: string[];
  human_review?: string[];
};

function normaliseRuleExpansions(data: { rules?: CompactRuleExpansion[] }): Rule[] {
  return (data.rules || []).map((rule) => ({
    ...rule,
    apply_mode: rule.apply_mode || 'if_triggered',
    missing_message: rule.missing_message || `合同涉及“${rule.dimension}”风险，但未完整呈现可执行的主体、条件、证据或责任安排。`,
    legal_basis: rule.legal_basis || (rule.source_id ? [{ source_id: rule.source_id, articles: rule.articles || [] }] : []),
    human_review: rule.human_review || [`人工核对${rule.dimension}的业务事实、附件和最新官方要求`],
  }));
}

type Source = {
  id: string;
  title: string;
  source_type?: string;
  issuing_body?: string;
  issuer?: string;
  official_url: string;
  effective_status?: string;
  status?: string;
  effective_date?: string;
  provisions?: { article: string; topic: string }[];
  verification_note?: string;
  cross_check_url?: string;
};

type CaseRecord = {
  id: string;
  scenario?: string;
  title: string;
  case_type?: string;
  authority_level?: string;
  court?: string;
  case_no?: string;
  decision_date?: string;
  official_url: string;
  summary: string;
  holding_or_rule?: string;
  keywords?: string[];
  retrieval_tags?: string[];
  retrieval_only?: boolean;
  full_text_verified?: boolean;
};

type CaseCatalogCategory = {
  scenario: string;
  label: string;
  reference_scale_label?: string;
  verified_reference_count?: number;
  public_index_count?: number;
  retrieval_material_count?: number;
  collection_status: string;
  query_templates: string[];
  official_sources: { label: string; url: string }[];
};

type CaseCatalog = {
  version: string;
  updated_at: string;
  policy: string;
  reference_scale_label?: string;
  categories: CaseCatalogCategory[];
  official_index_sources: { label: string; url: string }[];
};

type Finding = {
  id: string;
  scenarios: string[];
  dimension: string;
  title: string;
  severity: string;
  disposition: 'core' | 'confirm' | 'notice';
  confidence: '高' | '中' | '低';
  riskCategory: RiskCategory;
  performanceImpact: PerformanceImpact;
  riskReason?: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  evidenceCertainty?: '充分' | '部分' | '不足';
  scenarioRelevance?: '主场景' | '次场景' | '跨条款';
  legalBasisStatus?: '明确' | '待核验' | '无直接法源';
  basisNote?: string;
  materialityScore: number;
  ruleIds: string[];
  message: string;
  recommendation: string;
  basis: { source_id: string; articles: string[] }[];
  humanReview: string[];
  clause: string;
  caseTags: string[];
  analysisType: 'rule' | 'conflict' | 'relation';
  relationPath?: string[];
  evidence: { label: string; state: 'found' | 'missing' | 'negated' | 'conditional'; examples: string[] }[];
  elements: { label: string; state: 'found' | 'missing' | 'uncertain'; example: string }[];
  counterProposal: string;
};

type SimilarCase = CaseRecord & { score: number; matchReasons: string[] };

type PartyPerspective = '采购方' | '供应商' | '发包方' | '承包方' | '项目公司';
type ComparisonResult = {
  added: string[];
  removed: string[];
  changed: { before: string; after: string }[];
};

type RiskFilter = 'all' | 'high' | 'medium' | 'low';
type ReviewScope = 'all' | 'selected';
type ScoreBreakdown = {
  corePenalty: number;
  confirmPenalty: number;
  noticePenalty: number;
  legalRedlinePenalty: number;
  performancePenalty: number;
  completenessPenalty: number;
  duplicateReduction: number;
  lowConfidenceReduction: number;
  uncertaintyAdjustment: number;
  protectionCredit: number;
  protectedItems: string[];
};

const SAMPLE_CONTRACT = `新能源储能设备采购合同（示例）

第一条 甲方向乙方采购储能设备一套，项目现场交货。

第二条 合同总价为人民币 1,000 万元，合同生效后支付 30% 预付款，设备到货后支付 60%，余款在验收后支付。

第三条 乙方负责运输、安装指导、调试和售后服务。设备应符合国家及行业标准。

第四条 设备质保期为两年。发生质量问题时，乙方负责维修。

第五条 因不可抗力导致不能履行的，双方协商解决。

第六条 未尽事宜由双方另行协商，争议提交甲方所在地人民法院。
`;

const severityLabel: Record<string, string> = { high: '严重', medium_high: '中', medium: '中', low: '低' };
const severityClass: Record<string, string> = { high: 'risk-high', medium_high: 'risk-medium-high', medium: 'risk-medium', low: 'risk-low' };
const dispositionLabel: Record<Finding['disposition'], string> = { core: '法律红线', confirm: '待确认', notice: '优化提示' };
const dispositionClass: Record<Finding['disposition'], string> = { core: 'disposition-core', confirm: 'disposition-confirm', notice: 'disposition-notice' };
const analysisTypeLabel: Record<Finding['analysisType'], string> = { rule: '规则审查', conflict: '条款冲突', relation: '履约关系' };
function normalise(value: string) {
  return value.replace(/\s+/g, '').toLowerCase();
}

function includesAny(text: string, terms: string[] = []) {
  const value = normalise(text);
  return terms.some((term) => value.includes(normalise(term)));
}

const NEGATIVE_CONTEXTS = ['不提供', '未提供', '不提交', '未提交', '不约定', '未约定', '未另行约定', '未作约定', '尚未约定', '不设置', '未设置', '不承担', '未承担', '不负责', '未负责', '不办理', '不执行', '不符合', '不报告', '不召回', '不以', '待确认', '待项目', '待后续', '不需要', '无需', '不核验', '未核验', '不审查', '未审查', '未明确', '不明确', '未规定', '不规定', '没有', '缺少', '未完整', '自行承担', '自行处理', '另行协商', '后续确定', '另行确定', '尚未', '暂不明确', '不作约定'];
const CONDITIONAL_CONTEXTS = ['除非', '但在', '但如', '仅在', '仅当', '以…为前提', '以...为前提', '以…为条件', '以...为条件', '经双方确认后', '经甲方书面同意后', '经乙方书面同意后', '视情况', '原则上'];
const DEFERRED_REFERENCE_CONTEXTS = ['详见附件', '见附件', '以附件为准', '详见技术协议', '以技术协议为准', '另行提供', '另行签署', '另行确认', '另附', '后续确定', '另行协商'];
const TRIGGER_ALIASES: Record<string, string[]> = {
  '项目开发': ['联合开发', '开发合作', '项目合作'],
  '项目权利': ['项目权益', '开发权', '资源权'],
  '设计采购施工': ['EPC总承包', '工程总承包'],
  '远程运维': ['远程访问', '远程控制'],
  '交易数据': ['交易记录', '电力交易数据'],
  '绿色电力交易': ['绿电交易'],
  '市场准入': ['市场注册', '交易资格', '市场主体', '业务许可证'],
  '仲裁机构': ['仲裁委员会'],
  '管辖': ['仲裁地点', '管辖法院'],
  '适用法律': ['中华人民共和国法律', '中国法律'],
  '验收标准': ['质量标准', '技术条件', '验收依据'],
  '性能测试': ['性能指标', '性能保证'],
  '事故报告': ['事故', '事故调查', '热失控'],
  '账号权限': ['账号', '访问权限', '权限'],
  '故障停机': ['停机', '联动停机'],
  '运维范围': ['运维服务', '运行值守'],
  '调价公式': ['价格调整', '调价'],
  '资质': ['资质证书', '许可资质'],
};

function triggerTermsFor(term: string) {
  return [term, ...(TRIGGER_ALIASES[term] || [])];
}

function includesTrigger(text: string, terms: string[] = []) {
  return terms.some((term) => includesAny(text, triggerTermsFor(term)));
}

function clauseHasNegativeContext(clause: string, term: string) {
  const value = normalise(clause);
  const target = normalise(term);
  let position = value.indexOf(target);
  while (position >= 0) {
    const windowStart = Math.max(0, position - 20);
    const prefix = value.slice(windowStart, position);
    if (NEGATIVE_CONTEXTS.some((phrase) => prefix.includes(normalise(phrase)))) return true;
    position = value.indexOf(target, position + target.length);
  }
  return NEGATIVE_CONTEXTS.some((phrase) => value.includes(normalise(phrase)) && value.includes(target));
}

function contextStateForClause(clause: string, term: string) {
  const value = normalise(clause);
  const target = normalise(term);
  if (!value.includes(target)) return 'missing' as const;
  const segments = clause.split(/[。！？；;]+/u).map((part) => normalise(part)).filter(Boolean);
  let conditional = false;
  let negated = false;
  for (const segment of segments) {
    if (!segment.includes(target)) continue;
    let position = segment.indexOf(target);
    while (position >= 0) {
      const prefix = segment.slice(Math.max(0, position - 16), position);
      const suffix = segment.slice(position, Math.min(segment.length, position + target.length + 32));
      if (NEGATIVE_CONTEXTS.some((phrase) => prefix.includes(normalise(phrase)) || suffix.startsWith(normalise(phrase)))) negated = true;
      if (CONDITIONAL_CONTEXTS.some((phrase) => prefix.includes(normalise(phrase)) || suffix.startsWith(normalise(phrase)))) conditional = true;
      position = segment.indexOf(target, position + target.length);
    }
  }
  if (negated) return 'negated' as const;
  if (conditional) return 'conditional' as const;
  return 'found' as const;
}

function evidenceForGroup(text: string, group: string[]) {
  const clauses = splitClauses(text);
  const examples: string[] = [];
  let found = false;
  let negated = false;
  let conditional = false;
  for (const clause of clauses) {
    const matchedTerms = [...new Set(group.flatMap((term) => triggerTermsFor(term)))].filter((term) => includesAny(clause, [term]));
    if (matchedTerms.length === 0) continue;
    examples.push(clause);
    const states = matchedTerms.map((term) => contextStateForClause(clause, term));
    if (states.includes('negated')) negated = true;
    else if (states.includes('conditional')) conditional = true;
    else if (states.includes('found')) found = true;
  }
  return { label: group.join(' / '), state: negated ? 'negated' : conditional && !found ? 'conditional' : found ? 'found' : 'missing', examples: examples.slice(0, 2) } as const;
}

function splitClauses(text: string) {
  return text.split(/\n\s*\n|(?=第[一二三四五六七八九十百零]+条)|(?=\d{1,3}[、.])/).map((part) => part.trim()).filter((part) => part.length > 10);
}

function findBestClause(text: string, rule: Rule) {
  const clauses = splitClauses(text);
  if (clauses.length === 0) return '未识别到可定位条款';
  const triggerTerms = (rule.trigger_terms || []).flatMap((term) => triggerTermsFor(term));
  const titleTerms = [rule.dimension, rule.title].filter(Boolean);
  const ranked = clauses.map((clause, index) => {
    const triggerHits = triggerTerms.filter((term) => includesAny(clause, [term])).length;
    const evidenceHits = (rule.required_groups || []).reduce((count, group) => {
      const groupHits = group.flatMap((term) => triggerTermsFor(term)).some((term) => includesAny(clause, [term]));
      return count + (groupHits ? 1 : 0);
    }, 0);
    const titleHits = titleTerms.filter((term) => includesAny(clause, [term])).length;
    return { clause, index, score: triggerHits * 5 + evidenceHits * 3 + titleHits * 2 };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked[0]?.clause || clauses[0];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function hasDeferredReference(text: string, clause: string) {
  const value = normalise(clause);
  const explicitFuture = DEFERRED_REFERENCE_CONTEXTS.some((phrase) => ['另行提供', '另行签署', '另行确认', '后续确定', '另行协商'].includes(phrase) && value.includes(normalise(phrase)));
  if (explicitFuture) return true;
  const refersToAttachment = ['详见附件', '见附件', '以附件为准', '详见技术协议', '以技术协议为准'].some((phrase) => value.includes(normalise(phrase)));
  if (!refersToAttachment) return false;
  return !/(附件[一二三四五六七八九十\d]+\s*[：:]|附录\s*[一二三四五六七八九十\d]+\s*[：:]|技术协议\s*[：:])/u.test(text);
}

function extractClauseElements(clause: string) {
  const elements = [
    { label: '主体', terms: ['甲方', '乙方', '买方', '卖方', '采购方', '供应商', '发包人', '承包人', '项目公司'] },
    { label: '义务/标的', terms: ['采购', '供货', '交付', '负责', '提供', '安装', '调试', '验收', '运维', '并网'] },
    { label: '期限/条件', terms: ['期限', '日期', '日内', '之前', '之后', '条件', '节点', '标准', '附件'] },
    { label: '责任/救济', terms: ['违约', '赔偿', '违约金', '解除', '终止', '质保', '保修', '整改', '更换', '复验'] },
  ];
  return elements.map((element) => {
    const example = element.terms.find((term) => includesAny(clause, [term]));
    return { label: element.label, state: example ? 'found' as const : 'missing' as const, example: example ? `出现“${example}”表述` : '未识别到相应要素' };
  });
}

function generateCounterProposal(finding: Pick<Finding, 'title' | 'recommendation' | 'severity'>, perspective: PartyPerspective) {
  const counterparty = perspective === '采购方' || perspective === '项目公司' ? '对方供应商/承包方' : '对方采购方/发包方';
  const remedy = finding.severity === 'high' ? '并将未满足条件与暂停付款、拒绝验收、整改、更换或解除权衔接' : '并明确验证资料、通知期限和未达标后的补救方式';
  return `建议以${perspective}立场向${counterparty}提出：${finding.recommendation}；${remedy}。`;
}

function includesPolicyDimension(rule: Rule, dimensions: string[]) {
  const value = normalise(`${rule.dimension}${rule.title}`);
  return dimensions.some((term) => value.includes(normalise(term)));
}

function ruleApplicability(rule: Rule, contractText: string, policy: RiskPolicy = RISK_POLICY) {
  const ruleText = normalise(`${rule.dimension}${rule.title}`);
  const gate = policy.scenario_gates.find((item) => item.rule_terms.some((term) => ruleText.includes(normalise(term))));
  if (!gate) return { applicable: true, label: '' };
  const applicable = gate.required_any.some((term) => normalise(contractText).includes(normalise(term)));
  return { applicable, label: gate.label };
}

const SCENARIO_ANCHORS: Record<string, { strong: string[]; support: string[] }> = {
  storage_procurement: { strong: ['储能设备', '储能系统', '电化学储能'], support: ['储能', '电池系统', 'PCS', 'BMS', 'EMS', '容量', '循环寿命', '性能测试'] },
  epc: { strong: ['EPC', '工程总承包', '施工总承包', '竣工验收'], support: ['施工', '并网', '竣工', '开工', '工程量'] },
  supply_chain: { strong: ['供应链', '采购订单', '安全库存', '寄售库存'], support: ['供应商', '排产', '锁量', '交期', '替代料'] },
  pv: { strong: ['光伏电站', '分布式光伏', '光伏组件', '逆变器'], support: ['光伏', '屋顶', '发电量', '并网', '上网电量'] },
  lithium_battery: { strong: ['锂电池', '正极材料', '负极材料', '电解液', '隔膜', '电芯'], support: ['容量保持率', '循环寿命', '一致性', '黑粉'] },
  project_development: { strong: ['项目开发', '项目公司', '项目备案', '资源权利'], support: ['股权', '备案', '投资', '用地', '开发权'] },
  power_market: { strong: ['电力交易', '绿电交易', '绿证交易', '辅助服务'], support: ['绿电', '绿证', '偏差', '结算', '调度'] },
  operations_compliance: { strong: ['运营维护', '运维服务', '远程监控', '安全合规'], support: ['运维', '巡检', '消防', '事故报告', '安全管理'] },
};
const GENERIC_TRIGGER_TERMS = new Set(['项目', '合同', '设备', '责任', '质量', '安全', '数据', '服务', '价格', '付款', '交付', '验收', '变更', '资料', '期限', '风险', '义务', '协议', '标准']);

function scenarioRouteForContract(contractText: string) {
  const value = normalise(contractText);
  const scored = Object.entries(SCENARIO_ANCHORS).map(([scenario, anchors]) => {
    const strongHits = anchors.strong.filter((anchor) => value.includes(normalise(anchor)));
    const supportHits = anchors.support.filter((anchor) => value.includes(normalise(anchor)));
    return { scenario, score: strongHits.length * 3 + supportHits.length, strongHits, supportHits };
  }).sort((left, right) => right.score - left.score);
  const maxScore = scored[0]?.score || 0;
  const primary = scored.filter((item) => item.score >= 3 && item.score >= maxScore - 2).slice(0, 3).map((item) => item.scenario);
  // 次场景必须有明确领域锚点或至少两个业务支持词，避免“安全、并网、项目、运维”等通用词把整份合同误路由到其他领域。
  // 次场景只接受明确领域锚点；支持词仅用于排序，不足以单独扩大审查范围。
  const secondary = scored.filter((item) => !primary.includes(item.scenario) && item.strongHits.length > 0).slice(0, 4).map((item) => item.scenario);
  return { primary, secondary, scored };
}

function scenarioRelevanceFor(ruleScenario: string, route: ReturnType<typeof scenarioRouteForContract>) {
  if (route.primary.includes(ruleScenario)) return '主场景' as const;
  if (route.secondary.includes(ruleScenario)) return '次场景' as const;
  return null;
}

function shouldScanRuleInReview(rule: Rule, contractText: string, reviewScope: ReviewScope, route = scenarioRouteForContract(contractText)) {
  if (reviewScope !== 'all') return { scan: true, relevance: '主场景' as const };
  const relevance = scenarioRelevanceFor(rule.scenario, route);
  if (!relevance) return { scan: false, relevance: null };
  if (rule.apply_mode === 'always') return { scan: relevance === '主场景', relevance };
  const specificTrigger = (rule.trigger_terms || []).some((term) => !GENERIC_TRIGGER_TERMS.has(normalise(term)) && includesTrigger(contractText, [term]));
  const evidenceTrigger = (rule.required_groups || []).some((group) => group.some((term) => !GENERIC_TRIGGER_TERMS.has(normalise(term)) && includesTrigger(contractText, [term])));
  return { scan: relevance === '主场景' ? specificTrigger || evidenceTrigger || (rule.trigger_terms || []).some((term) => includesTrigger(contractText, [term])) : specificTrigger || evidenceTrigger, relevance };
}

function keepMaterialFindings(findings: Finding[]) {
  return findings.filter((finding) => {
    if (finding.analysisType === 'conflict' || finding.analysisType === 'relation' || finding.severity === 'high' || finding.disposition === 'confirm') return true;
    if (finding.evidence.some((item) => item.state === 'negated')) return true;
    if (finding.performanceImpact === '直接') return finding.materialityScore >= 45;
    return finding.materialityScore >= 52 && finding.confidence !== '低';
  });
}

const OFFICIAL_SOURCE_HOSTS = [
  'npc.gov.cn',
  'court.gov.cn',
  'gov.cn',
  'ndrc.gov.cn',
  'nea.gov.cn',
  'miit.gov.cn',
  'samr.gov.cn',
  'std.samr.gov.cn',
  'mohurd.gov.cn',
];

function isOfficialSourceUrl(sourceUrl: string) {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    return OFFICIAL_SOURCE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function chineseNumeralToNumber(value: string) {
  const normalized = value.replace(/零/g, '〇');
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const digits: Record<string, number> = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if ([...normalized].every((char) => char in digits)) return Number([...normalized].map((char) => digits[char]).join(''));
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of normalized) {
    if (char in digits) number = digits[char];
    else if (char in units) {
      const unit = units[char];
      if (unit === 10000) {
        section = (section + number) * unit;
        total += section;
        section = 0;
      } else {
        section += (number || 1) * unit;
      }
      number = 0;
    } else return NaN;
  }
  return total + section + number;
}

function articleRange(value: string) {
  const standard = value.replace(/\s+/g, '').match(/GB\/?T[0-9]+(?:-[0-9]+)?/i)?.[0].toUpperCase();
  if (standard) return { kind: 'standard' as const, standard };
  const articles = [...value.matchAll(/第([一二三四五六七八九十百千万〇零0-9]+)条/gu)].map((match) => chineseNumeralToNumber(match[1]));
  if (articles.length === 0 || articles.some((article) => !Number.isFinite(article))) return null;
  return { kind: 'article' as const, start: Math.min(...articles), end: Math.max(...articles) };
}

function provisionCoversArticle(requested: string, provisions: { article: string; topic: string }[] = []) {
  const wanted = articleRange(requested);
  if (!wanted) return false;
  return provisions.some((provision) => {
    const available = articleRange(provision.article);
    if (!available || available.kind !== wanted.kind) return false;
    return available.kind === 'standard'
      ? available.standard === wanted.standard
      : available.start <= wanted.start && available.end >= wanted.end;
  });
}

function legalBasisValidation(rule: Rule, sources: Record<string, Source>, policy: RiskPolicy = RISK_POLICY) {
  const basis = rule.legal_basis || [];
  if (basis.length === 0) return { status: '无直接法源' as const, note: '当前规则没有配置可直接核验的法源依据。', validatedBasis: [] as { source_id: string; articles: string[] }[] };
  const validatedBasis = basis.filter((item) => {
    const source = sources[item.source_id];
    if (!source) return false;
    const validation = SOURCE_VALIDATION.default_by_source_type[source.source_type || ''] || { binding_force: '未知', validity_status: '需人工核验', requires_exact_provision: true, may_support_legal_redline: false };
    const articles = item.articles || [];
    const broad = articles.some((article) => policy.broad_article_markers.some((marker) => normalise(article).includes(normalise(marker))));
    const exact = articles.length > 0 && !broad && articles.every((article) => Boolean(articleRange(article)));
    const binding = policy.binding_source_types.includes(source.source_type || '') && validation.may_support_legal_redline;
    const mapped = articles.every((article) => provisionCoversArticle(article, source.provisions));
    return binding && exact && validation.requires_exact_provision && isOfficialSourceUrl(source.official_url) && Boolean(source.provisions?.length) && mapped;
  });
  if (validatedBasis.length > 0) return { status: '明确' as const, note: '仅展示已通过官方域名、具体条文映射和效力门槛校验的法源；正式审查仍需打开官方页面复核现行效力和事实要件。', validatedBasis };
  return { status: '待核验' as const, note: '法源来源、具体条文映射、效力层级或适用范围未通过自动校验，未作为直接法条依据展示。', validatedBasis: [] as { source_id: string; articles: string[] }[] };
}

function inferRiskProfile(rule: Rule, policy: RiskPolicy = RISK_POLICY) {
  if (includesPolicyDimension(rule, policy.legal_redline_dimensions)) {
    return { riskCategory: '法律红线' as const, performanceImpact: '直接' as const, reason: '涉及主体资格、许可监管、安全或其他可能触发法律责任的红线事项' };
  }
  if (includesPolicyDimension(rule, policy.low_impact_dimensions)) {
    return { riskCategory: '完善建议' as const, performanceImpact: '有限' as const, reason: '主要用于文件、证据或谈判安排完善，缺失本身通常不等于违法' };
  }
  if (includesPolicyDimension(rule, policy.direct_performance_dimensions)) {
    return { riskCategory: '履约风险' as const, performanceImpact: '直接' as const, reason: '可能影响交付、验收、付款、质量、工期、并网或持续运营' };
  }
  return { riskCategory: '履约风险' as const, performanceImpact: '间接' as const, reason: '可能增加争议、举证或责任分配的不确定性' };
}

function hasExplicitViolation(rule: Rule, clause: string, policy: RiskPolicy = RISK_POLICY) {
  const dimension = normalise(`${rule.dimension}${rule.title}`);
  const terms = dimension.includes('资质') || dimension.includes('主体')
    ? ['无资质', '借用资质', '挂靠', '违法分包', '无证施工']
    : dimension.includes('许可') || dimension.includes('备案') || dimension.includes('监管')
      ? ['无需许可', '无须许可', '不办理许可', '不办理备案', '无需备案', '不办理环评', '不办理施工许可']
      : dimension.includes('安全') || dimension.includes('消防') || dimension.includes('事故')
        ? ['不承担安全生产责任', '免除全部安全生产责任', '不报告事故', '免除人身损害责任']
        : dimension.includes('召回') || dimension.includes('缺陷')
          ? ['无需召回', '不召回', '不执行召回', '不配合召回', '不承担召回']
          : dimension.includes('回收') || dimension.includes('危废')
            ? ['无资质回收', '无资质运输', '危废自行处理', '危险废物自行处理', '流向不明']
            : [];
  return terms.length > 0 && includesPositiveAny(normalise(clause), terms.map(normalise));
}

function materialityScoreFor(rule: Rule, evidence: Finding['evidence'], classification: { severity: string; disposition: Finding['disposition']; confidence: Finding['confidence']; hasNegatedGap: boolean; hasConditionalGap: boolean; deferred: boolean; performanceImpact: PerformanceImpact }) {
  const missingRatio = evidence.length ? evidence.reduce((sum, item) => sum + (item.state === 'found' ? 0 : item.state === 'conditional' ? 0.5 : 1), 0) / evidence.length : 1;
  const dimensionWeight = classification.performanceImpact === '直接' ? 10 : classification.performanceImpact === '间接' ? 4 : 0;
  const base = classification.severity === 'high' ? 78 : classification.severity === 'medium_high' ? 48 : classification.severity === 'medium' ? 32 : 18;
  const penalty = classification.deferred ? 15 : classification.hasNegatedGap ? 10 : classification.hasConditionalGap ? 6 : 0;
  return Math.max(1, Math.min(100, Math.round(base + missingRatio * 25 + dimensionWeight - penalty)));
}

function classifyRuleFinding(rule: Rule, evidence: Finding['evidence'], clause: string, fullText: string, sources: Record<string, Source>, policy: RiskPolicy = RISK_POLICY) {
  const missingGroups = evidence.filter((item) => item.state !== 'found');
  const totalGroups = evidence.length;
  const missingRatio = totalGroups > 0 ? evidence.reduce((sum, item) => sum + (item.state === 'found' ? 0 : item.state === 'conditional' ? 0.5 : 1), 0) / totalGroups : 1;
  const hasNegatedGap = missingGroups.some((item) => item.state === 'negated');
  const hasConditionalGap = missingGroups.some((item) => item.state === 'conditional');
  const deferred = hasDeferredReference(fullText, clause);
  const hardMissingCount = missingGroups.filter((item) => item.state === 'missing' || item.state === 'negated').length;
  const materialGap = totalGroups === 0 || hardMissingCount >= Math.ceil(totalGroups / 2) || (hasNegatedGap && missingRatio >= 0.35);
  const profile = inferRiskProfile(rule, policy);
  const explicitViolation = profile.riskCategory === '法律红线' && hasExplicitViolation(rule, clause, policy);
  const basisValidation = legalBasisValidation(rule, sources, policy);
  const core = profile.riskCategory === '法律红线' && explicitViolation && basisValidation.status === '明确' && !deferred && !hasConditionalGap;
  const directPerformanceGap = profile.riskCategory === '履约风险' && profile.performanceImpact === '直接' && (materialGap || hasNegatedGap || hasConditionalGap) && !deferred;
  const cautiousRedline = profile.riskCategory === '法律红线' && (materialGap || hasNegatedGap);
  const severity = core ? 'high' : directPerformanceGap || cautiousRedline ? 'medium' : 'low';
  const disposition = severity === 'high' ? 'core' : severity === 'medium' ? 'confirm' : 'notice';
  const confidence = core ? '高' : basisValidation.status !== '明确' || hasNegatedGap || hasConditionalGap || deferred || missingRatio > 0.5 || (profile.riskCategory === '法律红线' && !explicitViolation) ? '低' : '中';
  const evidenceCertainty = missingGroups.length === 0 ? '充分' : hasNegatedGap || hasConditionalGap || missingRatio > 0.5 ? '不足' : '部分';
  const materialityScore = materialityScoreFor(rule, evidence, { severity, disposition, confidence, hasNegatedGap, hasConditionalGap, deferred, performanceImpact: profile.performanceImpact });
  const priority = core ? 'P0' : directPerformanceGap || cautiousRedline ? 'P1' : profile.riskCategory === '履约风险' ? 'P2' : 'P3';
  const riskReason = core
    ? `${profile.reason}；条款出现明确不合规表述，且法源已通过具体条文和效力门槛校验。`
    : directPerformanceGap
      ? `${profile.reason}；当前存在关键履约要素缺失、否定或条件性表述，先按中风险提示并要求人工确认，不直接认定为违法。`
      : profile.riskCategory === '法律红线'
        ? `${profile.reason}；当前未形成明确违法结论，因证据或法源不足按待核验处理。`
        : `${profile.reason}；当前更适合作为合同完善建议，不直接推高违法风险。`;
  return { ...profile, severity, disposition, confidence, evidenceCertainty, priority, riskReason, hasNegatedGap, hasConditionalGap, deferred, materialityScore, legalBasisStatus: basisValidation.status, basisNote: basisValidation.note, validatedBasis: basisValidation.validatedBasis } as const;
}

function mergeFindings(findings: Finding[]) {
  const grouped = new Map<string, Finding>();
  const categoryRank: Record<RiskCategory, number> = { 法律红线: 3, 履约风险: 2, 完善建议: 1 };
  const impactRank: Record<PerformanceImpact, number> = { 直接: 3, 间接: 2, 有限: 1 };
  const priorityRank: Record<string, number> = { P0: 4, P1: 3, P2: 2, P3: 1 };
  const certaintyRank: Record<string, number> = { 充分: 3, 部分: 2, 不足: 1 };
  for (const finding of findings) {
    const key = `${finding.analysisType}:${normalise(finding.dimension)}:${finding.disposition}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...finding, ruleIds: uniqueStrings(finding.ruleIds.length > 0 ? finding.ruleIds : [finding.id]) });
      continue;
    }
    const ruleIds = uniqueStrings([...existing.ruleIds, ...finding.ruleIds]);
    grouped.set(key, {
      ...existing,
      id: existing.id,
      scenarios: uniqueStrings([...existing.scenarios, ...finding.scenarios]),
      title: ruleIds.length > 1 ? `${existing.dimension}相关审查风险（${ruleIds.length}项合并）` : existing.title,
      severity: existing.severity === 'high' || finding.severity === 'high' ? 'high' : existing.severity === 'medium' || finding.severity === 'medium' ? 'medium' : 'low',
      riskCategory: categoryRank[existing.riskCategory] >= categoryRank[finding.riskCategory] ? existing.riskCategory : finding.riskCategory,
      performanceImpact: impactRank[existing.performanceImpact] >= impactRank[finding.performanceImpact] ? existing.performanceImpact : finding.performanceImpact,
      priority: (priorityRank[existing.priority || 'P3'] || 0) >= (priorityRank[finding.priority || 'P3'] || 0) ? existing.priority : finding.priority,
      evidenceCertainty: (certaintyRank[existing.evidenceCertainty || '不足'] || 0) <= (certaintyRank[finding.evidenceCertainty || '不足'] || 0) ? existing.evidenceCertainty : finding.evidenceCertainty,
      scenarioRelevance: existing.scenarioRelevance === '主场景' || finding.scenarioRelevance === '主场景' ? '主场景' : existing.scenarioRelevance || finding.scenarioRelevance,
      materialityScore: Math.max(existing.materialityScore, finding.materialityScore),
      riskReason: uniqueStrings([existing.riskReason || '', finding.riskReason || '']).join('；'),
      ruleIds,
      message: uniqueStrings([existing.message, finding.message]).join(' '),
      recommendation: uniqueStrings([existing.recommendation, finding.recommendation]).join('；'),
      basis: Array.from(new Map([...existing.basis, ...finding.basis].map((item) => [`${item.source_id}:${item.articles.join(',')}`, item])).values()),
      humanReview: uniqueStrings([...existing.humanReview, ...finding.humanReview]),
      clause: uniqueStrings([existing.clause, finding.clause]).join('；').slice(0, 1200),
      caseTags: uniqueStrings([...existing.caseTags, ...finding.caseTags]),
      elements: Array.from(new Map([...existing.elements, ...finding.elements].map((item) => [item.label, item])).values()),
      counterProposal: existing.counterProposal || finding.counterProposal,
      evidence: Array.from(new Map([...existing.evidence, ...finding.evidence].map((item) => [item.label, item])).values()),
    });
  }
  const severityRank: Record<string, number> = { high: 3, medium_high: 2, medium: 2, low: 1 };
  return Array.from(grouped.values()).sort((left, right) => (severityRank[right.severity] || 0) - (severityRank[left.severity] || 0) || right.materialityScore - left.materialityScore);
}

const SCORE_DISPOSITION_WEIGHTS: Record<Finding['disposition'], number> = { core: 0.18, confirm: 0.045, notice: 0.006 };
const SCORE_CONFIDENCE_WEIGHTS: Record<Finding['confidence'], number> = { 高: 1, 中: 0.7, 低: 0.25 };

function includesPositiveAny(text: string, terms: string[]) {
  return terms.some((term) => {
    let offset = 0;
    while (true) {
      const index = text.indexOf(term, offset);
      if (index < 0) return false;
      const preceding = text.slice(Math.max(0, index - 18), index);
      if (!/(不含|不包括|不承担|不适用|未约定|未包含|无需|不得|取消|除外|无|不|未)[^，。；、]{0,8}$/.test(preceding)) return true;
      offset = index + term.length;
    }
  });
}

function detectProtectionCredits(text: string) {
  const checks = [
    { label: '分阶段验收与性能测试', credit: 5, match: includesPositiveAny(text, ['阶段验收', '分阶段验收', '性能考核', '并网验收']) && includesPositiveAny(text, ['复验', '性能测试', '试运行']) },
    { label: '里程碑付款与质保金', credit: 5, match: includesPositiveAny(text, ['里程碑支付', '进度款', '付款节点']) && includesPositiveAny(text, ['质保金', '尾款', '付款申请']) },
    { label: '书面变更与签证', credit: 4, match: includesPositiveAny(text, ['变更单', '书面变更', '签证']) && includesPositiveAny(text, ['价格', '工期', '计价']) },
    { label: '开工条件与工期顺延', credit: 4, match: includesPositiveAny(text, ['开工条件', '开工日期']) && includesPositiveAny(text, ['工期顺延', '顺延', '延误']) },
    { label: '质保响应与缺陷修复', credit: 3, match: includesPositiveAny(text, ['质保期', '缺陷责任期']) && includesPositiveAny(text, ['响应', '维修', '更换', '整改']) },
    { label: '责任上限与间接损失排除', credit: 4, match: includesPositiveAny(text, ['责任上限', '累计责任', '责任限额']) && includesPositiveAny(text, ['间接损失', '预期收益', '责任上限']) },
    { label: '解除条件与终止交接', credit: 3, match: includesPositiveAny(text, ['解除合同', '解除或终止', '合同终止']) && includesPositiveAny(text, ['逾期付款', '整改期', '交接']) },
    { label: '分包资质与审批', credit: 2, match: includesPositiveAny(text, ['分包', '专业分包']) && includesPositiveAny(text, ['资质', '审查', '批准']) },
    { label: '数据权限与网络安全', credit: 2, match: includesPositiveAny(text, ['运行数据', '数据导出']) && includesPositiveAny(text, ['远程', '日志', '脱敏', '最小权限']) },
    { label: '软件许可与知识产权', credit: 2, match: includesPositiveAny(text, ['软件许可', '知识产权']) && includesPositiveAny(text, ['使用权', '源代码', '许可']) },
    { label: '保险与第三者责任', credit: 2, match: includesPositiveAny(text, ['工程一切险', '第三者责任险', '安装工程险']) },
    { label: '不可抗力通知与减损', credit: 2, match: includesPositiveAny(text, ['不可抗力']) && includesPositiveAny(text, ['通知', '证明', '减损']) },
  ];
  const protectedItems = checks.filter((item) => item.match).map((item) => item.label);
  const rawCredit = checks.filter((item) => item.match).reduce((sum, item) => sum + item.credit, 0);
  return { protectedItems, protectionCredit: Math.min(20, rawCredit) };
}

function calculateOverallScore(text: string, findings: Finding[]) {
  const buckets = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = normalise(finding.dimension);
    buckets.set(key, [...(buckets.get(key) || []), finding]);
  }
  let corePenalty = 0;
  let confirmPenalty = 0;
  let noticePenalty = 0;
  let legalRedlinePenalty = 0;
  let performancePenalty = 0;
  let completenessPenalty = 0;
  let duplicateReduction = 0;
  let lowConfidenceReduction = 0;
  let uncertaintyAdjustment = 0;
  for (const bucket of buckets.values()) {
    const ranked = bucket.map((finding) => {
      const raw = finding.materialityScore * SCORE_DISPOSITION_WEIGHTS[finding.disposition];
      const confidenceWeight = SCORE_CONFIDENCE_WEIGHTS[finding.confidence];
      return { finding, raw, adjusted: raw * confidenceWeight };
    }).sort((left, right) => right.adjusted - left.adjusted);
    ranked.forEach(({ finding, raw, adjusted }, index) => {
      const contribution = index === 0 ? adjusted : adjusted * 0.25;
      if (index > 0) duplicateReduction += adjusted - contribution;
      if (finding.confidence === '低') {
        lowConfidenceReduction += raw - adjusted;
        uncertaintyAdjustment += raw - adjusted;
      }
      if (finding.disposition === 'core') corePenalty += contribution;
      else if (finding.disposition === 'confirm') confirmPenalty += contribution;
      else noticePenalty += contribution;
      if (finding.riskCategory === '法律红线') legalRedlinePenalty += contribution;
      else if (finding.riskCategory === '履约风险') performancePenalty += contribution;
      else completenessPenalty += contribution;
    });
  }
  const { protectedItems, protectionCredit } = detectProtectionCredits(text);
  const overallScore = Math.max(5, Math.min(100, Math.round(100 - corePenalty - confirmPenalty - noticePenalty + protectionCredit)));
  return {
    overallScore,
    scoreBreakdown: {
      corePenalty: Math.round(corePenalty),
      confirmPenalty: Math.round(confirmPenalty),
      noticePenalty: Math.round(noticePenalty),
      legalRedlinePenalty: Math.round(legalRedlinePenalty),
      performancePenalty: Math.round(performancePenalty),
      completenessPenalty: Math.round(completenessPenalty),
      duplicateReduction: Math.round(duplicateReduction),
      lowConfidenceReduction: Math.round(lowConfidenceReduction),
      uncertaintyAdjustment: Math.round(uncertaintyAdjustment),
      protectionCredit,
      protectedItems,
    } satisfies ScoreBreakdown,
  };
}

function detectConflicts(text: string): Finding[] {
  const clauses = splitClauses(text);
  const conflictPairs = [
    {
      id: 'CONFLICT-001', dimension: '交付与风险转移', title: '毁损灭失风险转移节点前后不一致', severity: 'medium',
      left: ['出厂时风险转移', '出厂时起风险转移', '自出厂时起风险转移', '发货时风险转移', '装车时风险转移'], right: ['到货后风险转移', '卸货后转移', '完成现场卸货后风险转移', '到货并完成现场卸货后风险才转移', '到货并完成现场卸货后风险转移', '验收后风险转移', '项目现场交付后风险转移'],
      message: '合同同时出现发货/出厂转移和到货/现场/验收转移的表述，可能导致运输途中毁损灭失、保险和付款责任争议。',
      recommendation: '保留一个明确的风险节点，并分别约定所有权、风险、运输保险、卸货和验收的法律效果。',
    },
    {
      id: 'CONFLICT-002', dimension: '运输责任', title: '运输责任主体前后不一致', severity: 'medium',
      left: ['乙方负责运输', '运输由乙方', '乙方安排运输'], right: ['甲方负责运输', '运输由甲方', '甲方安排运输'],
      message: '合同对运输责任主体出现相反表述，承运、费用、保险和索赔主体不清。',
      recommendation: '明确运输组织、承运人选择、费用、保险、装卸和事故索赔的唯一责任主体。',
    },
    {
      id: 'CONFLICT-003', dimension: '数据与知识产权', title: '运行数据归属与使用权限前后不一致', severity: 'medium',
      left: ['数据归乙方', '运行数据归乙方', '数据所有权归乙方'], right: ['数据归甲方', '运行数据归甲方', '甲方拥有数据', '甲方有权使用运行数据'],
      message: '合同同时出现供应商独占数据和买方拥有/使用数据的表述，可能影响运维、审计、迁移和争议举证。',
      recommendation: '区分原始运行数据、衍生数据、软件及接口权利，明确项目公司访问、导出、备份和终止后的持续使用权。',
    },
    {
      id: 'CONFLICT-004', dimension: '变更控制', title: '核心部件变更审批权限前后不一致', severity: 'medium',
      left: ['无需甲方书面同意', '无需书面同意', '乙方可自行更换'], right: ['须经甲方书面同意', '经甲方书面同意', '书面变更单确认'],
      message: '合同一处允许供应商单方替换，另一处又要求买方书面确认，可能导致型号、性能和质保责任争议。',
      recommendation: '规定核心部件、软件版本和技术参数变更必须通过书面变更单，并重新确认价格、工期、验收和质保影响。',
    },
    {
      id: 'CONFLICT-005', dimension: '验收', title: '验收默示通过与书面验收要求前后不一致', severity: 'medium',
      left: ['未签字视为验收合格', '逾期未提出异议视为合格', '视为验收合格', '自动视为验收合格'], right: ['须书面验收', '书面验收报告', '不视为验收合格', '不得视为验收合格'],
      message: '合同同时出现“逾期自动视为合格”和“必须书面验收/不得默示验收”的表述，可能影响质量异议、付款和举证。',
      recommendation: '明确各阶段验收的启动、期限、签署主体、默示效果及隐蔽瑕疵例外，避免同一验收节点存在相反规则。',
    },
    {
      id: 'CONFLICT-006', dimension: '责任限制', title: '责任上限与无限/全部责任表述前后不一致', severity: 'medium',
      left: ['责任上限', '累计责任限额', '责任限额'], right: ['不设上限', '无限责任', '承担全部责任', '不受责任上限限制'],
      message: '合同同时出现责任限额和无限/全部责任表述，但未明确例外范围，可能导致赔偿边界和责任上限争议。',
      recommendation: '将责任上限、例外责任、第三方索赔、知识产权、人身损害和故意/重大过失分别列明，并统一适用顺序。',
    },
    {
      id: 'CONFLICT-007', dimension: '合同文件优先级', title: '主合同、订单与技术文件的优先顺序前后不一致', severity: 'medium',
      left: ['主合同优先', '以主合同为准', '主合同与附件不一致'], right: ['以订单为准', '以技术协议为准', '以乙方订单为准', '技术文件优先'],
      message: '合同文件优先级存在相反安排，可能使价格、技术参数、验收和责任条款被不同文件反复改写。',
      recommendation: '建立完整的合同文件清单和优先级顺序，明确后签文件只有经授权书面变更才能改变主合同责任安排。',
    },
    {
      id: 'CONFLICT-008', dimension: '延期与违约责任', title: '延期免责与逾期违约责任前后不一致', severity: 'medium',
      left: ['逾期交付承担违约金', '逾期完工承担违约金', '延期违约金'], right: ['逾期不承担责任', '不承担延期责任', '延期不承担违约责任', '自动顺延'],
      message: '合同一处约定延期承担违约责任，另一处又对同类延期作概括免责或自动顺延，可能影响工期责任认定和损失计算。',
      recommendation: '区分可归责延期、约定顺延事由和不可抗力，明确通知、证明、减损、顺延天数和违约金计算边界。',
    },
  ];
  return conflictPairs.flatMap((pair) => {
    const leftClause = clauses.find((clause) => includesAny(clause, pair.left));
    const rightClause = clauses.find((clause) => includesAny(clause, pair.right));
    if (!leftClause || !rightClause || leftClause === rightClause) return [];
    return [{
      id: pair.id,
      scenarios: ['cross_domain'],
      dimension: pair.dimension,
      title: pair.title,
      severity: pair.severity,
      disposition: 'confirm',
      confidence: '中',
      riskCategory: '履约风险',
      performanceImpact: '直接',
      riskReason: '属于跨条款一致性检查；当前发现相反表述，可能影响责任、证据或履行安排，但不直接认定违法。',
      ruleIds: [pair.id],
      message: `${pair.message} 风险分级理由：属于跨条款一致性检查；当前发现相反表述，可能影响责任、证据或履行安排，但不直接认定违法。`,
      recommendation: pair.recommendation,
      basis: [],
      humanReview: ['人工核对合同正文、技术协议、订单及补充文件的签署版本', '确认冲突表述是否因不同交易阶段或附件而有意区分'],
      clause: `表述一：${leftClause}；表述二：${rightClause}`,
      caseTags: [pair.dimension, '条款冲突'],
      analysisType: 'conflict' as const,
      scenarioRelevance: '跨条款' as const,
      priority: 'P1' as const,
      evidenceCertainty: '充分' as const,
      materialityScore: pair.severity === 'high' ? 72 : 58,
      elements: extractClauseElements(`${leftClause} ${rightClause}`),
      counterProposal: '',
      evidence: [
        { label: '表述一', state: 'found' as const, examples: [leftClause] },
        { label: '表述二', state: 'found' as const, examples: [rightClause] },
      ],
    }];
  });
}

function detectCrossClauseIssues(text: string, relationGraph = buildPerformanceRelationGraph(text)): Finding[] {
  return relationGraph.findings.map((item) => ({
    id: item.id,
    scenarios: ['cross_domain'],
    dimension: item.dimension,
    title: item.title,
    severity: item.severity,
    disposition: item.severity === 'low' ? 'notice' as const : 'confirm' as const,
    confidence: item.confidence as Finding['confidence'],
    riskCategory: item.severity === 'low' ? '完善建议' as const : '履约风险' as const,
    performanceImpact: item.severity === 'low' ? '间接' as const : '直接' as const,
    riskReason: '属于履约关系图检查；系统已识别两个以上履行节点及其先后、条件或救济关系。该结论反映履约风险，不直接认定合同违法或无效。',
    priority: item.priority as Finding['priority'],
    evidenceCertainty: item.evidenceCertainty as Finding['evidenceCertainty'],
    scenarioRelevance: '跨条款' as const,
    legalBasisStatus: '无直接法源' as const,
    basisNote: '关系型风险需结合合同整体、交易结构和实际履行流程复核。',
    materialityScore: item.materialityScore,
    ruleIds: [item.id],
    message: `关系路径：${item.relationPath.join(' → ')}。${item.message} 风险分级理由：该问题影响履行节点之间的衔接和救济，不直接等同于违法。`,
    recommendation: item.recommendation,
    basis: [],
    humanReview: item.humanReview,
    clause: item.clause,
    caseTags: item.caseTags,
    analysisType: 'relation' as const,
    relationPath: item.relationPath,
    elements: extractClauseElements(item.clause),
    counterProposal: '',
    evidence: item.evidence.map((evidence) => ({ ...evidence, state: evidence.state as Finding['evidence'][number]['state'] })),
  }));
}

function compareContractTexts(beforeText: string, afterText: string): ComparisonResult {
  const before = splitClauses(beforeText);
  const after = splitClauses(afterText);
  const keyOf = (clause: string) => (clause.match(/^(第[^条]{1,8}条|\d{1,3}[、.])/u)?.[1] || clause.slice(0, 18)).replace(/\s/g, '');
  const beforeMap = new Map(before.map((clause) => [keyOf(clause), clause]));
  const afterMap = new Map(after.map((clause) => [keyOf(clause), clause]));
  const added = [...afterMap.entries()].filter(([key]) => !beforeMap.has(key)).map(([, clause]) => clause);
  const removed = [...beforeMap.entries()].filter(([key]) => !afterMap.has(key)).map(([, clause]) => clause);
  const changed = [...afterMap.entries()].flatMap(([key, clause]) => {
    const previous = beforeMap.get(key);
    return previous && previous !== clause ? [{ before: previous, after: clause }] : [];
  });
  return { added, removed, changed };
}

function analyseContract(text: string, allRules: Rule[], selectedScenario = 'storage_procurement', perspective: PartyPerspective = '采购方', reviewScope: ReviewScope = 'all', sources: Record<string, Source> = {}) {
  const scenarioRules = reviewScope === 'all' || selectedScenario === 'all' ? allRules : allRules.filter((rule) => rule.scenario === selectedScenario);
  const route = scenarioRouteForContract(text);
  const relationGraph = buildPerformanceRelationGraph(text);
  const findings: Finding[] = [];
  for (const rule of scenarioRules) {
    const applicability = ruleApplicability(rule, text);
    if (!applicability.applicable) continue;
    const scanDecision = shouldScanRuleInReview(rule, text, reviewScope, route);
    if (!scanDecision.scan) continue;
    const triggered = rule.apply_mode === 'always' || includesTrigger(text, rule.trigger_terms);
    if (!triggered) continue;
    const evidence = (rule.required_groups || []).map((group) => evidenceForGroup(text, group));
    const missingGroups = evidence.filter((item) => item.state !== 'found');
    if (missingGroups.length === 0) continue;
    const hasNegatedGap = missingGroups.some((item) => item.state === 'negated');
    const gapMessage = missingGroups.length > 0 ? ` 当前证据状态：${missingGroups.map((item) => `${item.label}（${item.state === 'negated' ? '出现否定/待定表述' : item.state === 'conditional' ? '存在条件/例外表述' : '未识别'}）`).join('、')}。` : '';
    const clause = findBestClause(text, rule);
    const classification = classifyRuleFinding(rule, evidence, clause, text, sources);
    findings.push({ id: rule.id, scenarios: [rule.scenario], dimension: rule.dimension, title: rule.title, severity: classification.severity, disposition: classification.disposition, confidence: classification.confidence, riskCategory: classification.riskCategory, performanceImpact: classification.performanceImpact, riskReason: classification.riskReason, priority: classification.priority, evidenceCertainty: classification.evidenceCertainty, scenarioRelevance: scanDecision.relevance || '次场景', legalBasisStatus: classification.legalBasisStatus, basisNote: classification.basisNote, materialityScore: classification.materialityScore, ruleIds: [rule.id], message: `${rule.missing_message}${gapMessage}${classification.riskCategory === '法律红线' && classification.severity !== 'high' ? ' 当前仅能确认相关材料或条款信息不足，尚不能直接认定为违法；请先完成人工核验。' : ''}${classification.legalBasisStatus !== '明确' && classification.riskCategory === '法律红线' ? ` ${classification.basisNote}` : ''}${classification.deferred ? ' 合同提到附件或后续文件，当前结论先列为待确认，不直接认定为实质性缺陷。' : ''} 风险分级理由：${classification.riskReason}`, recommendation: rule.recommendation, basis: classification.validatedBasis, humanReview: [...(rule.human_review || []), ...(classification.legalBasisStatus !== '明确' && classification.riskCategory === '法律红线' ? ['人工打开官方法源，核对具体条文、效力状态、项目类型和适用条件'] : []), ...(hasNegatedGap ? ['人工确认合同中的否定、免责或“另行协商”表述是否实际排除了该保护义务'] : []), ...(classification.hasConditionalGap ? ['人工确认条件、例外和前置审批是否已经满足，以及未满足时责任如何承担'] : []), ...(classification.deferred ? ['人工核对所引用的附件、技术协议或后续确认文件是否已签署并与正文一致'] : []), ...(applicability.label ? [`当前规则已通过${applicability.label}门槛`] : [])], clause, caseTags: rule.case_tags || [], analysisType: 'rule', elements: extractClauseElements(clause), counterProposal: '', evidence });
  }
  findings.push(...detectConflicts(text), ...detectCrossClauseIssues(text, relationGraph));
  const mergedFindings = keepMaterialFindings(mergeFindings(findings).map((finding) => ({ ...finding, legalBasisStatus: finding.legalBasisStatus || (finding.analysisType === 'conflict' || finding.analysisType === 'relation' ? '无直接法源' as const : undefined), counterProposal: generateCounterProposal(finding, perspective) })));
  const highCount = mergedFindings.filter((item) => item.severity === 'high').length;
  const mediumCount = mergedFindings.filter((item) => item.severity === 'medium').length;
  const overall = highCount > 0 ? '高' : mediumCount > 0 ? '中' : mergedFindings.length > 0 ? '低' : '低';
  const score = calculateOverallScore(text, mergedFindings);
  return { findings: mergedFindings, overall, overallScore: score.overallScore, scoreBreakdown: score.scoreBreakdown, perspective, clauses: splitClauses(text), relationGraph };
}

function rankSimilarCases(text: string, selectedScenario: string, allCases: CaseRecord[], findings: Finding[], reviewScope: ReviewScope = 'all'): SimilarCase[] {
  const terms = Array.from(new Set([
    ...findings.flatMap((finding) => finding.caseTags),
    ...findings.map((finding) => finding.dimension),
    ...findings.map((finding) => finding.title),
  ].flatMap((value) => value.split(/[、，,；;：:\s/]+/)).map(normalise).filter((value) => value.length >= 2)));
  const contractValue = normalise(text);
  const scopedCases = reviewScope === 'all' ? allCases : allCases.filter((item) => item.scenario === selectedScenario || !item.scenario);
  return scopedCases.map((item) => {
    const haystack = normalise([item.title, item.summary, item.holding_or_rule || '', ...(item.keywords || []), ...(item.retrieval_tags || [])].join(' '));
    const matchedTerms = terms.filter((term) => haystack.includes(term));
    const directHits = (item.keywords || []).filter((term) => contractValue.includes(normalise(term))).length;
    const scenarioBoost = reviewScope === 'selected' && item.scenario === selectedScenario ? 4 : 0;
    const authorityBoost = item.authority_level?.includes('最高') ? 3 : item.authority_level?.includes('高级') ? 2 : 0;
    const dateBoost = item.decision_date && Number(item.decision_date.slice(0, 4)) >= 2023 ? 1 : 0;
    const score = matchedTerms.length * 2 + directHits + scenarioBoost + authorityBoost + dateBoost;
    const matchReasons = uniqueStrings([
      reviewScope === 'selected' && item.scenario === selectedScenario ? `场景匹配：${selectedScenario}` : '',
      matchedTerms.length > 0 ? `风险标签匹配：${matchedTerms.slice(0, 3).join('、')}` : '',
      directHits > 0 ? `合同关键词命中：${directHits}项` : '',
      authorityBoost > 0 ? '裁判层级加权' : '',
      dateBoost > 0 ? '近年文书加权' : '',
    ]);
    return { ...item, score, matchReasons };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score).slice(0, 3);
}

function downloadFile(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

function makeRiskTableReport(filename: string, findings: Finding[], sources: Record<string, Source>, riskFilter: RiskFilter) {
  const filterLabel = riskFilter === 'all' ? '全部风险' : riskFilter === 'high' ? '严重级别' : riskFilter === 'medium' ? '中风险' : '低风险';
  const rows = [
    ['风险等级', '处置优先级', '风险性质', '履约影响', '场景相关性', '证据确定性', '处理属性', '置信度', '分级理由', '法源门槛', '影响评分', '风险编号', '合并规则', '识别类型', '关系路径', '风险维度', '风险标题', '风险说明', '命中/定位条款', '条款要素', '证据状态', '修改建议', '谈判建议条款', '法源依据', '人工复核'],
    ...findings.map((item) => [
      item.severity === 'high' ? '严重级别' : item.severity === 'low' ? '低风险' : '中风险',
      item.priority || 'P2',
      item.riskCategory,
      item.performanceImpact,
      item.scenarioRelevance || '次场景',
      item.evidenceCertainty || '不足',
      dispositionLabel[item.disposition],
      item.confidence,
      item.riskReason || '请结合业务事实复核分级理由',
      item.legalBasisStatus || '无直接法源',
      String(item.materialityScore),
      item.id,
      item.ruleIds.join('、'),
      analysisTypeLabel[item.analysisType],
      item.relationPath?.join(' → ') || '',
      item.dimension,
      item.title,
      item.message,
      item.clause,
      item.elements.map((element) => `${element.label}：${element.state === 'found' ? element.example : '待补充'}`).join('；'),
      item.evidence.map((evidence) => `${evidence.label}：${evidence.state === 'found' ? '已识别' : evidence.state === 'negated' ? '否定/待定' : evidence.state === 'conditional' ? '条件/例外' : '缺失'}`).join('；'),
      item.recommendation,
      item.counterProposal,
      item.basis.map((basis) => `${sources[basis.source_id]?.title || basis.source_id} ${basis.articles.join('、')}`).join('；'),
      item.humanReview.join('；') || '请结合业务事实复核',
    ]),
  ];
  const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  downloadFile(`${filename.replace(/\.[^.]+$/, '')}-${filterLabel}-风险项目.csv`, csv, 'text/csv;charset=utf-8');
}

function makeRemediationReport(filename: string, findings: Finding[], remediationStatus: Record<string, string>) {
  const rows = [
    ['风险编号', '处置优先级', '风险性质', '履约影响', '场景相关性', '证据确定性', '处理属性', '风险等级', '分级理由', '法源门槛', '影响评分', '识别类型', '关系路径', '风险维度', '风险标题', '当前处理状态', '责任人', '计划完成日', '修改建议', '谈判建议条款', '人工复核'],
    ...findings.map((item) => [
      item.id,
      item.priority || 'P2',
      item.riskCategory,
      item.performanceImpact,
      item.scenarioRelevance || '次场景',
      item.evidenceCertainty || '不足',
      dispositionLabel[item.disposition],
      item.severity === 'high' ? '严重级别' : item.severity === 'low' ? '低风险' : '中风险',
      item.riskReason || '请结合业务事实复核分级理由',
      item.legalBasisStatus || '无直接法源',
      String(item.materialityScore),
      analysisTypeLabel[item.analysisType],
      item.relationPath?.join(' → ') || '',
      item.dimension,
      item.title,
      remediationStatus[item.id] || '待处理',
      '',
      '',
      item.recommendation,
      item.counterProposal,
      item.humanReview.join('；'),
    ]),
  ];
  const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  downloadFile(`${filename.replace(/\.[^.]+$/, '')}-整改清单.csv`, csv, 'text/csv;charset=utf-8');
}

function makeMarkdownReport(filename: string, findings: Finding[], overall: string, scenarioLabel: string, riskCompletenessScore?: number) {
  const lines = ['# 新能源企业法务合同审查报告', '', `- 文件：${filename}`, `- 场景：${scenarioLabel}`, `- 总体风险：${overall}`, `- 合同风险完整度：${riskCompletenessScore ?? '—'}/100`, '- 生成方式：浏览器端规则审查辅助', '', '> 风险等级已按“法律红线—履约风险—完善建议”排序；严重级别仅表示疑似违法、无效、监管/安全红线或明确冲突，且须通过明确法源门槛，仍需人工核验。', '> 本报告仅用于合同审查辅助，不构成法律意见；法规和案例引用应由法务人员打开官方来源核验。', '', '## 风险项', ''];
  findings.forEach((item, index) => {
    lines.push(`### ${index + 1}. [${severityLabel[item.severity] || item.severity}] ${item.title}`);
    lines.push(`- 处置优先级：${item.priority || 'P2'}；处理属性：${dispositionLabel[item.disposition]}；置信度：${item.confidence}；证据确定性：${item.evidenceCertainty || '不足'}`);
    lines.push(`- 影响评分：${item.materialityScore}/100`);
    lines.push(`- 合并规则：${item.ruleIds.join('、')}`);
    lines.push(`- 风险维度：${item.dimension}`);
    lines.push(`- 风险性质：${item.riskCategory}`);
    lines.push(`- 对合同履行的影响：${item.performanceImpact}`);
    lines.push(`- 分级理由：${item.riskReason || '请结合业务事实复核分级理由'}`);
    lines.push(`- 法源门槛：${item.legalBasisStatus || '无直接法源'}${item.basisNote ? `；${item.basisNote}` : ''}`);
    lines.push(`- 识别条款：${item.clause}`);
    lines.push(`- 风险说明：${item.message}`);
    lines.push(`- 识别类型：${analysisTypeLabel[item.analysisType]}；场景相关性：${item.scenarioRelevance || '次场景'}；关系路径：${item.relationPath?.join(' → ') || '不适用'}；证据状态：${item.evidence.map((evidence) => `${evidence.label}=${evidence.state === 'found' ? '已识别' : evidence.state === 'negated' ? '否定/待定' : evidence.state === 'conditional' ? '条件/例外' : '缺失'}`).join('、')}`);
    lines.push(`- 修改建议：${item.recommendation}`);
    lines.push(`- 谈判建议条款：${item.counterProposal}`);
    lines.push(`- 人工复核：${item.humanReview.join('；') || '请结合业务事实复核'}`);
    lines.push('');
  });
  downloadFile(`${filename.replace(/\.[^.]+$/, '')}-审查报告.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
}

export default function Home() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [sources, setSources] = useState<Record<string, Source>>({});
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [caseCatalog, setCaseCatalog] = useState<CaseCatalog | null>(null);
  const [contractText, setContractText] = useState('');
  const [fileName, setFileName] = useState('尚未上传合同');
  const [scenario, setScenario] = useState('all');
  const [reviewScope, setReviewScope] = useState<ReviewScope>('all');
  const [perspective, setPerspective] = useState<PartyPerspective>('采购方');
  const [review, setReview] = useState<ReturnType<typeof analyseContract> | null>(null);
  const [comparisonName, setComparisonName] = useState('');
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [remediationStatus, setRemediationStatus] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'review' | 'cases' | 'sources'>('review');
  const [caseQuery, setCaseQuery] = useState('储能 设备 质量');
  const [loading, setLoading] = useState(false);
  const [isDropActive, setIsDropActive] = useState(false);
  const [status, setStatus] = useState('规则库和官方来源正在加载…');
  const [error, setError] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/data/rules.json').then((response) => response.json()),
      fetch('/data/sources.json').then((response) => response.json()),
      fetch('/data/cases.json').then((response) => response.json()),
      fetch('/data/case_leads.jsonl').then((response) => response.text()),
      fetch('/data/case_catalog.json').then((response) => response.json()),
      fetch('/data/case_retrieval_samples.json').then((response) => response.json()),
      fetch('/data/rule_packs.json').then((response) => response.json()),
      fetch('/data/rule_expansions.json').then((response) => response.json()),
    ]).then(([ruleData, sourceData, caseData, leadText, catalogData, sampleData, rulePackData, ruleExpansionData]) => {
      if (!alive) return;
      const leadRecords = leadText.split('\n').filter(Boolean).map((line) => JSON.parse(line) as CaseRecord);
      const sourceList = (sourceData.sources || []) as Source[];
      const expandedRules = normaliseRuleExpansions(ruleExpansionData as { rules?: CompactRuleExpansion[] });
      const mergedRules = Array.from(new Map([...((ruleData.rules || []) as Rule[]), ...((rulePackData.rules || []) as Rule[]), ...expandedRules].map((rule) => [rule.id, rule])).values());
      setRules(mergedRules);
      setSources(Object.fromEntries(sourceList.map((source) => [source.id, source])));
      setCases([...(caseData.cases || []), ...leadRecords, ...((sampleData.samples || []) as CaseRecord[])]);
      setCaseCatalog(catalogData as CaseCatalog);
      setStatus(`已加载 ${mergedRules.length} 条规则，参考素材索引已就绪`);
    }).catch(() => setStatus('数据加载失败，请刷新页面重试。'));
    return () => { alive = false; };
  }, []);

  const activeRules = useMemo(() => reviewScope === 'all' || scenario === 'all' ? rules : rules.filter((rule) => rule.scenario === scenario), [rules, scenario, reviewScope]);
  const scenarioLabels: Record<string, string> = {
    all: '全部领域',
    storage_procurement: '储能设备采购',
    epc: '新能源 EPC',
    supply_chain: '新能源供应链',
    pv: '光伏项目与设备',
    lithium_battery: '锂电池与材料',
    project_development: '项目开发与许可',
    power_market: '电力交易与绿证',
    operations_compliance: '运营维护与安全合规',
  };
  const scenarioLabel = scenarioLabels[scenario] || '新能源合同';
  const activeCatalog = scenario === 'all' ? null : caseCatalog?.categories.find((item) => item.scenario === scenario);
  const formatScaleLabel = (value: number) => value >= 10 ? `${Math.floor(value / 10) * 10}+` : '持续扩充';
  const referenceScaleLabel = useMemo(() => {
    const total = caseCatalog?.categories.reduce((sum, item) => sum + Math.max(item.verified_reference_count ?? 0, item.public_index_count ?? item.retrieval_material_count ?? 0), 0) || 0;
    return formatScaleLabel(total);
  }, [caseCatalog]);
  const activeCatalogScaleLabel = formatScaleLabel(Math.max(activeCatalog?.verified_reference_count ?? 0, activeCatalog?.public_index_count ?? activeCatalog?.retrieval_material_count ?? 0));
  const filteredCases = useMemo(() => {
    const queryTerms = caseQuery.split(/\s+/).filter(Boolean).map(normalise);
    const scopedCases = scenario === 'all' ? cases : cases.filter((item) => item.scenario === scenario);
    const candidateCases = scenario === 'all' ? cases : scopedCases.length > 0 ? [...scopedCases, ...cases.filter((item) => !item.scenario)] : cases;
    if (queryTerms.length === 0) return candidateCases.slice(0, 8);
    return candidateCases.map((item) => {
      const haystack = normalise([item.title, item.summary, item.holding_or_rule || '', ...(item.keywords || []), ...(item.retrieval_tags || [])].join(' '));
      const score = queryTerms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0) + (item.scenario === scenario ? 2 : 0);
      return { item, score };
    }).filter(({ score }) => score > 0).sort((left, right) => right.score - left.score).slice(0, 12).map(({ item }) => item);
  }, [cases, caseQuery, scenario]);

  async function readFile(file: File) {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.txt') || lowerName.endsWith('.md')) return file.text();
    if (lowerName.endsWith('.docx')) {
      const mammothModule = await import('mammoth');
      const mammoth = (mammothModule as typeof import('mammoth')).default || mammothModule;
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return result.value;
    }
    if (lowerName.endsWith('.pdf')) {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), disableWorker: true }).promise;
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 60); pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
      }
      return pages.join('\n\n');
    }
    throw new Error('目前支持 PDF、DOCX、TXT 和 MD 文件。');
  }

  async function handleContractFile(file: File) {
    setLoading(true); setError(''); setFileName(file.name);
    try {
      const text = await readFile(file);
      if (!text.trim()) throw new Error('没有提取到可读文本；如果是扫描件，请先 OCR。');
      setContractText(text); setReview(analyseContract(text, rules, scenario, perspective, reviewScope, sources)); setComparison(null); setComparisonName(''); setRemediationStatus({}); setRiskFilter('all'); setStatus(`已读取 ${file.name}，共 ${text.length.toLocaleString()} 个字符`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '文件读取失败');
    } finally { setLoading(false); }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleContractFile(file);
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDropActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleContractFile(file);
  }

  async function handleComparisonUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !contractText.trim()) { setError('请先加载当前合同，再上传需要对比的版本。'); return; }
    try {
      const text = await readFile(file);
      if (!text.trim()) throw new Error('对比文件没有提取到可读文本。');
      setComparison(compareContractTexts(contractText, text));
      setComparisonName(file.name);
      setStatus(`已完成当前合同与 ${file.name} 的条款对比`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '对比文件读取失败');
    }
  }

  function runReview(text = contractText, name = fileName) {
    if (!text.trim()) { setError('请先上传合同，或点击“加载示例合同”。'); return; }
    setError(''); setFileName(name); setContractText(text); setReview(analyseContract(text, rules, scenario, perspective, reviewScope, sources)); setComparison(null); setComparisonName(''); setRemediationStatus({}); setRiskFilter('all'); setActiveTab('review');
  }

  function copyProposal(finding: Finding) {
    navigator.clipboard?.writeText(finding.counterProposal).then(() => setStatus(`已复制 ${finding.id} 的谈判建议条款`)).catch(() => setStatus('当前浏览器未允许自动复制，请使用导出表格或 Markdown'));
  }

  const visibleSources = review ? Array.from(new Set(review.findings.flatMap((finding) => finding.basis.map((item) => item.source_id)))).map((id) => sources[id]).filter(Boolean) : Object.values(sources).slice(0, 8);
  const relatedCases = useMemo(() => review ? rankSimilarCases(contractText, scenario, cases, review.findings.filter((item) => scenario === 'all' || item.scenarios.includes(scenario) || item.scenarios.includes('cross_domain')), reviewScope) : [], [contractText, scenario, cases, review, reviewScope]);
  const reviewScopeLabel = reviewScope === 'all' || scenario === 'all' ? '全合同综合审查' : `${scenarioLabel}专项审查`;
  const groupedFindings = useMemo(() => {
    const findings = (review?.findings || []).filter((item) => scenario === 'all' || item.scenarios.includes(scenario) || item.scenarios.includes('cross_domain'));
    return [
      { key: 'high', label: '严重级别', description: '法律红线：仅保留疑似违法、无效、监管/安全红线或明确冲突，必须优先人工复核。', items: findings.filter((item) => item.severity === 'high') },
      { key: 'medium', label: '中风险', description: '履约影响：可能影响交付、验收、付款、质量、工期或运营，不直接等同违法。', items: findings.filter((item) => item.severity === 'medium_high' || item.severity === 'medium') },
      { key: 'low', label: '低风险', description: '完善建议：主要用于文件、证据和谈判安排优化，通常不影响合同有效履行。', items: findings.filter((item) => item.severity === 'low') },
    ];
  }, [review, scenario]);
  const visibleGroups = useMemo(() => riskFilter === 'all' ? groupedFindings : groupedFindings.filter((group) => group.key === riskFilter), [groupedFindings, riskFilter]);
  const visibleFindings = visibleGroups.flatMap((group) => group.items);
  const visibleFindingCount = visibleGroups.reduce((total, group) => total + group.items.length, 0);
  const activeRiskLabel = riskFilter === 'all' ? '全部风险' : groupedFindings.find((group) => group.key === riskFilter)?.label || '风险项';
  const confirmFindingCount = visibleFindings.filter((item) => item.disposition === 'confirm').length || 0;
  const noticeFindingCount = visibleFindings.filter((item) => item.disposition === 'notice').length || 0;
  const legalRedlineCount = visibleFindings.filter((item) => item.riskCategory === '法律红线').length || 0;
  const performanceFindingCount = visibleFindings.filter((item) => item.riskCategory === '履约风险').length || 0;
  const route = useMemo(() => contractText.trim() ? scenarioRouteForContract(contractText) : null, [contractText]);
  const routeSummary = route ? `主场景：${route.primary.map((item) => scenarioLabels[item] || item).join('、') || '待识别'}；次场景：${route.secondary.map((item) => scenarioLabels[item] || item).join('、') || '无'}` : '';

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">NE</div>
        <div><p className="eyebrow">NEW ENERGY LEGAL OPS</p><h1>新能源企业法务合同审查助手</h1></div>
        <div className="topbar-actions"><span className="privacy-pill">浏览器端处理 · 文件不上传</span><button type="button" className="ghost-button" onClick={() => window.open('https://www.court.gov.cn/zixun/xiangqing/426222.html', '_blank')}>官方案例库</button></div>
      </header>

      <section className="hero-grid">
        <div className="hero-copy"><p className="eyebrow accent">合同审查工作台 / MVP</p><h2>把新能源合同里的隐性风险，变成一张可复核的清单。</h2><p className="hero-description">覆盖储能采购、EPC、供应链、光伏、锂电池、项目开发、电力交易和运营安全等高频业务场景，按“法律红线 → 履约影响 → 完善建议”排序，避免把普通起草建议误报成严重风险。</p><div className="metric-row"><div><strong>{activeRules.length || 0}</strong><span>{reviewScope === 'all' ? '全合同规则' : `${scenarioLabel}规则`}</span></div><div><strong>{referenceScaleLabel}</strong><span>公开检索候选规模</span></div><div><strong>8</strong><span>业务场景</span></div></div></div>
        <div className="upload-card"><div className="upload-card-heading"><div><p className="eyebrow">01 / 上传合同</p><h3>开始一次审查</h3></div><span className="status-dot" title={status} aria-label={status} role="status" /></div><label className={`dropzone${isDropActive ? ' is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDropActive(true); }} onDragLeave={() => setIsDropActive(false)} onDrop={handleDrop}><input type="file" accept=".pdf,.docx,.txt,.md" onChange={handleUpload} /><span className="dropzone-icon">↑</span><strong>{loading ? '正在读取文件…' : isDropActive ? '松开鼠标，开始读取' : '点击选择或拖入合同'}</strong><small>PDF / DOCX / TXT / MD · 支持浏览器端提取文本</small></label><div className="upload-footer"><span className="file-name">{fileName}</span><button type="button" className="primary-button" onClick={() => runReview()}>开始审查</button></div><button type="button" className="text-button" onClick={() => runReview(SAMPLE_CONTRACT, '储能设备采购合同-示例.txt')}>先看一个示例</button><input id="comparison-input" type="file" accept=".pdf,.docx,.txt,.md" onChange={handleComparisonUpload} hidden /><button type="button" className="text-button" disabled={!contractText} onClick={() => document.getElementById('comparison-input')?.click()}>上传对比版本</button>{error && <p className="error-message">{error}</p>}</div>
      </section>

      <div className="review-note policy-banner"><strong>风险分级口径</strong><p>严重级别仅表示合同出现明确违法、无效、监管/安全红线或明确冲突；影响交付、验收、付款、质量、工期或运营的事项列为中风险；文件、证据和起草完善建议列为低风险。</p></div>

      <section className="workspace-card">
        <div className="workspace-toolbar"><div className="tabs" role="tablist" aria-label="审查结果区域"><button className={activeTab === 'review' ? 'tab active' : 'tab'} onClick={() => setActiveTab('review')}>合同审查</button><button className={activeTab === 'cases' ? 'tab active' : 'tab'} onClick={() => setActiveTab('cases')}>相似案例</button><button className={activeTab === 'sources' ? 'tab active' : 'tab'} onClick={() => setActiveTab('sources')}>法规依据</button></div><div className="toolbar-actions"><select value={reviewScope} onChange={(event) => { const nextScope = event.target.value as ReviewScope; setReviewScope(nextScope); setRiskFilter('all'); if (contractText.trim()) setReview(analyseContract(contractText, rules, scenario, perspective, nextScope, sources)); }} aria-label="审查范围"><option value="all">全合同综合审查</option><option value="selected">仅当前领域</option></select><select value={scenario} onChange={(event) => { const nextScenario = event.target.value; setScenario(nextScenario); setRiskFilter('all'); if (contractText.trim()) setReview(analyseContract(contractText, rules, nextScenario, perspective, reviewScope, sources)); }} aria-label="风险板块筛选"><option value="all">全部领域</option><option value="storage_procurement">储能设备采购</option><option value="epc">新能源 EPC</option><option value="supply_chain">新能源供应链</option><option value="pv">光伏项目与设备</option><option value="lithium_battery">锂电池与材料</option><option value="project_development">项目开发与许可</option><option value="power_market">电力交易与绿证</option><option value="operations_compliance">运营维护与安全合规</option></select><select value={perspective} onChange={(event) => { const nextPerspective = event.target.value as PartyPerspective; setPerspective(nextPerspective); if (contractText.trim()) setReview(analyseContract(contractText, rules, scenario, nextPerspective, reviewScope, sources)); }} aria-label="审查立场"><option value="采购方">采购方视角</option><option value="供应商">供应商视角</option><option value="发包方">发包方视角</option><option value="承包方">承包方视角</option><option value="项目公司">项目公司视角</option></select><button className="outline-button" disabled={!review} onClick={() => review && makeRiskTableReport(fileName, visibleFindings, sources, riskFilter)}>导出当前风险表格</button><button className="outline-button" disabled={!review} onClick={() => review && makeRemediationReport(fileName, review.findings, remediationStatus)}>导出整改清单</button><button className="outline-button" disabled={!review} onClick={() => review && makeMarkdownReport(fileName, review.findings, review.overall, reviewScopeLabel, review.overallScore)}>导出 Markdown</button><button className="outline-button" disabled={!review} onClick={() => review && downloadFile('审查结果.json', JSON.stringify({ fileName, scenario, scenarioLabel, reviewScope, perspective, overall: review.overall, riskCompletenessScore: review.overallScore, overallScore: review.overallScore, findings: review.findings, remediationStatus }, null, 2), 'application/json;charset=utf-8')}>导出 JSON</button></div></div>

        {activeTab === 'review' && <div className="review-layout"><aside className="review-sidebar"><p className="eyebrow">审查概览</p><div className="score-panel"><strong>{review ? visibleFindingCount : '—'}</strong><small>待审查内容（当前筛选）</small></div><div className="mini-list"><div><span>合同风险完整度（满分100）</span><strong>{review ? review.overallScore : '—'}</strong></div><div><span>已识别条款</span><strong>{review?.clauses.length || 0}</strong></div><div><span>法律红线</span><strong>{review ? legalRedlineCount : '—'}</strong></div><div><span>履约影响</span><strong>{review ? performanceFindingCount : '—'}</strong></div><div><span>待确认 / 提示</span><strong>{review ? confirmFindingCount + noticeFindingCount : '—'}</strong></div></div><div className="review-note"><strong>稳健审查模式</strong><p>严重级别仅保留明确违法、无效、监管/安全红线或明确冲突，且须通过明确法源门槛；其他事项按履约影响和完善程度降级。</p></div>{review && <div className="review-note"><strong>主次场景路由</strong><p>{routeSummary || '暂未识别稳定场景，建议人工选择专项板块复核。'}</p></div>}</aside><div className="review-content"><div className="section-heading"><div><p className="eyebrow">02 / 风险扫描</p><h3>{review ? '审查结果' : '等待合同文件'}</h3></div><span className="muted">{review ? `${fileName} · ${review.clauses.length} 个可定位条款` : status}</span></div>{!review && <div className="empty-state"><span>◎</span><strong>上传合同或加载示例，即可查看逐项风险</strong><p>当前场景默认聚焦新能源储能设备采购合同。</p></div>}{review && review.findings.length === 0 && <div className="empty-state success"><span>✓</span><strong>暂未命中已配置的风险规则</strong><p>仍建议人工检查技术附件、验收证据和最新监管要求。</p></div>}{review && review.findings.length > 0 && <><div className="risk-filter-hint"><span>分级口径：严重级别=明确违法/无效/监管或安全红线；中风险=履约影响；低风险=完善建议。证据不足、条件性约定和待核验法源不会自动升级为严重级别。点击风险等级卡片筛选。</span>{riskFilter !== 'all' && <button type="button" className="text-button" onClick={() => setRiskFilter('all')}>查看全部</button>}</div><div className="risk-summary-strip">{groupedFindings.map((group) => <button type="button" className={`risk-summary-card risk-summary-${group.key}${riskFilter === group.key ? ' selected' : ''}`} key={group.key} onClick={() => setRiskFilter(group.key as RiskFilter)} aria-pressed={riskFilter === group.key}><span>{group.label}</span><strong>{group.items.length}</strong></button>)}</div><div className="risk-filter-status">当前显示：<strong>{activeRiskLabel}</strong><span>· {visibleFindingCount} 项 · 风险完整度 {review?.overallScore ?? '—'}/100 · 法律红线 {legalRedlineCount} · 履约影响 {performanceFindingCount}</span></div>{review && <div className="review-note score-note"><strong>评分口径</strong><p>法律红线优先扣分；履约影响按直接/间接程度计入；完善建议只作轻量扣分；低置信度事项会降低扣分权重。合同文本完整且保护机制齐全时可获得有限加分，100分仅表示当前规则覆盖下未发现需要扣分的事项。</p></div>}{comparison && <section className="comparison-panel"><div className="comparison-heading"><div><p className="eyebrow">版本对比</p><h4>当前合同 vs {comparisonName}</h4></div><button type="button" className="text-button" onClick={() => { setComparison(null); setComparisonName(''); }}>清除对比</button></div><div className="comparison-stats"><span>新增条款 <strong>{comparison.added.length}</strong></span><span>删除条款 <strong>{comparison.removed.length}</strong></span><span>修改条款 <strong>{comparison.changed.length}</strong></span></div><div className="comparison-columns"><div><b>新增</b>{comparison.added.slice(0, 3).map((item) => <p key={item}>{item}</p>)}</div><div><b>删除</b>{comparison.removed.slice(0, 3).map((item) => <p key={item}>{item}</p>)}</div><div><b>修改</b>{comparison.changed.slice(0, 3).map((item) => <p key={item.after}>{item.after}</p>)}</div></div></section>}{relatedCases.length > 0 && <section className="related-case-panel"><div className="related-case-heading"><div><p className="eyebrow">自动检索增强</p><h4>与当前风险相近的公开案例</h4></div><button type="button" className="text-button" onClick={() => setActiveTab('cases')}>查看案例库</button></div><p className="related-case-note">根据风险维度、规则标签和合同文本自动排序；案例只作类案参考，不直接替代法律依据。</p><div className="related-case-list">{relatedCases.map((item) => <a className="related-case-item" href={item.official_url} target="_blank" rel="noreferrer" key={item.id}><span>{item.authority_level || '公开裁判素材'} · 相关度 {item.score}</span><small className="case-match-reasons">匹配依据：{item.matchReasons.join('；')}</small><strong>{item.title}</strong><small>{item.summary}</small></a>)}</div></section>}<div className="finding-groups">{visibleGroups.map((group) => <section className={`finding-group finding-group-${group.key}`} key={group.key}><div className="finding-group-heading"><div><div className="finding-group-title"><span className={`group-dot ${severityClass[group.key === 'medium' ? 'medium' : group.key]}`} /><h4>{group.label}</h4></div><p>{group.description}</p></div><strong>{group.items.length}</strong></div>{group.items.length > 0 ? <div className="finding-list">{group.items.map((finding) => <article className="finding-card" key={finding.id}><div className="finding-topline"><span className={`risk-label ${severityClass[finding.severity]}`}>{severityLabel[finding.severity] || finding.severity}</span><span className="priority-chip">{finding.priority || 'P2'} · {finding.evidenceCertainty || '不足'}</span><span className={`disposition-chip ${dispositionClass[finding.disposition]}`}>{dispositionLabel[finding.disposition]} · 置信度{finding.confidence}</span><span className="finding-id">{finding.id} · {finding.dimension}{finding.ruleIds.length > 1 ? ` · ${finding.ruleIds.length}条规则已合并` : ''}</span></div><h4>{finding.title}</h4><p className="finding-message">{finding.message}</p><div className="finding-elements"><span className="small-label">条款要素</span><div>{finding.elements.map((element) => <span className={`element-chip element-${element.state}`} key={`${finding.id}-${element.label}`}>{element.label}：{element.state === 'found' ? element.example : '待补充'}</span>)}</div></div><div className="finding-evidence"><span className="small-label">证据状态</span><div>{finding.evidence.map((evidence) => <span className={`evidence-chip evidence-${evidence.state}`} key={(`${finding.id}-${evidence.label}`)}>{evidence.label}：{evidence.state === 'found' ? '已识别' : evidence.state === 'negated' ? '否定/待定' : evidence.state === 'conditional' ? '条件/例外' : '缺失'}</span>)}</div></div><div className="clause-quote"><span>命中/定位条款</span><p>{finding.clause}</p></div><div className="suggestion"><span>修改建议</span><p>{finding.recommendation}</p></div><div className="counter-proposal"><div className="counter-proposal-heading"><span>建议谈判条款</span><button type="button" className="text-button" onClick={() => copyProposal(finding)}>复制条款</button></div><p>{finding.counterProposal}</p></div><div className="finding-status-control"><span>整改状态</span><select value={remediationStatus[finding.id] || '待处理'} onChange={(event) => setRemediationStatus((current) => ({ ...current, [finding.id]: event.target.value }))}><option>待处理</option><option>复核中</option><option>已接受</option><option>已修改</option></select></div><div className="finding-bottom"><div><span className="small-label">法源依据</span>{finding.legalBasisStatus && <em className="source-status-chip">{finding.legalBasisStatus}</em>}{finding.basis.map((basis) => <span className="tag" key={basis.source_id}>{sources[basis.source_id]?.title || basis.source_id} {basis.articles.join('、')}</span>)}</div><div><span className="small-label">人工复核</span><ul>{finding.humanReview.map((item) => <li key={item}>{item}</li>)}</ul></div></div></article>)}</div> : <div className="finding-group-empty">暂无{group.label}项</div>}</section>)}</div></>}</div></div>}

        {activeTab === 'cases' && <div className="tab-content"><div className="section-heading"><div><p className="eyebrow">03 / 检索增强</p><h3>相似案例素材</h3></div><div className="search-box"><input value={caseQuery} onChange={(event) => setCaseQuery(event.target.value)} placeholder="搜索：验收 质保 解除…"/><span>⌕</span></div></div><p className="disclaimer">案例仅用于检索增强和规则验证，不用于未经授权的模型训练、微调或参数更新；页面显示的是公开检索候选池规模，不等同于去重核验后的案例数；页面级素材需打开官方来源核对完整事实。</p>{activeCatalog && <div className="case-corpus-card"><div><p className="eyebrow">当前场景公开检索池</p><h4>{activeCatalog.label}</h4><p>资料按官方来源、公开裁判文书和人工复核分层管理；重点用于事实识别、法源匹配、裁判规则验证和修改建议生成。候选命中量会先经过关联性、重复性、文书类型和效力状态筛选。</p></div><div className="case-corpus-stats"><strong>{activeCatalogScaleLabel}</strong><span>当前场景候选规模</span></div><small>{activeCatalog.collection_status}</small></div>}<div className="case-grid">{filteredCases.map((item) => <article className="case-card" key={item.id}><div className="case-meta"><span>{item.authority_level || '官方公开案例素材'}</span><span>{item.retrieval_only ? '检索验证样本' : '详细素材'}</span></div><h4>{item.title}</h4>{item.case_no && <p className="case-detail">{item.court || item.authority_level || '公开法院'} · {item.case_no}{item.decision_date ? ` · ${item.decision_date}` : ''}</p>}<p>{item.summary}</p>{item.holding_or_rule && <blockquote>{item.holding_or_rule}</blockquote>}<div className="case-tags">{(item.retrieval_tags || item.keywords || []).slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div><a href={item.official_url} target="_blank" rel="noreferrer">打开官方来源 ↗</a></article>)}</div></div>}

        {activeTab === 'sources' && <div className="tab-content"><div className="section-heading"><div><p className="eyebrow">04 / 引用与核验</p><h3>官方法规和标准来源</h3></div><span className="muted">优先国家法律法规数据库、最高人民法院、国务院/部委、全国人大及官方标准平台</span></div><p className="disclaimer source-disclaimer">法源展示规则：只有通过官方域名、具体条文映射、来源效力类型和适用范围校验的依据，才会进入风险卡片和导出表格；政策、推荐性标准、案例和宽泛章节仅作检索增强或待核验提示。</p><div className="source-list">{visibleSources.map((source) => <a className="source-row" href={source.official_url} target="_blank" rel="noreferrer" key={source.id}><div><span className="source-type">{source.source_type || '官方来源'}</span><h4>{source.title}</h4><p>{(source.issuing_body || source.issuer || '')} · {(source.effective_status || source.status || '请打开页面核验现行状态')}</p></div><span className="arrow">↗</span></a>)}</div></div>}
      </section>
      <footer className="footer"><span>新能源法务审查辅助程序 · MVP</span><span>自动化定位 ≠ 法律意见 · 关键结论需人工复核</span></footer>
    </main>
  );
}
