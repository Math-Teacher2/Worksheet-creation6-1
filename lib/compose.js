// 학습지 데이터 + 레이아웃 + 구성 → "문서 모델"(표·줄·칸·문단)
// 같은 모델을 HWPX와 화면 미리보기가 함께 씁니다.

import { parseRich, cleanRichSource, splitMathForHwp, splitAtEquals } from './rich';
import { textWidth, eqSize } from './measure';
import { roleOf } from './doc';

export const mm = (v) => Math.round((v * 7200) / 25.4);
export const PAGE = (() => {
  const W = 59528;
  const H = 84188;
  const ML = mm(15);
  const MR = mm(15);
  const MT = mm(11);
  const MB = mm(7);
  const FOOT = mm(7);
  return { W, H, ML, MR, MT, MB, FOOT, TEXT_W: W - ML - MR, BODY_H: H - MT - MB - FOOT };
})();
export const TABLE_GAP = mm(2.4);

const B = (color, width = '0.12 mm', type = 'SOLID') => ({ color, width, type });

// ---------- 기본 조립 도구 ----------
function makeCtx({ layout, theme, teacher, figs, scale = 1, tScale = 1, idPrefix = '' }) {
  let n = 0;
  const fs = Math.round((1000 * scale) / 25) * 25;
  return {
    L: layout,
    th: theme,
    teacher,
    figs: figs || {},
    scale,
    tScale,
    fs,
    font: layout.font === 'dotum' ? 'dotum' : 'batang',
    id: (k) => `${idPrefix}${k}-${++n}`,
  };
}

function P(ctx, nodes, o = {}) {
  return {
    nodes: nodes.filter(Boolean),
    size: o.size || ctx.fs,
    color: o.color || ctx.th.text,
    bold: !!o.bold,
    font: o.font || ctx.font,
    align: o.align || 'JUSTIFY',
    line: o.line || 160,
    prev: o.prev || 0,
    next: o.next || 0,
    left: o.left || 0,
    indent: o.indent || 0,
  };
}
const T = (v, s = {}) => ({ t: 'text', v: String(v ?? ''), ...s });
// 리치 문장 → 노드. 수식은 지침대로 쉼표·한글을 밖으로 빼고, 긴 식은 등호 앞에서 나눔
function R(src, s = {}) {
  const out = [];
  for (const n of parseRich(cleanRichSource(src))) {
    if (n.t === 'text') out.push({ ...n, ...s, b: n.b || s.b });
    else if (n.t === 'math') {
      for (const m of splitMathForHwp(n.v)) {
        if (m.t === 'text') {
          out.push({ t: 'text', v: m.v, ...s });
          continue;
        }
        const pieces = eqSize(m.v, s.size || 1000).width > mm(85) ? splitAtEquals(m.v) : [m.v];
        pieces.forEach((pv, i) => {
          if (i) out.push({ t: 'text', v: ' ', ...s });
          out.push({ t: 'math', v: pv, d: n.d, color: s.color, ...(s.size ? { size: s.size } : {}) });
        });
      }
    } else if (n.t === 'blank') {
      out.push({ ...n, ans: n.ans.flatMap((a) => (a.t === 'math' ? splitMathForHwp(a.v) : [a])) });
    } else out.push(n);
  }
  // 기울인 대문자로 끝나는 수식 뒤에 한글이 오면 ` 를 붙임 (A 제외)
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i];
    const b = out[i + 1];
    if (a.t === 'math' && b.t === 'text' && /^[가-힣]/.test(b.v) && /(^|[^\\a-zA-Z])[B-Z]\s*$/.test(a.v)) a.tick = true;
  }
  return out;
}
function cell(paras, o = {}) {
  return {
    paras: paras.length ? paras : [],
    fill: o.fill || null,
    b: { l: o.l || null, r: o.r || null, t: o.t || null, b: o.b || null },
    m: o.m || [mm(2.5), mm(2.5), mm(1.6), mm(1.6)],
    v: o.v || 'TOP',
    cs: o.cs || 1,
    rs: o.rs || 1,
    minH: o.minH || 0,
    space: o.space || 0,
    tool: o.tool || null,
  };
}
function row(ctx, cells, o = {}) {
  return { id: ctx.id('r'), cells, minH: o.minH || 0, flex: o.flex || 0, kind: o.kind || 'block' };
}
function table(ctx, widths, rows) {
  return { id: ctx.id('t'), widths, rows };
}
function split(total, fracs) {
  const ws = fracs.map((f) => Math.round(total * f));
  ws[ws.length - 1] = total - ws.slice(0, -1).reduce((a, b) => a + b, 0);
  return ws;
}
const allB = (b) => ({ l: b, r: b, t: b, b });

// ---------- 그림 ----------
function imgNode(ctx, id, maxW, maxH = mm(62)) {
  const f = ctx.figs[id];
  if (!f || !f.w || !f.h) return null;
  let w = Math.round(Math.min(maxW, Math.max(mm(26), (f.frac || 0.35) * PAGE.TEXT_W * 1.05)));
  let h = Math.round((w * f.h) / f.w);
  if (h > maxH) {
    h = maxH;
    w = Math.round((h * f.w) / f.h);
  }
  return { t: 'img', id, w, h };
}
function figurePara(ctx, ids, maxW) {
  const list = (ids || []).filter((id) => ctx.figs[id]);
  if (!list.length) return null;
  const gap = mm(4);
  const each = list.length > 1 ? Math.floor((maxW - gap * (list.length - 1)) / list.length) : maxW;
  const nodes = [];
  list.forEach((id, i) => {
    if (i) nodes.push({ t: 'gap', w: gap });
    nodes.push(imgNode(ctx, id, each, list.length > 1 ? mm(48) : mm(62)));
  });
  return P(ctx, nodes, { align: 'CENTER', line: 100, prev: mm(0.8), next: mm(0.8) });
}

