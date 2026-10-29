// AI가 만든 학습지 JSON을 앱에서 쓰는 형태로 정리합니다.
// 빠진 값은 기본값으로 채우고, 모르는 블록 종류는 가장 가까운 종류로 바꿉니다.

const str = (v) => (v === undefined || v === null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const richList = (v) => arr(v).map(str).filter((s) => s.trim());

const TYPE_ALIASES = {
  intro: 'explore', explore: 'explore', 탐구: 'explore', 도입: 'explore', activity: 'explore', text: 'explore', paragraph: 'explore',
  lead: 'explore', motivation: 'explore', illustration: 'explore',
  concept: 'concept', definition: 'concept', 개념: 'concept', theorem: 'concept', property: 'concept',
  check: 'check', 예시: 'check', quiz: 'check', 확인하기: 'check',
  strategy: 'strategy', method: 'strategy', tip: 'strategy', 전략: 'strategy', summary: 'strategy',
  table: 'table', compare: 'table',
  example: 'problems', 예제: 'problems', challenge: 'problems', 실전: 'problems',
  problems: 'problems', problem: 'problems', exercise: 'problems', exercises: 'problems', 문제: 'problems', 유제: 'problems',
  think: 'think', 생각해보기: 'think', discussion: 'think', inquiry: 'think',
  review: 'review',
};
// 블록 종류 + 역할(구성의 type): 도입(intro)·개념 도입 예시(lead)는 explore, 예제(example)·문제(exercise)는 problems
const ROLE_OF = { challenge: 'challenge', 실전: 'challenge', intro: 'intro', explore: 'intro', 탐구: 'intro', 도입: 'intro', lead: 'lead', motivation: 'lead', illustration: 'lead', example: 'example', 예제: 'example', exercise: 'exercise', exercises: 'exercise', problems: 'exercise', problem: 'exercise', 문제: 'exercise', 유제: 'exercise' };
const ROLES_FOR = { explore: ['intro', 'lead'], problems: ['example', 'exercise', 'challenge'] };
export function roleOf(b) {
  if (ROLES_FOR[b.type]) return ROLES_FOR[b.type].includes(b.role) ? b.role : ROLES_FOR[b.type][0] === 'intro' ? 'intro' : /예제/.test(b.label || '') ? 'example' : 'exercise';
  return b.type;
}
function normTable(t) {
  if (!t || typeof t !== 'object') return null;
  const header = richList(t.header);
  const rows = arr(t.rows).map((r) => arr(r).map(str)).filter((r) => r.length);
  return header.length || rows.length ? { header, rows } : null;
}

function normFigureRefs(b) {
  const ids = [...arr(b.figure), ...arr(b.figures)].map(str).filter(Boolean);
  return [...new Set(ids)];
}

const NOTE_KINDS = { tip: 'tip', 지도: 'tip', guide: 'tip', caution: 'caution', warning: 'caution', 주의: 'caution', misconception: 'caution', extend: 'extend', extension: 'extend', 확장: 'extend', advanced: 'advanced', 심화: 'advanced', reference: 'advanced', 참고: 'advanced' };
// 교사용 코멘트 [{kind, text}]
function normNotes(v) {
  return arr(v)
    .map((n) => {
      if (typeof n === 'string') return n.trim() ? { kind: 'tip', text: n.trim() } : null;
      if (!n || typeof n !== 'object') return null;
      const text = str(n.text ?? n.note ?? n.content).trim();
      if (!text) return null;
      return { kind: NOTE_KINDS[str(n.kind ?? n.type).trim().toLowerCase()] || NOTE_KINDS[str(n.kind ?? n.type).trim()] || 'tip', text };
    })
    .filter(Boolean)
    .slice(0, 4);
}

function normBlock(raw, counters) {
  const b = normBlockInner(raw, counters);
  if (b) b.tnotes = normNotes(raw.tnotes ?? raw.teacherNotes ?? raw.notesForTeacher);
  return b;
}

function normBlockInner(raw, counters) {
  if (!raw || typeof raw !== 'object') return null;
  const rawType = str(raw.type).trim();
  const type = TYPE_ALIASES[rawType] || TYPE_ALIASES[rawType.toLowerCase()] || 'explore';
  const role0 = str(raw.role).trim() || ROLE_OF[rawType] || ROLE_OF[rawType.toLowerCase()] || '';
  const table = normTable(raw.table);
  const figures = normFigureRefs(raw);
  const cols = Math.max(1, Math.min(3, parseInt(raw.cols, 10) || 0));
  switch (type) {
    case 'explore': {
      const role = ROLES_FOR.explore.includes(role0) ? role0 : 'intro';
      return { type, role, title: str(raw.title), items: richList(raw.items ?? raw.text ?? raw.content), table, figures };
    }
    case 'concept':
      return { type, title: str(raw.title), items: richList(raw.items ?? raw.text), note: str(raw.note), table, figures };
    case 'check':
      return { type, title: str(raw.title) || '개념 확인', source: str(raw.source), items: richList(raw.items), cols: cols || 2, table, figures };
    case 'strategy':
      return { type, title: str(raw.title), items: richList(raw.items), tip: str(raw.tip), figures };
    case 'table':
      return {
        type,
        title: str(raw.title),
        header: richList(raw.header),
        rows: arr(raw.rows).map((r) => arr(r).map(str)),
        figures,
      };
    case 'problems': {
      const items = arr(raw.items).map((it) => {
        const o = typeof it === 'object' && it ? it : { q: str(it) };
        counters.q += 1;
        return { id: `q${counters.q}`, q: str(o.q ?? o.question ?? o.text), a: str(o.a ?? o.answer), sol: str(o.sol ?? o.solution ?? o.explanation), tip: str(o.tip ?? o.teacherTip), figures: normFigureRefs(o) };
      });
      const label = str(raw.label);
      const role = ROLES_FOR.problems.includes(role0) ? role0 : /예제/.test(label) ? 'example' : 'exercise';
      return {
        type,
        role,
        label,
        instruction: str(raw.instruction),
        pages: str(raw.pages),
        stem: richList(raw.stem),
        items,
        cols: cols || (items.length >= 4 ? 2 : 1),
        space: ['s', 'm', 'l'].includes(raw.space) ? raw.space : 'm',
        figures,
      };
    }
    case 'think': {
      const items = arr(raw.items).map((it) => {
        const o = typeof it === 'object' && it ? it : { q: str(it) };
        counters.t += 1;
        return { id: `t${counters.t}`, q: str(o.q ?? o.question ?? o.text), a: str(o.a ?? o.answer), sol: str(o.sol ?? o.solution), tip: str(o.tip ?? o.teacherTip) };
      });
      return { type, title: str(raw.title) || '생각해보기', pages: str(raw.pages), items, figures };
    }
    case 'review':
      return { type: 'strategy', title: str(raw.title), items: richList(raw.items), tip: '', figures };
    default:
      return null;
  }
}

export function normalizeDoc(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const counters = { q: 0, t: 0 };
  const figures = arr(src.figures)
    .map((f, i) => {
      if (!f || typeof f !== 'object') return null;
      const box = arr(f.box ?? f.box_2d ?? f.bbox).map(Number);
      if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) return null;
      let [y0, x0, y1, x1] = box;
      // 0~1 비율로 준 경우
      if (Math.max(y0, x0, y1, x1) <= 1.5) [y0, x0, y1, x1] = [y0 * 1000, x0 * 1000, y1 * 1000, x1 * 1000];
      const clamp = (n) => Math.max(0, Math.min(1000, n));
      [y0, y1] = [clamp(Math.min(y0, y1)), clamp(Math.max(y0, y1))];
      [x0, x1] = [clamp(Math.min(x0, x1)), clamp(Math.max(x0, x1))];
      if (y1 - y0 < 8 || x1 - x0 < 8) return null;
      return { id: str(f.id) || `f${i + 1}`, page: parseInt(f.page, 10) || 1, box: [y0, x0, y1, x1], desc: str(f.desc ?? f.description), ...(f.snap ? { snap: true } : {}) };
    })
    .filter(Boolean);
  const figIds = new Set(figures.map((f) => f.id));

  const lessons = arr(src.lessons).map((l, li) => {
    const lesson = l && typeof l === 'object' ? l : {};
    const sections = arr(lesson.sections).map((s) => {
      const sec = s && typeof s === 'object' ? s : {};
      const blocks = arr(sec.blocks)
        .map((b) => normBlock(b, counters))
        .filter(Boolean)
        .map((b) => ({ ...b, figures: b.figures.filter((id) => figIds.has(id)) }));
      blocks.forEach((b) => {
        if (b.items && b.type === 'problems') b.items.forEach((it) => (it.figures = it.figures.filter((id) => figIds.has(id))));
      });
      return { title: str(sec.title), pages: str(sec.pages), blocks };
    });
    const review = lesson.review && typeof lesson.review === 'object' ? { title: str(lesson.review.title), items: richList(lesson.review.items) } : null;
    return {
      no: parseInt(lesson.no ?? lesson.lessonNo, 10) || li + 1,
      chapterNo: str(lesson.chapterNo ?? lesson.unitNo ?? '').trim(),
      chapterTitle: str(lesson.chapterTitle ?? lesson.unitTitle ?? ''),
      topic: str(lesson.topic),
      objective: str(lesson.objective),
      review: review && review.items.length ? review : null,
      sections,
      ...(lesson.chunk !== undefined && lesson.chunk !== null ? { chunk: lesson.chunk } : {}),
    };
  });

  return {
    subject: str(src.subject),
    unit: str(src.unit ?? src.bigUnit),
    lessons,
    figures,
  };
}

