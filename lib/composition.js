// "내 학습지 구성": 주제(섹션) 안 활동의 "역할"·이름·순서와 교사 작성 칸(기출·수능특강 등)
//
// 역할(type)은 수학 교과서의 흐름을 따릅니다.
//   도입 문항 → (간단한 설명) → 개념 도입을 위한 구체적 예시 → 개념 정리 → 확인하기 → 예제 → 문제·유제 → 생각해보기
// 이름(title)은 학습지에 찍히는 글자일 뿐이고, AI가 무엇을 넣을지는 역할로 정해집니다.
//   source(생각해보기): ai(교과서 개념을 바탕으로 AI가 작성) | teacher(빈 칸, 교사가 직접)
//   amount(확인하기·예제·문제): all(교과서 문항 전부) | some(대표 문항만)

export const ACTIVITY_TYPES = {
  intro: '생각열기 (도입 문항)',
  lead: '개념 도입 (구체적 예시와 설명)',
  concept: '핵심 개념 (정의·성질·기호)',
  check: '확인 문제 (바로 적용하는 짧은 문항)',
  example: '예제 (풀이가 실린 문제)',
  strategy: '풀이 전략 (방법 정리)',
  exercise: '유제 또는 문제',
  think: '생각해보기·탐구해보기',
  challenge: '실전 문제 (응용·서술형·중단원 마무리)',
};

// 교과서 어디에서 가져오는지 (편집 화면 설명용)
export const ACTIVITY_HELP = {
  intro: '교과서의 생각 열기·도입 질문, 채워 볼 표나 그래프',
  lead: '개념을 끌어내는 구체적 예시와 그 설명(예: 두 함수의 그래프 비교, 식 변형)',
  concept: '정의·성질·기호를 정리, 핵심 용어만 빈칸',
  check: '교과서 "확인하기"·[예시]처럼 바로 답하는 짧은 문항',
  example: '교과서 "예제"와 그 풀이',
  strategy: '예제 풀이에서 드러나는 방법·순서',
  exercise: '교과서 "문제"·"유제"·스스로 확인하기',
  think: '생각을 넓히는 질문·탐구 활동(교과서 활동 또는 AI/교사 작성)',
  challenge: '교과서의 실력 다지기·중단원 마무리·서술형처럼 여러 개념을 쓰는 응용 문제',
};

export const DEFAULT_COMPOSITION = {
  v: 8,
  activities: [
    { type: 'intro', title: '생각열기', use: true },
    { type: 'lead', title: '개념 도입', use: true },
    { type: 'concept', title: '핵심 개념', use: true },
    { type: 'check', title: '확인 문제', use: true, amount: 'all' },
    { type: 'example', title: '예제', use: true, amount: 'all' },
    { type: 'strategy', title: '풀이 전략', use: false },
    { type: 'exercise', title: '유제', use: true, amount: 'all' },
    { type: 'think', title: '생각해보기', use: true, source: 'ai' },
    { type: 'challenge', title: '실전 문제', use: false, amount: 'some' },
  ],
  thinkPlace: 'section', // section: 주제마다 / lesson: 차시 끝에 한 번
  practice: {
    enabled: true,
    items: [
      { label: '기출문제', count: 2 },
      { label: '수능특강', count: 2 },
    ],
    perPage: 4,
    columns: ['자신의 풀이', '교사의 풀이'],
  },
  pagesPerLesson: 2,
  notes: '',
};

// 예전(v7 이하) 역할 이름
const OLD_TYPES = { explore: 'intro', problems: 'exercise' };
const HAS_AMOUNT = new Set(['check', 'example', 'exercise', 'challenge']);