// ---------- 블록 색 ----------
function colorsOf(ctx, type) {
  const th = ctx.th;
  switch (type) {
    case 'concept':
      return { c: th.conceptBar, soft: th.conceptSoft };
    case 'strategy':
      return { c: th.strategy, soft: th.strategySoft };
    case 'problems':
      return { c: th.problem, soft: th.problemSoft, line: th.problemLine };
    case 'think':
      return { c: th.think, soft: th.thinkSoft };
    case 'slot':
      return { c: th.accent, soft: '#FFFFFF' };
    case 'review':
      return { c: th.review, soft: th.reviewSoft };
    case 'check':
      return { c: th.primary, soft: '#FFFFFF' };
    case 'table':
      return { c: th.primary, soft: '#FFFFFF' };
    default:
      return { c: th.primary, soft: th.exploreSoft };
  }
}

const MARK = { concept: '■', strategy: '★', check: '●', think: '▶', slot: '✎', review: '◆', table: '▣', problems: '■', explore: '◇' };

// 활동 이름과 블록 제목이 같거나 겹치면 하나만 (예: "개념 정리 · 개념 정리" 방지)
const normTitle = (v) => String(v || '').replace(/\([^)]*\)|（[^）]*）/g, '').replace(/[\s·:\[\]]/g, '');
function sameTitle(label, title) {
  const a = normTitle(label);
  const b = normTitle(title);
  if (!a || !b) return !b;
  return a === b || a.includes(b) || b.includes(a);
}

function titlePara(ctx, type, label, title, extra, color, mark) {
  const dot = 'dotum';
  const nodes = [T(`${mark || MARK[type] || '■'} ${label}`, { b: true, color, font: dot })];
  if (title && sameTitle(label, title)) title = '';
  if (title) nodes.push(T(' · ', { b: true, color, font: dot }), ...R(title, { b: true, color, font: dot }));
  if (extra) nodes.push(T(`   ${extra}`, { color: ctx.th.muted, size: Math.round(ctx.fs * 0.85), font: dot }));
  return P(ctx, nodes, { line: 150, next: mm(0.6), align: 'LEFT' });
}

function answerParas(ctx, a, sol, tip) {
  if (!ctx.teacher) return [];
  const red = ctx.th.answer;
  const out = [];
  const k = ctx.tScale || 1;
  const small = Math.round(ctx.fs * 0.92 * k);
  const tag = Math.round(ctx.fs * 0.85 * k);
  const line = k < 1 ? 140 : 150;
  if (a) out.push(P(ctx, [T('정답  ', { b: true, color: red, size: tag, font: 'dotum' }), ...R(a, { b: true, color: red, size: small })], { size: small, color: red, line, prev: mm(0.8), align: 'LEFT' }));
  if (sol)
    String(sol)
      .split(/\n+/)
      .filter((s) => s.trim())
      .forEach((ln, i) => out.push(P(ctx, [...(i === 0 ? [T('풀이  ', { b: true, color: red, size: tag, font: 'dotum' })] : []), ...R(ln, { color: red, size: small })], { size: small, color: red, line, align: 'LEFT' })));
  if (tip) out.push(P(ctx, [T('지도  ', { b: true, color: NOTE.label, size: tag, font: 'dotum' }), ...R(tip, { color: NOTE.text, size: small })], { size: small, color: NOTE.text, line, align: 'LEFT' }));
  return out;
}

// ---------- 교사용 코멘트 (지도 TIP·오개념·확장·심화) ----------
const NOTE = { fill: '#FFF7E3', bar: '#E8A33D', label: '#B25E00', text: '#5B4325' };
const NOTE_LABEL = { tip: '지도 TIP', caution: '오개념 주의', extend: '생각 넓히기', advanced: '심화 참고' };

function teacherNotesPara(ctx, notes, width) {
  if (!notes || !notes.length) return null;
  // 학생용에서도 같은 순서로 id를 써야 학생용·교사용 줄 id가 어긋나지 않음
  if (!ctx.teacher) {
    ctx.id('t');
    ctx.id('r');
    return null;
  }
  const k = ctx.tScale || 1;
  const size = Math.round(ctx.fs * 0.86 * k);
  const paras = notes.map((n) =>
    P(
      ctx,
      [
        T(`${NOTE_LABEL[n.kind] || '지도 TIP'}  `, { b: true, color: NOTE.label, font: 'dotum', size }),
        ...R(n.text, { color: NOTE.text, size }),
        ...(n.kind === 'advanced' ? [T('  (교육과정 밖 내용, 교사 참고용)', { color: '#9A8A70', size: Math.round(size * 0.92) })] : []),
      ],
      { size, color: NOTE.text, line: k < 1 ? 135 : 145, align: 'LEFT' }
    )
  );
  const inner = table(ctx, [width], [row(ctx, [cell(paras, { fill: NOTE.fill, l: B(NOTE.bar, '1 mm'), m: [mm(2), mm(1.5), mm(1), mm(1)] })], { kind: 'tnote' })]);
  return P(ctx, [{ t: 'tbl', table: inner }], { line: 100, align: 'LEFT', prev: mm(1) });
}

// 문항 앞에 붙은 번호 찾기: (1), （1）, ⑴, ①, 1), **(1)**, $(1)$, [문제 1-(1)] 같은 꼴
const CIRCLED_PAREN = '⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇';
export function ownLabel(q) {
  let t = String(q || '');
  let tag = null;
  // [예제 1-(2)] 같은 꼬리표 (안에 있는 (n)을 번호로)
  const mt = t.match(/^\s*\[[^\]]{0,14}?(\(\d{1,2}\))?\]\s*/);
  if (mt && /\d/.test(mt[0])) {
    tag = mt[1] || null;
    t = t.slice(mt[0].length);
  }
  // 수식 안에 번호가 들어간 꼴: $(1)$ … 또는 $(1)\ \lim…$
  const mm1 = t.match(/^\s*\$\s*(?:\\text\{\s*)?\(\s*(\d{1,2})\s*\)\s*(?:\})?\s*/);
  if (mm1) {
    let rest = t.slice(mm1[0].length);
    rest = rest.startsWith('$') ? rest.slice(1).trimStart() : `$${rest.replace(/^(\\[ ,;!]|~)+\s*/, '')}`;
    return { label: `(${mm1[1]})`, rest };
  }
  const m = t.match(/^\s*(?:\*\*)?\s*([(（]\s*(\d{1,2})\s*[)）]|([⑴-⒇])|([①-⑳])|(\d{1,2})\s*\))\s*(?:\*\*)?\s*/);
  if (m) {
    const n = m[2] || (m[3] ? String(CIRCLED_PAREN.indexOf(m[3]) + 1) : '') || m[5];
    const label = m[4] ? m[4] : `(${n})`;
    return { label, rest: t.slice(m[0].length) };
  }
  if (tag) return { label: tag, rest: t };
  return null;
}

