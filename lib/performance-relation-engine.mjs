const STAGES = [
  { id: 'delivery', label: '交付', terms: ['交付', '交货', '发货', '到货', '装车', '卸货', '运输', '风险转移'] },
  { id: 'acceptance', label: '验收', terms: ['验收', '检验', '性能测试', '性能试验', '试运行', '调试', '竣工', '并网试验'] },
  { id: 'payment', label: '付款', terms: ['付款', '支付', '预付款', '进度款', '到货款', '尾款', '结算', '质保金', '保留款'] },
  { id: 'warranty', label: '质保', terms: ['质保期', '保修', '缺陷责任期', '容量保持率', '衰减率', '故障响应'] },
  { id: 'remedy', label: '补救', terms: ['整改', '复验', '拒收', '更换', '维修', '退款', '违约金', '解除', '赔偿', '暂缓支付', '暂停付款'] },
];

const NEGATION_PREFIX = ['不', '未', '无须', '无需', '不得', '不应', '不予', '不能', '不会', '并非', '不再'];
const NEGATIVE_PHRASES = ['不设置', '未设置', '不约定', '未约定', '不提供', '未提供', '不提交', '未提交', '不承担', '未承担', '不负责', '未负责', '不进行', '未进行', '不另行安排', '未安排', '不以', '不得', '不应', '不予', '无需', '无须', '没有', '缺少'];
const NEGATIVE_SUFFIXES = ['均未约定', '均不约定', '不作约定', '未作约定', '均不设置', '均未设置', '不予适用'];

function normalise(value = '') {
  return String(value).replace(/\s+/g, '').toLowerCase();
}

function splitClauses(text = '') {
  return String(text)
    .split(/\n\s*\n|(?=第[一二三四五六七八九十百零]+条)|(?=\d{1,3}[、.])/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 10);
}

function includesAny(text, terms = []) {
  const value = normalise(text);
  return terms.some((term) => value.includes(normalise(term)));
}

function hasPositiveTerm(text, term) {
  const value = normalise(text);
  const target = normalise(term);
  let position = value.indexOf(target);
  while (position >= 0) {
    const rawPrefix = value.slice(Math.max(0, position - 48), position);
    const resetPositions = ['，', ',', '；', ';', '。', '.', '但', '但是', '同时', '并提供', '另行提供'].map((marker) => rawPrefix.lastIndexOf(marker));
    const prefix = rawPrefix.slice(Math.max(-1, ...resetPositions) + 1);
    const rawSuffix = value.slice(position + target.length, position + target.length + 48);
    const suffixBoundary = ['，', ',', '；', ';', '。', '.'].map((marker) => rawSuffix.indexOf(marker)).filter((index) => index >= 0);
    const suffix = suffixBoundary.length > 0 ? rawSuffix.slice(0, Math.min(...suffixBoundary)) : rawSuffix;
    const negated = NEGATIVE_PHRASES.some((phrase) => prefix.includes(normalise(phrase))) || NEGATIVE_SUFFIXES.some((phrase) => suffix.includes(normalise(phrase))) || NEGATION_PREFIX.some((marker) => prefix.endsWith(marker) || prefix.includes(`${marker}明确`) || prefix.includes(`${marker}自动`));
    if (!negated) return true;
    position = value.indexOf(target, position + target.length);
  }
  return false;
}