// 학습 내용(단원명·주제)처럼 보이는 이름인지: 구성 분석이 단원명을 활동 이름으로 잘못 읽는 경우를 거름
const CONTENT_WORDS = /함수|극한|미분|적분|수열|확률|통계|방정식|부등식|도형|벡터|삼각|지수|로그|활용|넓이|부피|속도|연속|급수|집합|명제|행렬|이차|일차|다항|수렴|발산|그래프|경우의 수|순열|조합/;
export function looksLikeContent(title) {
  const t = String(title || '').replace(/[\[\]()（）]/g, '');
  if (!t.trim()) return false;
  if (/^(문제|예제|유제|확인|생각|탐구|도입|개념|정리|풀이|전략|예시|활동|실전|핵심|열기)/.test(t.trim())) return false;
  return CONTENT_WORDS.test(t) || t.length > 14;
}

export function normalizeComposition(raw) {
  const d = DEFAULT_COMPOSITION;
  const src = raw && typeof raw === 'object' ? raw : {};
  const old = src.v !== 8 && Array.isArray(src.activities) && src.activities.some((a) => OLD_TYPES[a?.type]);
  let acts = Array.isArray(src.activities) && src.activities.length ? src.activities : d.activities;
  if (old) {
    // v7 이하 구성: 역할이 섞여 있을 수 있어 기본 흐름으로 바꾸고, 생각해보기·확인 이름과 설정만 이어받음
    const think = src.activities.find((a) => a?.type === 'think');
    const check = src.activities.find((a) => a?.type === 'check');
    acts = d.activities.map((a) => {
      if (a.type === 'think' && think) return { ...a, title: think.title || a.title, use: think.use !== false, source: think.source === 'teacher' ? 'teacher' : 'ai' };
      if (a.type === 'check' && check && check.title && !looksLikeContent(check.title)) return { ...a, title: check.title, use: check.use !== false };
      return a;
    });
  }
  const seen = new Set();
  const activities = acts
    .map((a) => {
      const type = ACTIVITY_TYPES[a?.type] ? a.type : OLD_TYPES[a?.type] || null;
      if (!type || seen.has(type)) return null;
      seen.add(type);
      const def = d.activities.find((x) => x.type === type);
      // "개념 정리(네모 빈칸)"처럼 괄호 설명이 붙은 이름은 이름과 특징으로 나눔
      let title = String(a.title || def.title).trim();
      let style = String(a.style || '').trim();
      const m = title.match(/^(.+?)\s*[(（]([^()（）]+)[)）]\s*$/);
      if (m && m[1].trim()) {
        title = m[1].trim();
        style = style || m[2].trim();
      }
      if (looksLikeContent(title)) title = def.title;
      if (type === 'intro' && title === '도입') title = '생각열기'; // 예전 기본 이름
      const out = {
        type,
        title: title.slice(0, 20) || def.title,
        style: style.slice(0, 30),
        use: a.use !== false,
        evidence: String(a.evidence || '').slice(0, 80),
      };
      if (HAS_AMOUNT.has(type)) out.amount = a.amount === 'some' ? 'some' : 'all';
      if (type === 'think') out.source = a.source === 'teacher' ? 'teacher' : 'ai';
      return out;
    })
    .filter(Boolean);
  // 빠진 역할은 꺼진 상태로 알맞은 자리에 넣어 편집할 수 있게 함
  const order = d.activities.map((a) => a.type);
  for (const def of d.activities) {
    if (activities.some((a) => a.type === def.type)) continue;
    const item = { ...def, use: false, style: '', evidence: '' };
    const idx = order.indexOf(def.type);
    const after = activities.findIndex((a) => order.indexOf(a.type) > idx);
    if (after < 0) activities.push(item);
    else activities.splice(after, 0, item);
  }
  const pr = src.practice && typeof src.practice === 'object' ? src.practice : d.practice;
  const items = (Array.isArray(pr.items) ? pr.items : d.practice.items)
    .map((it) => ({ label: String(it?.label || '').trim().slice(0, 16), count: Math.max(0, Math.min(8, parseInt(it?.count, 10) || 0)) }))
    .filter((it) => it.label);
  const cols = Array.isArray(pr.columns) && pr.columns.length ? pr.columns.map((c) => String(c).slice(0, 12)).slice(0, 3) : d.practice.columns;
  return {
    v: 8,
    activities,
    thinkPlace: src.thinkPlace === 'lesson' ? 'lesson' : 'section',
    practice: {
      enabled: pr.enabled !== false && items.some((i) => i.count > 0),
      items,
      perPage: Math.max(2, Math.min(5, parseInt(pr.perPage, 10) || 4)),
      columns: cols,
    },
    pagesPerLesson: 2,
    notes: String(src.notes || '').slice(0, 600),
  };
}