// 문항 격자(내부 표). 학생용은 문항마다 풀이 공간, 교사용은 정답·풀이
function itemGrid(ctx, items, { cols, width, space, numbering, divider, flex = 1, figs = true }) {
  cols = Math.max(1, Math.min(3, cols || 1));
  const ws = split(width, Array(cols).fill(1 / cols));
  const rows = [];
  for (let i = 0; i < items.length; i += cols) {
    const group = items.slice(i, i + cols);
    const cells = [];
    for (let c = 0; c < cols; c++) {
      const it = group[c];
      const paras = [];
      if (it) {
        const idx = i + c;
        let num = numbering ? numbering(idx, items.length) : '';
        let q = typeof it === 'string' ? it : it.q;
        // 문항에 교과서 번호가 이미 붙어 있으면 그 번호를 씀 (예: "(3) ..." → "(1) (3)" 중복 방지)
        const own = ownLabel(q);
        if (own && num) {
          num = `${own.label} `;
          q = own.rest;
        }
        const nodes = [];
        if (num) nodes.push(T(num, { b: true, color: ctx.numColor || ctx.th.text, font: 'dotum' }));
        nodes.push(...R(q));
        paras.push(P(ctx, nodes, { line: 170, align: 'LEFT' }));
        if (figs && it.figures && it.figures.length) {
          const fp = figurePara(ctx, it.figures, ws[c] - mm(4));
          if (fp) paras.push(fp);
        }
        if (typeof it === 'object') paras.push(...answerParas(ctx, it.a, it.sol, it.tip));
      }
      cells.push(
        cell(paras, {
          m: [mm(0.5), mm(2), mm(0.8), mm(0.8)],
          r: divider && c < cols - 1 ? B(ctx.th.line, '0.12 mm', 'DOT') : null,
          space: !ctx.teacher && it && typeof it === 'object' ? space : ctx.teacher ? mm(2) : 0,
        })
      );
    }
    rows.push(row(ctx, cells, { flex: space ? flex : 0, kind: 'item' }));
  }
  return table(ctx, ws, rows);
}

// ---------- 블록 → 줄(들) ----------
const SPACE = { s: 9, m: 15, l: 24 };

function blockSpec(ctx, b, comp) {
  const spec = blockSpecInner(ctx, b, comp);
  if (spec) spec.tnotes = b.tnotes || [];
  return spec;
}

function blockSpecInner(ctx, b, comp) {
  const act = (t) => comp.activities.find((a) => a.type === t) || {};
  const sp = (v) => mm(v * (ctx.scale < 1 ? 0.8 : 1));
  switch (b.type) {
    case 'explore': {
      const role = roleOf(b);
      const label = act(role).title || (role === 'lead' ? '개념 도입' : '생각열기');
      return { type: 'explore', role, mark: role === 'lead' ? '◈' : '◇', label, short: label.length <= 4 ? label : role === 'lead' ? '개념' : '열기', title: b.title, body: b.items.map((s) => R(s)), table: b.table, figs: b.figures };
    }
    case 'concept':
      return { type: 'concept', label: act('concept').title || '개념 정리', short: '개념', title: b.title, body: b.items.map((s) => R(s)), note: b.note, table: b.table, figs: b.figures };
    case 'check':
      return { type: 'check', label: act('check').title || b.title || '확인하기', short: '확인', extra: b.source, grid: { items: b.items, cols: b.cols || 2 }, table: b.table, figs: b.figures };
    case 'strategy':
      return { type: 'strategy', label: act('strategy').title || '풀이 전략', short: '전략', title: b.title, body: b.items.map((s) => R(s)), note: b.tip ? `★ ${b.tip}` : '', figs: b.figures };
    case 'table':
      return { type: 'table', label: b.title || '정리', short: '정리', data: b };
    case 'problems':
      return {
        type: 'problems',
        label: b.label || act(roleOf(b)).title || ({ example: '예제', challenge: '실전 문제' }[roleOf(b)] || '문제'),
        short: (b.label || act(roleOf(b)).title || '').length <= 4 ? b.label || act(roleOf(b)).title : roleOf(b) === 'example' ? '예제' : '문제',
        instruction: b.instruction,
        extra: b.pages ? `[교과서 ${b.pages}쪽]` : '',
        stem: b.stem || [],
        grid: { items: b.items, cols: b.cols || 1, space: sp(SPACE[b.space] || 15) },
        figs: b.figures,
      };
    case 'think':
      return { type: 'think', label: act('think').title || b.title || '생각해보기', short: '생각', extra: b.pages ? `[교과서 ${b.pages}쪽]` : '', grid: { items: b.items, cols: 1, space: sp(20) }, figs: b.figures };
    case 'slot':
      return { type: 'slot', label: b.title || '교사 작성', short: (b.title || '').length <= 4 ? b.title : '교사', hint: b.hint, space: sp(b.space || 28) };
    case 'review':
      return { type: 'review', label: '지난 시간 정리', short: '복습', title: b.title, body: b.items.map((s) => R(s)) };
    default:
      return null;
  }
}

// 교과서 표(채워 볼 표 등). 첫 열이 머리(예: x, f(x))인 가로 표도 그대로
function dataTablePara(ctx, d, width) {
  const ncol = Math.max(d.header.length, ...d.rows.map((r) => r.length), 1);
  const ws = split(width, Array(ncol).fill(1 / ncol));
  const ln = B(ctx.th.line);
  const rows = [];
  if (d.header.length)
    rows.push(row(ctx, Array.from({ length: ncol }, (_, i) => cell([P(ctx, R(d.header[i] || '', { b: true, color: ctx.th.primary, font: 'dotum' }), { align: 'CENTER', line: 150 })], { fill: ctx.th.headSoft, ...allB(ln), v: 'CENTER', m: [mm(1.5), mm(1.5), mm(1), mm(1)] }))));
  d.rows.forEach((r) => rows.push(row(ctx, Array.from({ length: ncol }, (_, i) => cell([P(ctx, R(r[i] || ''), { align: 'CENTER', line: 155 })], { ...allB(ln), v: 'CENTER', m: [mm(1.5), mm(1.5), mm(1), mm(1)] })))));
  return P(ctx, [{ t: 'tbl', table: table(ctx, ws, rows) }], { line: 100, align: 'LEFT', prev: mm(0.8), next: mm(0.8) });
}