function hasPositiveAny(text, terms = []) {
  return terms.some((term) => hasPositiveTerm(text, term));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function stageForPaymentSegment(segment) {
  if (includesAny(segment, ['验收合格', '性能测试合格', '性能试验合格', '试运行合格', '竣工验收', '并网验收'])) return 4;
  if (includesAny(segment, ['调试完成', '安装完成'])) return 3;
  if (includesAny(segment, ['到货', '交付', '签收'])) return 2;
  if (includesAny(segment, ['发货', '出厂', '装车', '开票', '发票'])) return 1;
  if (includesAny(segment, ['合同生效', '签约', '预付款'])) return 0;
  if (includesAny(segment, ['质保期满', '缺陷责任期满', '质保金'])) return 5;
  return 3;
}

function paymentExposure(paymentClauses) {
  let percentageBeforeAcceptance = 0;
  let hasPercentage = false;
  for (const clause of paymentClauses) {
    const segments = clause.split(/[，,；;。]/u).map((item) => item.trim()).filter(Boolean);
    for (const segment of segments) {
      const matches = [...segment.matchAll(/(\d+(?:\.\d+)?)\s*%/g)];
      if (matches.length === 0) continue;
      hasPercentage = true;
      const stage = stageForPaymentSegment(segment);
      if (stage < 4) percentageBeforeAcceptance += matches.reduce((sum, match) => sum + Number(match[1]), 0);
    }
  }
  return { hasPercentage, percentageBeforeAcceptance: Math.min(100, percentageBeforeAcceptance) };
}

function relationFinding({ id, dimension, title, severity = 'medium', priority = 'P1', confidence = '中', certainty = '充分', score = 58, message, recommendation, clauses, evidence, path, tags = [] }) {
  return {
    id,
    dimension,
    title,
    severity,
    priority,
    confidence,
    evidenceCertainty: certainty,
    materialityScore: score,
    message,
    recommendation,
    clause: unique(clauses).join('；').slice(0, 1800),
    evidence,
    relationPath: path,
    caseTags: unique([...tags, ...path, '跨条款关系']),
    humanReview: ['人工核对各节点对应的合同正文、技术协议、订单和签署附件', '结合付款比例、履行顺序、担保措施和项目实际流程确认风险是否成立'],
  };
}

export function buildPerformanceRelationGraph(text = '') {
  const clauses = splitClauses(text);
  const nodes = [];
  for (const [clauseIndex, clause] of clauses.entries()) {
    for (const stage of STAGES) {
      const matchedTerms = stage.terms.filter((term) => hasPositiveTerm(clause, term));
      if (matchedTerms.length === 0) continue;
      nodes.push({
        id: `${stage.id}-${clauseIndex + 1}`,
        stage: stage.id,
        label: stage.label,
        clauseIndex,
        clause,
        matchedTerms: unique(matchedTerms),
      });
    }
  }

  const byStage = Object.fromEntries(STAGES.map((stage) => [stage.id, nodes.filter((node) => node.stage === stage.id)]));
  const stageText = (stage) => (byStage[stage] || []).map((node) => node.clause).join('；');
  const deliveryText = stageText('delivery');
  const acceptanceText = stageText('acceptance');
  const paymentText = stageText('payment');
  const warrantyText = stageText('warranty');
  const remedyText = stageText('remedy');
  const full = clauses.join('；');
  const edges = [];

  if (deliveryText && acceptanceText) edges.push({ from: 'delivery', to: 'acceptance', label: '交付后进入检验/验收', status: 'identified' });
  if (acceptanceText && paymentText) {
    const linked = hasPositiveAny(paymentText, ['验收合格后', '性能测试合格后', '性能试验合格后', '试运行合格后', '竣工验收后', '并网验收后']);
    edges.push({ from: 'acceptance', to: 'payment', label: linked ? '验收结果已作为付款条件' : '付款与验收条件需要核对', status: linked ? 'protected' : 'review' });
  }
  if (acceptanceText && warrantyText) {
    const linked = hasPositiveAny(warrantyText, ['自验收合格之日', '自验收合格', '验收合格后', '自投运之日', '并网投运后']);
    edges.push({ from: 'acceptance', to: 'warranty', label: linked ? '质保起算已衔接验收/投运' : '质保起算与验收关系需要核对', status: linked ? 'protected' : 'review' });
  }
  if (warrantyText && remedyText) edges.push({ from: 'warranty', to: 'remedy', label: '缺陷责任与维修/更换安排', status: 'identified' });

  const findings = [];
  const paymentProtection = hasPositiveAny(paymentText, ['验收合格后', '性能测试合格后', '性能试验合格后', '试运行合格后', '质保金', '保留款', '付款保函', '履约保函', '质量保函', '暂缓支付', '暂停支付', '有权扣减', '有权抵销']);
  const earlyCompletion = hasPositiveAny(paymentText, ['发货后付清', '到货后付清', '交付后付清', '开票后付清', '收到发票后付清', '支付全部价款', '支付剩余全部价款', '支付100%']);
  const exposure = paymentExposure(byStage.payment.map((node) => node.clause));
  const earlyPercentage = exposure.hasPercentage && exposure.percentageBeforeAcceptance >= 90;
  if (acceptanceText && paymentText && (earlyCompletion || earlyPercentage) && !paymentProtection) {
    findings.push(relationFinding({
      id: 'REL-PAY-001', dimension: '付款—验收关系', title: '大部分或全部价款可能在可验证验收前支付',
      score: earlyPercentage && exposure.percentageBeforeAcceptance >= 100 ? 66 : 60,
      message: `履约关系图显示，付款节点在验收、性能测试或试运行形成可验证结果前已接近或达到全部价款${earlyPercentage ? `（识别到验收前累计约${exposure.percentageBeforeAcceptance}%）` : ''}，且未识别到质保金、保留款或暂停支付机制。这属于资金暴露和履约保障风险，不直接等同于违法。`,
      recommendation: '将尾款、质保金或保函释放条件与阶段验收、性能测试、资料交付、缺陷整改和复验结果挂钩，并保留争议款暂缓支付权。',
      clauses: [...byStage.payment.map((node) => node.clause), ...byStage.acceptance.map((node) => node.clause)],
      evidence: [
        { label: '付款节点', state: 'found', examples: byStage.payment.map((node) => node.clause).slice(0, 2) },
        { label: '验收节点', state: 'found', examples: byStage.acceptance.map((node) => node.clause).slice(0, 2) },
        { label: '付款保障', state: 'missing', examples: [] },
      ], path: ['付款', '验收', '资金保障'], tags: ['付款比例', '质保金'],
    }));
  }

  const deemedAcceptanceTerms = ['未提出异议视为验收合格', '逾期未提出异议视为合格', '未签字视为验收合格', '自动视为验收合格', '自动视为全部验收合格', '视为全部验收合格', '未提出异议即视为', '未书面提出异议即', '到货即视为验收合格'];
  const deemedAcceptance = hasPositiveAny(acceptanceText, deemedAcceptanceTerms);
  const performanceVerification = includesAny(full, ['性能测试', '性能试验', '试运行', '容量保持率', '可用率', '发电量保证', '性能保证']);
  const hiddenDefectProtection = hasPositiveAny(acceptanceText, ['隐蔽瑕疵除外', '潜在缺陷除外', '不影响质量索赔', '不影响质保责任', '不视为放弃质量异议']);
  if (deemedAcceptance && performanceVerification && !hiddenDefectProtection) {
    findings.push(relationFinding({
      id: 'REL-ACC-001', dimension: '验收—性能关系', title: '默示验收可能提前切断性能验证和质量异议',
      score: 64, confidence: '高',
      message: '合同存在逾期或到货即视为验收合格的安排，同时交易又涉及性能测试、试运行或长期性能指标，但未识别到隐蔽瑕疵、潜在缺陷或持续质保例外，可能影响付款、质量异议和举证。',
      recommendation: '区分到货检验、安装调试、性能验收和最终验收；默示验收仅限外观、数量等可即时检验事项，并明确不影响隐蔽瑕疵、性能保证和质保索赔。',
      clauses: byStage.acceptance.map((node) => node.clause),
      evidence: [
        { label: '默示验收', state: 'found', examples: byStage.acceptance.map((node) => node.clause).filter((clause) => includesAny(clause, deemedAcceptanceTerms)).slice(0, 2) },
        { label: '性能验证', state: 'found', examples: byStage.acceptance.map((node) => node.clause).filter((clause) => includesAny(clause, ['性能', '试运行'])).slice(0, 2) },
        { label: '隐蔽瑕疵例外', state: 'missing', examples: [] },
      ], path: ['交付', '验收', '性能测试', '质量异议'], tags: ['默示验收', '隐蔽瑕疵'],
    }));
  }

  const explicitRemedyExclusion = includesAny(full, ['不进行复验', '不另行复验', '不负责整改', '不承担更换责任', '不得拒收', '性能不达标不影响付款', '验收不合格不影响付款', '不得暂停付款']);
  const acceptanceRemedyText = clauses.filter((clause) => includesAny(clause, ['不合格', '不达标', '验收失败', '验收未通过', '试验失败', '检测失败']) && includesAny(clause, ['整改', '复验', '拒收', '更换', '降价', '退款', '解除', '暂停付款', '暂缓支付', '性能违约金'])).join('；');
  const globalRemedyCoverage = includesAny(full, ['责任、补救', '责任和补救', '补救和责任']) && includesAny(full, ['验收']) && hasPositiveAny(full, ['整改', '复验', '拒收', '更换', '解除', '违约金']);
  const acceptanceRemedies = hasPositiveAny(acceptanceRemedyText, ['整改', '复验', '拒收', '更换', '降价', '退款', '解除', '暂停付款', '暂缓支付', '性能违约金']) || globalRemedyCoverage;
  const acceptanceVerification = performanceVerification || includesAny(acceptanceText, ['验收', '检测', '检验', '抽样', '试验']);
  const acceptanceFailureMentioned = includesAny(full, ['不合格', '不达标', '验收失败', '验收未通过', '试验失败', '检测失败']);
  if (acceptanceText && acceptanceVerification && !acceptanceRemedies && (explicitRemedyExclusion || acceptanceFailureMentioned)) {
    findings.push(relationFinding({
      id: 'REL-ACC-002', dimension: '验收—补救关系', title: '性能或验收不合格后的补救闭环不完整',
      severity: explicitRemedyExclusion ? 'medium' : 'low', priority: explicitRemedyExclusion ? 'P1' : 'P2', confidence: explicitRemedyExclusion ? '高' : '中', certainty: explicitRemedyExclusion ? '充分' : '部分', score: explicitRemedyExclusion ? 60 : 46,
      message: `${explicitRemedyExclusion ? '合同明确排除了部分复验、整改、拒收或暂停付款权利。' : '合同识别到性能/验收节点，但未识别到完整的整改、复验、拒收、更换或解除安排。'}该问题可能削弱验收失败后的实际救济，但需结合技术协议和附件复核。`,
      recommendation: '建立“不合格通知—整改期限—复验—费用承担—再次不合格—更换/退货/降价/解除—暂停付款”的完整闭环。',
      clauses: [...byStage.acceptance.map((node) => node.clause), ...byStage.remedy.map((node) => node.clause)],
      evidence: [
        { label: '性能/验收节点', state: 'found', examples: byStage.acceptance.map((node) => node.clause).slice(0, 2) },
        { label: '不合格补救', state: explicitRemedyExclusion ? 'negated' : 'missing', examples: explicitRemedyExclusion ? clauses.filter((clause) => includesAny(clause, ['不复验', '不整改', '不得拒收', '不影响付款', '不得暂停付款'])).slice(0, 2) : [] },
      ], path: ['验收', '不合格', '整改/复验', '解除/付款'], tags: ['复验', '救济闭环'],
    }));
  }

  const sellerControlsTransport = hasPositiveAny(deliveryText, ['乙方负责运输', '卖方负责运输', '供应商负责运输', '承包方负责运输', '乙方安排运输', '乙方选择承运人', '乙方统一选择承运人', '乙方负责选择物流商']) || (includesAny(deliveryText, ['乙方']) && hasPositiveAny(deliveryText, ['安排运输', '选择承运人', '选择物流商']));
  const earlyRiskTransfer = hasPositiveAny(deliveryText, ['出厂时风险转移', '发货时风险转移', '装车时风险转移', '装车后风险转移', '自出厂时起风险转移', '自装车时起风险转移']) || (includesAny(deliveryText, ['风险', '转移']) && hasPositiveAny(deliveryText, ['出厂时', '发货时', '装车时', '装车后']));
  const transportProtection = hasPositiveAny(deliveryText, ['乙方投保运输险', '卖方投保运输险', '货物运输险由乙方', '运输风险由乙方承担至到货', '风险在卸货后转移']);
  if (sellerControlsTransport && earlyRiskTransfer && !transportProtection) {
    findings.push(relationFinding({
      id: 'REL-DEL-001', dimension: '交付—风险转移关系', title: '风险转移早于供应商控制的运输履行完成',
      score: 61, confidence: '高',
      message: '合同由供应商组织运输，但毁损灭失风险在出厂、发货或装车时即转移，且未识别到由供应商承担至到货的运输风险或明确保险保障，可能导致控制运输的一方与承担风险的一方分离。',
      recommendation: '将风险转移设在项目现场完成卸货或约定交付后；如商业上坚持提前转移，应明确承运人选择、运输保险、受益人、理赔协助和损失承担。',
      clauses: byStage.delivery.map((node) => node.clause),
      evidence: [
        { label: '运输控制', state: 'found', examples: byStage.delivery.map((node) => node.clause).filter((clause) => includesAny(clause, ['乙方负责运输', '卖方负责运输', '供应商负责运输'])).slice(0, 2) },
        { label: '提前风险转移', state: 'found', examples: byStage.delivery.map((node) => node.clause).filter((clause) => includesAny(clause, ['出厂时风险转移', '发货时风险转移', '装车时风险转移'])).slice(0, 2) },
        { label: '运输保险/风险保障', state: 'missing', examples: [] },
      ], path: ['运输控制', '风险转移', '到货/卸货', '保险'], tags: ['毁损灭失', '运输保险'],
    }));
  }

  const earlyWarrantyStart = hasPositiveAny(warrantyText, ['自出厂之日', '自设备出厂之日', '自发货之日', '自设备发货之日', '自到货之日', '自设备到货之日', '自货物到达', '自交付之日', '自设备交付之日', '出厂日起', '发货日起', '到货日起']);
  const acceptanceWarrantyStart = hasPositiveAny(warrantyText, ['自验收合格之日', '验收合格日起', '验收合格后', '自投运之日', '并网投运后', '以较晚者为准', '孰晚']);
  if (warrantyText && acceptanceText && earlyWarrantyStart && !acceptanceWarrantyStart) {
    findings.push(relationFinding({
      id: 'REL-WAR-001', dimension: '验收—质保关系', title: '质保期可能在验收或投运前提前消耗',
      score: 57, confidence: '高',
      message: '合同将质保期从出厂、发货、到货或交付时起算，但另有安装调试、性能验收或投运节点，可能导致设备尚未完成验证时质保期已经开始消耗。',
      recommendation: '质保期宜自最终验收合格或商业运行之日起算；存在到货与投运间隔时，可约定两个起算节点孰晚或设置最长截止期限。',
      clauses: [...byStage.acceptance.map((node) => node.clause), ...byStage.warranty.map((node) => node.clause)],
      evidence: [
        { label: '验收/投运节点', state: 'found', examples: byStage.acceptance.map((node) => node.clause).slice(0, 2) },
        { label: '提前质保起算', state: 'found', examples: byStage.warranty.map((node) => node.clause).slice(0, 2) },
        { label: '孰晚保护', state: 'missing', examples: [] },
      ], path: ['验收/投运', '质保起算', '质保到期'], tags: ['质保期起算'],
    }));
  }

  const replacementMentioned = hasPositiveAny(warrantyText, ['更换', '替换', '换货']);
  const noWarrantyRestart = includesAny(warrantyText, ['更换后质保期不重新计算', '更换后质保不重新起算', '维修后质保期不顺延', '更换后仍按原质保期', '维修更换不延长质保期']);
  if (warrantyText && replacementMentioned && noWarrantyRestart) {
    findings.push(relationFinding({
      id: 'REL-WAR-002', dimension: '质保—更换关系', title: '维修或更换后的质保期被明确排除重新起算',
      score: 54, confidence: '高',
      message: '合同虽约定维修或更换，但明确规定更换部件仍沿用原质保期或不顺延，可能导致临近质保期末更换的核心部件缺乏合理保障。',
      recommendation: '对维修、更换的设备或核心部件约定不少于原剩余质保期与重新起算期限中的较长者，并保留重复故障升级救济。',
      clauses: byStage.warranty.map((node) => node.clause),
      evidence: [
        { label: '维修/更换', state: 'found', examples: byStage.warranty.map((node) => node.clause).slice(0, 2) },
        { label: '质保重新起算', state: 'negated', examples: byStage.warranty.map((node) => node.clause).filter((clause) => includesAny(clause, ['不重新', '不顺延', '不延长', '原质保期'])).slice(0, 2) },
      ], path: ['缺陷', '维修/更换', '质保重新起算'], tags: ['更换后质保'],
    }));
  }

  const paymentBlockedDespiteDispute = includesAny(full, ['质量争议不影响付款', '验收争议不影响付款', '性能不达标不影响付款', '不得暂停付款', '不得拒付', '无权抵销', '不得抵销']) || clauses.some((clause) => includesAny(clause, ['质量', '验收', '性能', '检测', '缺陷', '索赔']) && ((includesAny(clause, ['不影响']) && includesAny(clause, ['付款', '支付'])) || includesAny(clause, ['不得暂停', '不得拒付', '无权抵销', '不得抵销'])));
  const qualityOrAcceptanceDispute = includesAny(full, ['质量', '验收', '性能', '缺陷', '索赔']);
  if (paymentText && qualityOrAcceptanceDispute && paymentBlockedDespiteDispute) {
    findings.push(relationFinding({
      id: 'REL-PAY-002', dimension: '质量争议—付款关系', title: '质量或验收争议被排除暂停付款或抵销',
      score: 59, confidence: '高',
      message: '合同明确规定质量、验收或性能争议不影响付款，或排除了暂停付款、拒付和抵销权，可能使付款义务与供应商纠正履约缺陷脱钩。',
      recommendation: '明确无争议款正常支付，争议款可在书面通知并提供初步证据后暂缓；同时约定核验、整改、复验和争议解决期限。',
      clauses: [...byStage.payment.map((node) => node.clause), ...byStage.acceptance.map((node) => node.clause)],
      evidence: [
        { label: '质量/验收争议', state: 'found', examples: clauses.filter((clause) => includesAny(clause, ['质量', '验收', '性能', '缺陷'])).slice(0, 2) },
        { label: '暂停付款/抵销权', state: 'negated', examples: clauses.filter((clause) => includesAny(clause, ['不影响付款', '不得暂停付款', '不得拒付', '无权抵销', '不得抵销'])).slice(0, 2) },
      ], path: ['质量/验收争议', '付款', '整改/抵销'], tags: ['争议款', '抵销'],
    }));
  }

  return {
    version: '1.0.0',
    stages: STAGES.map(({ id, label }) => ({ id, label })),
    nodes,
    edges,
    findings,
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      findingCount: findings.length,
      stageCounts: Object.fromEntries(STAGES.map((stage) => [stage.id, byStage[stage.id].length])),
    },
    diagnostics: {
      paymentProtection,
      earlyCompletion,
      earlyPercentage,
      percentageBeforeAcceptance: exposure.percentageBeforeAcceptance,
      deemedAcceptance,
      performanceVerification,
      acceptanceVerification,
      acceptanceRemedies,
      globalRemedyCoverage,
      acceptanceFailureMentioned,
      sellerControlsTransport,
      earlyRiskTransfer,
      transportProtection,
      earlyWarrantyStart,
      acceptanceWarrantyStart,
      paymentBlockedDespiteDispute,
    },
  };
}