const ROLE_RULE = {
  intro: '교과서의 생각 열기·도입 질문을 옮긴다. 채워 볼 표·그래프가 있으면 표는 table로, 학생이 채울 값만 빈칸. 정의는 넣지 않는다.',
  lead: '개념을 끌어내는 교과서의 구체적 예시와 설명을 교과서 흐름대로 옮긴다(예시 함수, 그래프 해석, 식 변형은 $$...$$ 한 줄씩). 빈칸은 결론 값 1~2개만.',
  concept: '정의·성질·기호를 정리한다. 빈칸은 꼭 기억할 핵심 용어·기호에만, 블록당 최대 3개.',
  check: '교과서 "확인하기"·본문 [예시]처럼 정의를 바로 적용하는 짧은 문항. 정답은 빈칸 [[ ]]으로.',
  example: '교과서 "예제"를 글자 그대로 옮기고, sol에 교과서 풀이의 핵심을 쓴다.',
  strategy: '예제 풀이에서 드러나는 방법·판단 순서를 ①②③으로 정리한다(새 수학 내용 금지).',
  exercise: '교과서 "문제"·"유제"·"스스로 확인하기"를 글자 그대로 옮긴다.',
  think: '',
  challenge: '교과서의 실력 다지기·중단원 마무리·서술형처럼 여러 개념을 함께 쓰는 응용 문제를 글자 그대로 옮긴다(그 차시 내용으로 풀 수 있는 것만). 넉넉한 풀이 공간(space "l").',
};

// AI 지시문용 요약
export function describeComposition(c) {
  const lines = [];
  const used = c.activities.filter((a) => a.use);
  lines.push('주제(섹션) 안에서 쓰는 역할과 학습지에 찍힐 이름 (교과서에 그 요소가 있을 때만, 교과서 흐름 순서대로 넣는다):');
  used.forEach((a, i) => {
    let how = ROLE_RULE[a.type] || '';
    if (a.type === 'think')
      how =
        a.source === 'teacher'
          ? '교사가 직접 채우는 칸이므로 만들지 말 것(앱이 빈 칸을 넣음).'
          : '교과서의 생각 넓히기 활동이 있으면 우선 옮기고, 없으면 지도서의 지도 방향이나 그 섹션 개념을 바탕으로 깊이 생각하게 하는 질문 1개를 작성.';
    if (a.amount === 'some') how += ' 교과서 문항 중 대표 문항만 넣는다(묶음마다 1~2개, 소문항은 절반 정도).';
    else if (a.amount === 'all') how += ' 교과서 문항을 모두 넣는다.';
    lines.push(`  ${i + 1}. type="${a.type}" 이름="${a.title}"${a.style ? ` (특징: ${a.style})` : ''} — ${how}`);
  });
  const think = used.find((a) => a.type === 'think');
  if (think && think.source !== 'teacher') lines.push(c.thinkPlace === 'lesson' ? `- "${think.title}"는 차시의 마지막 주제에만 한 번 넣는다.` : `- "${think.title}"는 주제마다 하나씩 넣는다.`);
  const off = c.activities.filter((a) => !a.use);
  if (off.length) {
    lines.push(`- 사용하지 않는 역할: ${off.map((a) => a.type).join(', ')} (만들지 말 것)`);
    if (off.some((a) => a.type === 'lead') && used.some((a) => a.type === 'concept'))
      lines.push('  · lead를 쓰지 않으므로, 개념 도입 예시는 concept 첫 항목에 1~2문장으로만 요약한다.');
  }
  return lines.join('\n');
}