function contentParas(ctx, spec, width, { withTitle }) {
  const { c } = colorsOf(ctx, spec.type);
  const paras = [];
  const L = ctx.L;
  if (spec.type === 'problems') {
    if (withTitle && L.problem !== 'head') {
      const nodes =
        L.problem === 'exam'
          ? [T(`${spec.label}. `, { b: true, font: 'dotum' }), ...R(spec.instruction || ''), ...(spec.extra ? [T(`  ${spec.extra}`, { color: ctx.th.muted, size: Math.round(ctx.fs * 0.85) })] : [])]
          : [T(`${MARK.problems} ${spec.label}  `, { b: true, color: c, font: 'dotum' }), ...R(spec.instruction || ''), ...(spec.extra ? [T(`  ${spec.extra}`, { color: ctx.th.muted, size: Math.round(ctx.fs * 0.85) })] : [])];
      paras.push(P(ctx, nodes, { line: 155, next: mm(0.6), align: 'LEFT' }));
    }
  } else if (withTitle) {
    paras.push(titlePara(ctx, spec.type, spec.label, spec.title, spec.extra, c, spec.mark));
  }
  const figList = (spec.figs || []).filter((id) => ctx.figs[id]);
  const side = figList.length === 1 && ['explore', 'concept', 'strategy', 'check', 'think'].includes(spec.type);
  const textW = side ? Math.round(width * 0.66) : width;
  const body = [];
  (spec.body || []).forEach((nodes) => body.push(P(ctx, nodes, { line: 170 })));
  (spec.stem || []).forEach((s) => body.push(P(ctx, R(s), { line: 170 })));
  if (spec.note) body.push(P(ctx, R(spec.note, { color: ctx.th.muted }), { size: Math.round(ctx.fs * 0.88), color: ctx.th.muted, line: 155 }));
  if (spec.type === 'check') {
    ctx.numColor = ctx.th.text;
    body.push(P(ctx, [{ t: 'tbl', table: itemGrid(ctx, spec.grid.items.map((q) => ({ q })), { cols: spec.grid.cols, width: textW, space: 0 }) }], { line: 100, align: 'LEFT' }));
  }
  if (spec.type === 'problems' || spec.type === 'think') {
    const numberColor = ctx.L.problem === 'exam' ? ctx.th.text : c;
    ctx.numColor = numberColor;
    const n = spec.grid.items.length;
    const numbering =
      spec.type === 'think' ? (i, k) => (k > 1 ? `${'①②③④⑤⑥⑦⑧⑨'[i] || i + 1} ` : '') : (i, k) => (k > 1 ? `(${i + 1}) ` : '');
    const grid = itemGrid(ctx, spec.grid.items, {
      cols: spec.grid.cols,
      width: spec.type === 'problems' && figList.length && side === false && figList.length === 1 ? textW : textW,
      space: spec.grid.space,
      numbering,
      divider: ctx.L.problem === 'exam' && spec.grid.cols > 1,
      flex: spec.type === 'think' ? 2 : 2,
    });
    void n;
    if (!side) {
      const fp = figurePara(ctx, figList, width - mm(4));
      if (fp) body.push(fp);
    }
    body.push(P(ctx, [{ t: 'tbl', table: grid, grow: true }], { line: 100, align: 'LEFT' }));
  }
  if (spec.type === 'table') body.push(dataTablePara(ctx, spec.data, textW));
  else if (spec.table) body.push(dataTablePara(ctx, spec.table, textW));
  if (spec.type === 'slot') {
    body.push(P(ctx, [T(spec.hint || '여기에 문제를 넣으세요. (교사 작성 칸)', { color: '#A0A7B4' })], { size: Math.round(ctx.fs * 0.85), color: '#A0A7B4', line: 150 }));
  }
  const notesPara = teacherNotesPara(ctx, spec.tnotes, width);
  if (side) {
    const fig = figurePara(ctx, figList, Math.round(width * 0.32) - mm(2));
    const inner = table(ctx, [textW, width - textW], [
      row(ctx, [cell(body, { m: [0, mm(2), 0, 0] }), cell(fig ? [fig] : [], { m: [mm(1), 0, 0, 0], v: 'CENTER' })]),
    ]);
    paras.push(P(ctx, [{ t: 'tbl', table: inner }], { line: 100, align: 'LEFT' }));
  } else {
    paras.push(...body);
    if (spec.type !== 'problems' && spec.type !== 'think') {
      const fp = figurePara(ctx, figList, width - mm(4));
      if (fp) paras.push(fp);
    }
  }
  if (notesPara) paras.push(notesPara);
  return paras;
}

// 상자 모양(레이아웃 box)에 따른 칸 테두리·채움
function boxStyle(ctx, type) {
  const { c, soft, line } = colorsOf(ctx, type);
  const th = ctx.th;
  const L = ctx.L;
  const thin = B(line || th.line);
  switch (L.box) {
    case 'bar': {
      if (type === 'check') return { ...allB(B(th.checkLine, '0.12 mm', 'DASH')), fill: null, spacer: true };
      if (type === 'explore') return { ...allB(B(th.line)), fill: soft, spacer: true };
      if (type === 'problems' || type === 'table') return { ...allB(thin), fill: null, spacer: true };
      if (type === 'slot') return { ...allB(B(th.accent, '0.12 mm', 'DASH')), fill: null, spacer: true };
      return { l: B(c, '1.5 mm'), fill: soft, spacer: true };
    }
    case 'fill':
      if (type === 'problems' || type === 'check') return { ...allB(B(line || th.line)), fill: type === 'check' ? null : null, spacer: true };
      if (type === 'slot') return { ...allB(B(th.accent, '0.12 mm', 'DASH')), fill: null, spacer: true };
      return { fill: soft === '#FFFFFF' ? th.headSoft : soft, spacer: true };
    case 'plain':
      return { b: B(th.line), fill: null, spacer: false };
    case 'outline':
      return { ...allB(B(th.line)), fill: null, spacer: false };
    case 'dashed':
    default:
      return { ...allB(B(th.line, '0.12 mm', 'DASH')), fill: null, spacer: true };
  }
}