// 검산용: 문제와 정답만 추린 목록
export function collectAnswerItems(doc) {
  const out = [];
  doc.lessons.forEach((l) =>
    l.sections.forEach((s) =>
      s.blocks.forEach((b) => {
        if (b.type === 'problems') {
          b.items.forEach((it) => out.push({ id: it.id, kind: 'problem', context: [b.instruction, ...(b.stem || [])].filter(Boolean).join(' / '), q: it.q, a: it.a, sol: it.sol }));
        } else if (b.type === 'think') {
          b.items.forEach((it) => out.push({ id: it.id, kind: 'think', q: it.q, a: it.a, sol: it.sol }));
        }
      })
    )
  );
  return out;
}

export function applyAnswerFixes(doc, fixes) {
  const byId = new Map();
  (Array.isArray(fixes) ? fixes : []).forEach((f) => f && f.id && byId.set(String(f.id), f));
  if (!byId.size) return { doc, changed: 0 };
  let changed = 0;
  const next = structuredClone(doc);
  next.lessons.forEach((l) =>
    l.sections.forEach((s) =>
      s.blocks.forEach((b) => {
        if (b.type !== 'problems' && b.type !== 'think') return;
        b.items.forEach((it) => {
          const f = byId.get(it.id);
          if (!f) return;
          ['q', 'a', 'sol'].forEach((k) => {
            if (typeof f[k] === 'string' && f[k].trim() && f[k] !== it[k]) {
              it[k] = f[k];
              changed++;
            }
          });
        });
      })
    )
  );
  return { doc: next, changed };
}