const M_BOX = () => [mm(3), mm(2.6), mm(2), mm(2)];

function blockRows(ctx, spec, sec, path) {
  const L = ctx.L;
  const labelCol = L.section === 'label';
  const ncol = sec.widths.length;
  const fullW = sec.widths.reduce((a, b) => a + b, 0);
  const contentW = labelCol ? fullW - sec.widths[0] : fullW;
  const st = boxStyle(ctx, spec.type);
  const { c } = colorsOf(ctx, spec.type);
  const m = M_BOX();
  const inner = contentW - m[0] - m[1];
  const rows = [];
  const flexOf = spec.type === 'slot' ? 3 : 0;
  const tool = { path };

  // 문제 머리 줄(head 모양)
  if (spec.type === 'problems' && L.problem === 'head' && !labelCol) {
    const hb = B(colorsOf(ctx, 'problems').line || ctx.th.line);
    const headNodes = [T(`${spec.label}    `, { b: true, color: c, font: 'dotum' }), ...R(spec.instruction || ''), ...(spec.extra ? [T(`   ${spec.extra}`, { color: ctx.th.muted, size: Math.round(ctx.fs * 0.85) })] : [])];
    rows.push(row(ctx, [cell([P(ctx, headNodes, { line: 150, align: 'LEFT' })], { cs: ncol, fill: colorsOf(ctx, 'problems').soft, ...allB(hb), v: 'CENTER', m: [mm(3), mm(2.5), mm(1.2), mm(1.2)] })], { kind: 'phead' }));
    const paras = contentParas(ctx, spec, inner, { withTitle: false });
    rows.push(row(ctx, [cell(paras, { cs: ncol, l: hb, r: hb, b: hb, m, tool })], { flex: 0 }));
    return rows;
  }

  const paras = contentParas(ctx, spec, inner, { withTitle: !labelCol });
  if (spec.type === 'slot') {
    // 교사 작성 칸: 아래쪽 빈 공간
  }
  const cellOpts = { l: st.l, r: st.r, t: st.t, b: st.b, fill: st.fill, m, tool, space: spec.type === 'slot' ? spec.space : 0 };
  if (labelCol) {
    const lb = B(ctx.th.line);
    const labelCell = cell([P(ctx, [T(spec.short || spec.label, { b: true, color: c, font: 'dotum' })], { align: 'CENTER', line: 140, size: Math.round(ctx.fs * 0.92) })], {
      r: lb,
      b: lb,
      v: 'TOP',
      m: [mm(1), mm(1), mm(2.2), mm(1)],
      fill: null,
    });
    // 코넬형: 문제 지시문은 오른쪽 칸 첫 줄에
    const extraTitle = [];
    if (spec.type === 'problems') extraTitle.push(P(ctx, [...R(spec.instruction || ''), ...(spec.extra ? [T(`  ${spec.extra}`, { color: ctx.th.muted, size: Math.round(ctx.fs * 0.85) })] : [])], { line: 155, next: mm(0.6), align: 'LEFT' }));
    else if ((spec.title && !sameTitle(spec.label, spec.title)) || spec.extra) extraTitle.push(P(ctx, [...(spec.title && !sameTitle(spec.label, spec.title) ? R(spec.title, { b: true, color: c, font: 'dotum' }) : []), ...(spec.extra ? [T(`  ${spec.extra}`, { color: ctx.th.muted, size: Math.round(ctx.fs * 0.85) })] : [])], { line: 150, align: 'LEFT' }));
    const contentCell = cell([...extraTitle, ...paras], { ...cellOpts, l: null, r: null, t: null, b: lb, fill: null });
    rows.push(row(ctx, [labelCell, contentCell], { flex: flexOf }));
    return rows;
  }
  rows.push(row(ctx, [cell(paras, { ...cellOpts, cs: ncol })], { flex: flexOf }));
  return rows;
}

// ---------- 주제(섹션) 표 ----------
function sectionWidths(ctx, sec) {
  const W = PAGE.TEXT_W;
  switch (ctx.L.section) {
    case 'numbox':
      return [mm(8), W - mm(8) - mm(34), mm(34)];
    case 'tab': {
      const tw = Math.min(Math.round(W * 0.66), Math.max(mm(42), Math.round(textWidth(`${sec.no}  ${sec.title.replace(/\$[^$]*\$/g, 'xxxx')}`, 1250, true) + mm(12))));
      return [tw, W - tw - mm(34), mm(34)];
    }
    case 'label':
      return [mm(20), W - mm(20)];
    default:
      return [W - mm(34), mm(34)];
  }
}

function sectionHead(ctx, sec, widths, cont) {
  const th = ctx.th;
  const title = sec.title; // 이어지는 쪽에도 같은 제목 ((계속) 표시는 하지 않음)
  const pages = sec.pages ? `교과서 ${sec.pages}쪽` : '';
  const big = Math.round(ctx.fs * 1.28);
  const pagesPara = P(ctx, pages ? [T(pages, { color: th.muted, size: Math.round(ctx.fs * 0.82), font: 'dotum' })] : [], { align: 'RIGHT', line: 120 });
  const mH = [mm(2), mm(1.5), mm(1), mm(1)];
  switch (ctx.L.section) {
    case 'numbox': {
      const tb = B(th.primary, '0.4 mm');
      return row(ctx, [
        cell([P(ctx, [T(String(sec.no), { b: true, color: '#FFFFFF', font: 'dotum' })], { align: 'CENTER', line: 120, size: Math.round(ctx.fs * 1.1) })], { fill: th.primary, b: tb, v: 'CENTER', m: [mm(0.5), mm(0.5), mm(1), mm(1)] }),
        cell([P(ctx, R(title, { b: true, font: 'dotum' }), { line: 120, size: big, align: 'LEFT' })], { b: tb, v: 'CENTER', m: mH }),
        cell([pagesPara], { b: tb, v: 'BOTTOM', m: mH }),
      ], { kind: 'shead' });
    }
    case 'tab': {
      const tb = B(th.primary, '0.4 mm');
      return row(ctx, [
        cell([P(ctx, [T(`${sec.no}  `, { b: true, color: '#FFFFFF', font: 'dotum' }), ...R(title, { b: true, color: '#FFFFFF', font: 'dotum' })], { line: 120, size: Math.round(ctx.fs * 1.18), align: 'LEFT', color: '#FFFFFF' })], { fill: th.primary, v: 'CENTER', m: [mm(3), mm(2), mm(1.3), mm(1.3)] }),
        cell([], { b: tb, m: mH }),
        cell([pagesPara], { b: tb, v: 'BOTTOM', m: mH }),
      ], { kind: 'shead' });
    }
    case 'label': {
      const tb = B(th.primary, '0.5 mm');
      return row(ctx, [
        cell([P(ctx, [T(String(sec.no).padStart(2, '0'), { b: true, color: th.accent, font: 'dotum' })], { align: 'CENTER', line: 120, size: Math.round(ctx.fs * 1.35) })], { b: tb, v: 'BOTTOM', m: [mm(1), mm(1), mm(1), mm(1)] }),
        cell([P(ctx, [...R(title, { b: true, font: 'dotum' }), ...(pages ? [T(`   ${pages}`, { color: th.muted, size: Math.round(ctx.fs * 0.82), font: 'dotum' })] : [])], { line: 120, size: big, align: 'LEFT' })], { b: tb, v: 'BOTTOM', m: mH }),
      ], { kind: 'shead' });
    }
    case 'band': {
      const tb = B(th.primary, '0.4 mm');
      const fill = th.headSoft;
      return row(ctx, [
        cell([P(ctx, [T(`${sec.no}. `, { b: true, font: 'dotum' }), ...R(title, { b: true, font: 'dotum' })], { line: 120, size: Math.round(ctx.fs * 1.18), align: 'LEFT' })], { fill, t: tb, b: B(th.line), v: 'CENTER', m: [mm(3), mm(1.5), mm(1.3), mm(1.3)] }),
        cell([pagesPara], { fill, t: tb, b: B(th.line), v: 'CENTER', m: mH }),
      ], { kind: 'shead' });
    }
    case 'underline':
    default: {
      const tb = B(th.primary, '0.25 mm');
      return row(ctx, [
        cell([P(ctx, [T(`${sec.no}  `, { b: true, color: th.accent, font: 'dotum' }), ...R(title, { b: true, font: 'dotum' })], { line: 120, size: big, align: 'LEFT' })], { b: tb, v: 'BOTTOM', m: [mm(0.5), mm(1.5), mm(1), mm(1)] }),
        cell([pagesPara], { b: tb, v: 'BOTTOM', m: mH }),
      ], { kind: 'shead' });
    }
  }
}

// ---------- 머리 표 ----------
function headerTable(ctx, doc, lesson) {
  const th = ctx.th;
  const L = ctx.L;
  const W = PAGE.TEXT_W;
  const dot = 'dotum';
  const label = (t, o = {}) => P(ctx, [T(t, { b: true, color: o.color || th.primary, font: dot })], { align: 'CENTER', line: 120, size: Math.round(ctx.fs * 0.9) });
  const val = (t, o = {}) => P(ctx, t ? [T(t, { color: o.color || th.text })] : [], { align: o.align || 'LEFT', line: 130, size: Math.round(ctx.fs * 0.95) });
  const ln = B(th.line);
  const mm2 = [mm(2), mm(2), mm(1.2), mm(1.2)];
  const teacherTag = ctx.teacher ? '  (교사용)' : '';
  const titleNodes = (big, color = th.text, light = th.muted) => [
    ...(lesson.chapterNo ? [T(`${lesson.chapterNo}  `, { b: true, color: th.accent, font: dot, size: big })] : []),
    ...R(lesson.chapterTitle || lesson.topic || '', { b: true, color, font: dot, size: big }),
    ...(lesson.topic && lesson.chapterTitle ? [T('   ', { color: light, font: dot, size: Math.round(ctx.fs * 1.02) }), ...R(lesson.topic, { color: light, font: dot, size: Math.round(ctx.fs * 1.02) })] : []),
  ];
  const g6 = split(W, [0.15, 0.27, 0.1, 0.27, 0.09, 0.12]);
  const nameRow = (o = {}) =>
    row(ctx, [
      cell([label('학번')], { fill: o.fill, ...o.b, v: 'CENTER', m: mm2 }),
      cell([val('')], { ...o.b, v: 'CENTER', m: mm2 }),
      cell([label('이름')], { fill: o.fill, ...o.b, v: 'CENTER', m: mm2 }),
      cell([val('')], { ...o.b, v: 'CENTER', m: mm2 }),
      cell([label('날짜')], { fill: o.fill, ...o.b, v: 'CENTER', m: mm2 }),
      cell([val('월      일', { align: 'RIGHT', color: th.muted })], { ...o.b, v: 'CENTER', m: mm2 }),
    ], { minH: mm(7), kind: 'head' });

  if (L.header === 'exam') {
    const g7 = split(W, [0.23, 0.095, 0.165, 0.085, 0.225, 0.08, 0.12]);
    const k = B('#333333');
    const all = allB(k);
    const fill = th.headSoft;
    const c = (paras, o = {}) => cell(paras, { ...all, v: 'CENTER', m: mm2, ...o });
    const t = (s, o = {}) => P(ctx, [T(s, { b: !!o.b, color: th.text, font: o.font || ctx.font })], { align: o.align || 'CENTER', line: 125, size: Math.round(ctx.fs * (o.k || 0.95)) });
    return table(ctx, g7, [
      row(ctx, [
        c([t(doc.subject || '학습지', { b: true, k: 1.15, font: dot })]),
        c([t('대단원', { b: true, font: dot })], { fill }),
        c([P(ctx, R(doc.unit || ''), { align: 'CENTER', line: 125, size: Math.round(ctx.fs * 0.95) })]),
        c([t('소단원', { b: true, font: dot })], { fill }),
        c([P(ctx, [...(lesson.chapterNo ? [T(`${lesson.chapterNo}. `)] : []), ...R(lesson.chapterTitle || ''), ...(lesson.topic ? [T(' (', { color: th.muted }), ...R(lesson.topic, { color: th.muted }), T(')', { color: th.muted })] : [])], { align: 'CENTER', line: 125, size: Math.round(ctx.fs * 0.95) })]),
        c([t('차시', { b: true, font: dot })], { fill }),
        c([t(`${lesson.no}${teacherTag}`, { b: true, k: 1.1 })]),
      ], { minH: mm(8.5), kind: 'head' }),
      row(ctx, [
        c([t('학번(     )  이름(       )', { align: 'LEFT', k: 0.85 })]),
        c([t('학습목표', { b: true, font: dot })], { fill }),
        c([P(ctx, R(lesson.objective || ''), { align: 'LEFT', line: 130, size: Math.round(ctx.fs * 0.95) })], { cs: 3 }),
        c([t('날짜', { b: true, font: dot })], { fill }),
        c([t('')]),
      ], { minH: mm(8.5), kind: 'head' }),
    ]);
  }

  if (L.header === 'band') {
    const big = Math.round(ctx.fs * 1.65);
    return table(ctx, g6, [
      row(ctx, [
        cell([
          P(ctx, R([doc.subject, doc.unit].filter(Boolean).join('  ·  '), { color: '#FFFFFF', font: dot }), { size: Math.round(ctx.fs * 0.82), line: 130, color: '#FFFFFF', align: 'LEFT' }),
          P(ctx, titleNodes(big, '#FFFFFF', '#E6E6E6').map((n) => (n.t === 'text' && n.color === th.accent ? { ...n, color: '#FFFFFF' } : n)), { line: 125, align: 'LEFT', size: big, color: '#FFFFFF' }),
        ], { cs: 5, fill: th.primary, v: 'CENTER', m: [mm(4), mm(2), mm(2), mm(2)] }),
        cell([P(ctx, [T(String(lesson.no), { b: true, color: '#FFFFFF', font: dot, size: big }), T(' 차시', { b: true, color: '#FFFFFF', font: dot })], { align: 'CENTER', line: 120 }), ...(ctx.teacher ? [P(ctx, [T('교사용', { b: true, color: '#FFFFFF', font: dot })], { align: 'CENTER', line: 110, size: Math.round(ctx.fs * 0.8) })] : [])], { fill: th.lessonBox, v: 'CENTER', m: mm2 }),
      ], { minH: mm(15), kind: 'head' }),
      row(ctx, [cell([P(ctx, [T('학습목표   ', { b: true, color: th.primary, font: dot }), ...R(lesson.objective || '')], { line: 135, align: 'LEFT', size: Math.round(ctx.fs * 0.95) })], { cs: 6, fill: th.headSoft, v: 'CENTER', m: [mm(4), mm(2), mm(1.5), mm(1.5)] })], { minH: mm(7.5), kind: 'head' }),
      nameRow({ b: { b: ln } }),
    ]);
  }

  if (L.header === 'titleline') {
    const big = Math.round(ctx.fs * 1.75);
    const tb = B(th.primary, '0.7 mm');
    return table(ctx, g6, [
      row(ctx, [
        cell([P(ctx, R([doc.subject, doc.unit].filter(Boolean).join('  ·  '), { color: th.muted, font: dot }), { size: Math.round(ctx.fs * 0.82), line: 130, align: 'LEFT' }), P(ctx, titleNodes(big), { line: 125, align: 'LEFT', size: big })], { cs: 5, b: tb, v: 'BOTTOM', m: [mm(0.5), mm(2), mm(1.5), mm(1.5)] }),
        cell([P(ctx, [T(String(lesson.no), { b: true, color: th.accent, font: dot, size: big }), T(' 차시', { b: true, color: th.accent, font: dot })], { align: 'RIGHT', line: 120 }), ...(ctx.teacher ? [P(ctx, [T('교사용', { b: true, color: th.answer, font: dot })], { align: 'RIGHT', line: 110, size: Math.round(ctx.fs * 0.8) })] : [])], { b: tb, v: 'BOTTOM', m: [mm(1), mm(0.5), mm(1.5), mm(1.5)] }),
      ], { minH: mm(15), kind: 'head' }),
      row(ctx, [
        cell([P(ctx, [T('학습목표', { b: true, color: th.primary, font: dot })], { align: 'LEFT', line: 130, size: Math.round(ctx.fs * 0.92) })], { b: B(th.line, '0.12 mm', 'DOT'), v: 'CENTER', m: [mm(0.5), mm(1), mm(1.5), mm(1.5)] }),
        cell([P(ctx, R(lesson.objective || ''), { align: 'LEFT', line: 135, size: Math.round(ctx.fs * 0.95) })], { cs: 5, b: B(th.line, '0.12 mm', 'DOT'), v: 'CENTER', m: [mm(1), mm(1), mm(1.5), mm(1.5)] }),
      ], { minH: mm(7.5), kind: 'head' }),
      nameRow({ b: { b: ln } }),
    ]);
  }

  // banner (기본)
  const big = Math.round(ctx.fs * 1.7);
  const thick = B(th.primary, '0.5 mm');
  return table(ctx, g6, [
    row(ctx, [
      cell([P(ctx, [T(doc.subject || '학습지', { b: true, color: '#FFFFFF', font: dot })], { align: 'CENTER', line: 120, size: Math.round(ctx.fs * 1.3), color: '#FFFFFF' }), ...(doc.unit ? [P(ctx, R(doc.unit, { color: '#DDE5F0', font: dot }), { align: 'CENTER', line: 120, size: Math.round(ctx.fs * 0.72) })] : [])], { fill: th.primary, v: 'CENTER', m: [mm(1), mm(1), mm(1.5), mm(1.5)] }),
      cell([P(ctx, titleNodes(big), { line: 125, align: 'LEFT', size: big })], { cs: 4, t: thick, b: thick, v: 'CENTER', m: [mm(3), mm(1), mm(1.5), mm(1.5)] }),
      cell([P(ctx, [T(String(lesson.no), { b: true, color: '#FFFFFF', font: dot, size: big }), T(' 차시', { b: true, color: '#FFFFFF', font: dot })], { align: 'CENTER', line: 120 }), ...(ctx.teacher ? [P(ctx, [T('교사용', { b: true, color: '#FFFFFF', font: dot })], { align: 'CENTER', line: 110, size: Math.round(ctx.fs * 0.8) })] : [])], { fill: th.lessonBox, v: 'CENTER', m: mm2 }),
    ], { minH: mm(14), kind: 'head' }),
    row(ctx, [
      cell([label('학습목표')], { fill: th.headSoft, ...allB(ln), v: 'CENTER', m: mm2 }),
      cell([P(ctx, R(lesson.objective || ''), { align: 'LEFT', line: 135, size: Math.round(ctx.fs * 0.95) })], { cs: 5, ...allB(ln), v: 'CENTER', m: [mm(3), mm(2), mm(1.2), mm(1.2)] }),
    ], { minH: mm(7), kind: 'head' }),
    nameRow({ fill: th.headSoft, b: allB(ln) }),
  ]);
}

// ---------- 교사 작성 칸 (기출·수능특강) ----------
export function practiceSlotTable(ctx, label, columns) {
  const th = ctx.th;
  const W = PAGE.TEXT_W;
  const k = ctx.L.header === 'exam' || ctx.L.palette === 'mono' ? B('#333333') : B(th.line);
  const all = allB(k);
  const cols = columns && columns.length ? columns : ['자신의 풀이', '교사의 풀이'];
  const ws = split(W, Array(cols.length).fill(1 / cols.length));
  const dot = 'dotum';
  const rows = [
    row(ctx, [cell([P(ctx, [T(`[${label}]`, { b: true, color: ctx.th.primary, font: dot }), T('   출처: ', { color: th.muted, font: dot, size: Math.round(ctx.fs * 0.85) })], { line: 130, align: 'LEFT', size: Math.round(ctx.fs * 0.95) })], { cs: cols.length, ...all, fill: th.headSoft, v: 'CENTER', m: [mm(2), mm(2), mm(1), mm(1)] })], { kind: 'slothead' }),
    row(ctx, [cell([P(ctx, [T('여기에 문제를 붙여 넣으세요.', { color: '#A0A7B4' })], { size: Math.round(ctx.fs * 0.85), line: 140, color: '#A0A7B4' })], { cs: cols.length, ...all, m: [mm(2), mm(2), mm(1.5), mm(1.5)], minH: mm(22) })], { kind: 'slotq' }),
    row(ctx, cols.map((cName) => cell([P(ctx, [T(cName, { b: true, font: dot })], { align: 'CENTER', line: 120, size: Math.round(ctx.fs * 0.9) })], { ...all, fill: th.headSoft, v: 'CENTER', m: [mm(1), mm(1), mm(0.8), mm(0.8)] })), { kind: 'slotcols' }),
    row(ctx, cols.map(() => cell([], { ...all, m: [mm(2), mm(2), mm(1), mm(1)] })), { flex: 1, kind: 'slotwrite', minH: mm(20) }),
  ];
  return table(ctx, ws, rows);
}

// ---------- 차시 하나 → 모델 ----------
export function composeLesson(doc, lesson, li, opts) {
  const ctx = makeCtx({ ...opts, idPrefix: `L${li}-` });
  const comp = opts.composition;
  const header = headerTable(ctx, doc, lesson);
  const thinkAct = comp.activities.find((a) => a.type === 'think');
  const sections = lesson.sections.map((s, si) => {
    const sec = { no: si + 1, title: s.title || `주제 ${si + 1}`, pages: s.pages };
    const widths = sectionWidths(ctx, sec);
    sec.widths = widths;
    let blocks = s.blocks.slice();
    // 교사 작성 활동(예: 생각해보기를 교사가 직접)은 앱이 빈 칸으로 넣음
    if (thinkAct && thinkAct.use && thinkAct.source === 'teacher') {
      blocks = blocks.filter((b) => b.type !== 'think');
      if (comp.thinkPlace === 'section' || si === lesson.sections.length - 1) blocks.push({ type: 'slot', title: thinkAct.title, hint: `${thinkAct.title} 문제를 직접 넣는 칸입니다.`, space: 30, figures: [] });
    } else if (thinkAct && !thinkAct.use) {
      blocks = blocks.filter((b) => b.type !== 'think');
    }
    // 구성에서 꺼진 역할의 블록은 뺌 (도입·개념 도입 예시·예제·문제는 역할로 구분)
    const off = new Set(comp.activities.filter((a) => !a.use && a.type !== 'think').map((a) => a.type));
    blocks = blocks.filter((b) => b.type === 'table' || b.type === 'slot' || !off.has(roleOf(b)));
    if (si === 0 && lesson.review) blocks.unshift({ type: 'review', title: lesson.review.title, items: lesson.review.items, figures: [] });
    const blockList = blocks
      .map((b, bi) => {
        const spec = blockSpec(ctx, b, comp);
        if (!spec) return null;
        const realIndex = s.blocks.indexOf(b);
        return { rows: blockRows(ctx, spec, sec, realIndex >= 0 ? [li, si, realIndex] : null), spacer: boxStyle(ctx, spec.type).spacer, type: spec.type, bi };
      })
      .filter(Boolean);
    return {
      id: ctx.id('s'),
      widths,
      head: sectionHead(ctx, sec, widths, false),
      contHead: sectionHead(ctx, sec, widths, true),
      blocks: blockList,
    };
  });
  return { ctx, header, sections };
}

// 블록 사이 띄움 줄
export function spacerRow(ctx, ncol, h = mm(1.8), id) {
  const r = { id: id || ctx.id('r'), cells: [cell([], { cs: ncol, m: [0, 0, 0, 0] })], minH: h, flex: 0, kind: 'spacer', h0: h, h };
  return r;
}

export function newCtx(opts) {
  return makeCtx(opts);
}
