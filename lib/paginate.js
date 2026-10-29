// 쪽 맞춤: 차시마다 정확히 2쪽(머리 표 + 주제별 표), 표는 쪽을 넘기지 않고
// 쪽 아래 빈 공간은 풀이 공간 등으로 채웁니다. 이어서 교사 작성 쪽(기출·수능특강)을 붙입니다.

import { composeLesson, spacerRow, practiceSlotTable, newCtx, PAGE, TABLE_GAP, mm } from './compose';
import { measureTable } from './measure';

const CAP = PAGE.BODY_H - mm(4); // 추정 오차에 대비한 여유(약 4mm)
const SCALES = [1, 0.95, 0.9, 0.85];

function forEachRow(tbl, fn) {
  for (const r of tbl.rows) {
    fn(r);
    for (const c of r.cells) for (const p of c.paras) for (const n of p.nodes) if (n.t === 'tbl') forEachRow(n.table, fn);
  }
}

function lessonTables(model) {
  // 높이 측정용 임시 표들
  const list = [model.header];
  model.sections.forEach((s) => {
    list.push({ widths: s.widths, rows: [s.head] });
    list.push({ widths: s.widths, rows: [s.contHead] });
    s.blocks.forEach((b) => list.push({ widths: s.widths, rows: b.rows }));
  });
  return list;
}

function measureLesson(model, teacher) {
  const ctx = { teacher };
  for (const t of lessonTables(model)) measureTable(t, ctx);
}

const blockH = (b) => b.rows.reduce((a, r) => a + r.h0, 0);
function isFlexBlock(b) {
  return b.rows.some((r) => r.flex > 0 || r.cells.some((c) => c.paras.some((p) => p.nodes.some((n) => n.t === 'tbl' && n.grow && n.table.rows.some((x) => x.flex > 0)))));
}
const SPACER_H = mm(1.8);

function pieceHeight(model, si, from, to, cont) {
  const s = model.sections[si];
  let h = (cont ? s.contHead : s.head).h0;
  for (let i = from; i < to; i++) {
    h += blockH(s.blocks[i]);
    if (i > from && s.blocks[i].spacer) h += SPACER_H;
  }
  return h;
}

// 블록 목록 [a,b) 를 쪽 하나로 배치했을 때의 표(조각)들
function piecesOf(model, flat, a, b) {
  const pieces = [];
  let i = a;
  while (i < b) {
    const si = flat[i].si;
    let j = i;
    while (j < b && flat[j].si === si) j++;
    const from = flat[i].bi;
    const to = flat[j - 1].bi + 1;
    pieces.push({ si, from, to, cont: from > 0, h: pieceHeight(model, si, from, to, from > 0) });
    i = j;
  }
  return pieces;
}

function pageHeight(pieces, extra = 0) {
  const n = pieces.length + (extra ? 1 : 0);
  return pieces.reduce((a, p) => a + p.h, 0) + extra + Math.max(0, n - 1) * TABLE_GAP;
}

// 학생용·교사용은 쪽마다 같은 블록(표)을 담고, 둘 다 쪽 안에 들어가야 함
function bothHeight(models, flat, a, b, first) {
  return Math.max(...models.map((m) => pageHeight(piecesOf(m, flat, a, b), first ? m.header.h0 : 0)));
}

function plan(models, pagesWanted = 2) {
  const model = models[0];
  const flat = [];
  model.sections.forEach((s, si) => s.blocks.forEach((_, bi) => flat.push({ si, bi })));
  const N = flat.length;
  if (N === 0) return { ok: true, breaks: [], pages: [[]] };
  if (pagesWanted === 1 || N === 1) {
    const p = piecesOf(model, flat, 0, N);
    return { ok: bothHeight(models, flat, 0, N, true) <= CAP, pages: [p] };
  }
  let best = null;
  for (let k = 1; k < N; k++) {
    const p1 = piecesOf(model, flat, 0, k);
    const p2 = piecesOf(model, flat, k, N);
    const h1 = bothHeight(models, flat, 0, k, true);
    const h2 = bothHeight(models, flat, k, N, false);
    if (h1 > CAP || h2 > CAP) continue;
    const mid = flat[k].bi > 0 ? 0.22 : 0;
    // 풀이 공간처럼 늘어날 칸이 없는 쪽에 빈 공간이 크게 남으면 감점
    const flexPen = (pcs, h) => (pcs.some((pc) => model.sections[pc.si].blocks.slice(pc.from, pc.to).some(isFlexBlock)) ? 0 : ((CAP - h) / CAP) * 3);
    const score = mid + Math.abs((CAP - h1) - (CAP - h2)) / CAP + flexPen(p1, h1) + flexPen(p2, h2);
    if (!best || score < best.score) best = { score, pages: [p1, p2] };
  }
  if (best) return { ok: true, pages: best.pages };
  return { ok: false };
}

// 많을 때: 2쪽을 넘기면 쪽을 늘려 차례로 채움
function greedyPlan(models) {
  const model = models[0];
  const flat = [];
  model.sections.forEach((s, si) => s.blocks.forEach((_, bi) => flat.push({ si, bi })));
  const pages = [];
  let a = 0;
  let first = true;
  while (a < flat.length) {
    let b = a + 1;
    while (b < flat.length && bothHeight(models, flat, a, b + 1, first) <= CAP) b++;
    pages.push(piecesOf(model, flat, a, b));
    a = b;
    first = false;
  }
  return { ok: true, pages };
}

// 남는 높이를 풀이 칸(늘어날 수 있는 줄)에 나눔. 단, 한 줄이 지나치게 넓어지지 않게 늘릴 수 있는 양에 한도를 둠
// (2쪽을 억지로 채우려고 풀이 칸을 크게 만들지 않음. 다 못 쓴 높이는 쪽 아래 여백으로 남김)
const GROW_ITEM = mm(14); // 문항 줄 하나당 최대 추가 높이
const GROW_ROW = mm(30); // 일반 늘어나는 줄의 최대 추가 높이
function growRows(rowsList, slack) {
  const entries = [];
  for (const r of rowsList) {
    let w = r.flex || 0;
    const nested = [];
    for (const c of r.cells)
      for (const p of c.paras)
        for (const n of p.nodes)
          if (n.t === 'tbl' && n.grow) {
            const fr = n.table.rows.filter((x) => x.flex > 0);
            if (fr.length) nested.push({ table: n.table, rows: fr });
          }
    const nRows = nested.reduce((a, x) => a + x.rows.length, 0);
    const nw = nested.reduce((a, x) => a + x.rows.reduce((s, y) => s + y.flex, 0), 0);
    if (nw > 0 && !w) w = nw;
    if (w > 0) entries.push({ r, w, nested, cap: nRows ? GROW_ITEM * nRows : r.kind === 'slotwrite' ? Infinity : GROW_ROW, got: 0 });
  }
  if (!entries.length) return { used: 0, any: false };
  // 한도 안에서 비율대로 나누기 (물 채우기)
  let left = slack;
  let open = entries.slice();
  for (let round = 0; round < 6 && left > 1 && open.length; round++) {
    const W = open.reduce((a, e) => a + e.w, 0);
    const give = left;
    open.forEach((e) => {
      const share = Math.min(Math.floor((give * e.w) / W), e.cap - e.got);
      e.got += share;
      left -= share;
    });
    open = open.filter((e) => e.got < e.cap);
  }
  for (const e of entries) {
    if (!e.got) continue;
    e.r.h += e.got;
    if (e.nested.length) {
      // 같은 칸 안의 내부 표 줄에도 똑같이 나눔
      const rows = e.nested.flatMap((x) => x.rows);
      const tw = rows.reduce((a, y) => a + y.flex, 0);
      let l2 = e.got;
      rows.forEach((y, j) => {
        const s2 = j === rows.length - 1 ? l2 : Math.floor((e.got * y.flex) / tw);
        l2 -= s2;
        y.h += s2;
      });
    }
  }
  return { used: slack - left, any: true };
}

function buildPage(model, pieces, withHeader) {
  const tables = [];
  if (withHeader) tables.push({ id: model.header.id, widths: model.header.widths, rows: model.header.rows });
  for (const pc of pieces) {
    const s = model.sections[pc.si];
    const rows = [pc.cont ? s.contHead : s.head];
    for (let i = pc.from; i < pc.to; i++) {
      const b = s.blocks[i];
      if (i > pc.from && b.spacer) rows.push(spacerRow(model.ctx, s.widths.length, SPACER_H, `${s.id}-sp${i}`));
      rows.push(...b.rows);
    }
    tables.push({ id: `${s.id}-${pc.from}`, widths: s.widths, rows });
  }
  return tables;
}

function initHeights(tbls) {
  for (const t of tbls) forEachRow(t, (r) => (r.h = r.h0 ?? r.minH ?? 0));
}

function fillPage(tables) {
  const used = tables.reduce((a, t) => a + t.rows.reduce((s, r) => s + r.h, 0), 0) + Math.max(0, tables.length - 1) * TABLE_GAP;
  const slack = CAP - used;
  if (slack <= 0) return slack;
  const rows = tables.flatMap((t) => t.rows);
  const g = growRows(rows, slack);
  const rest = slack - g.used;
  if (rest > mm(3)) {
    // 풀이 칸이 없거나 한도까지 늘린 쪽: 각 활동 칸 아래에 조금씩(칸당 최대 6mm)만 나누고 나머지는 쪽 아래 여백으로
    const boxes = rows.filter((r) => !['spacer', 'shead', 'head', 'phead', 'tnote'].includes(r.kind));
    if (boxes.length) {
      const each = Math.min(mm(6), Math.floor(rest / boxes.length));
      boxes.forEach((r) => (r.h += each));
    }
  }
  return slack;
}

function practicePages(opts, li) {
  const pr = opts.composition.practice;
  if (!pr || !pr.enabled) return { student: [], teacher: [] };
  const labels = pr.items.flatMap((it) => Array(it.count).fill(it.label));
  if (!labels.length) return { student: [], teacher: [] };
  const out = { student: [], teacher: [] };
  for (const mode of ['student', 'teacher']) {
    const ctx = newCtx({ ...opts, teacher: mode === 'teacher', idPrefix: `P${li}-` });
    for (let i = 0; i < labels.length; i += pr.perPage) {
      const group = labels.slice(i, i + pr.perPage);
      const k = group.length;
      const tH = Math.floor((CAP - (k - 1) * TABLE_GAP) / k);
      const tables = group.map((label) => {
        const t = practiceSlotTable(ctx, label, pr.columns);
        measureTable(t, { teacher: mode === 'teacher' });
        t.rows.forEach((r) => (r.h = r.h0));
        const used = t.rows.reduce((a, r) => a + r.h, 0);
        const wr = t.rows.find((r) => r.kind === 'slotwrite');
        wr.h += Math.max(0, tH - used);
        return t;
      });
      // 칸 수가 적은 마지막 쪽도 쪽을 꽉 채움
      const used = tables.reduce((a, t) => a + t.rows.reduce((s, r) => s + r.h, 0), 0) + (k - 1) * TABLE_GAP;
      const extra = CAP - used;
      if (extra > 0) {
        const each = Math.floor(extra / k);
        tables.forEach((t) => (t.rows.find((r) => r.kind === 'slotwrite').h += each));
      }
      out[mode].push(tables);
    }
  }
  return out;
}

// 문서 전체 배치. 반환: { lessons:[{student:[쪽들], teacher:[쪽들], scale, pages, warn}] }
// (전체 글자 크기, 교사용 해설·코멘트 크기) 순서대로 시도.
// 교사용 글이 많아 교사용 쪽이 넘치면 먼저 교사용 해설·지도 코멘트만 작게 줄이고, 그래도 안 되면 전체를 줄임
const COMBOS = [
  [1, 1],
  [1, 0.93],
  [1, 0.86],
  [1, 0.78],
  [0.95, 0.78],
  [0.9, 0.78],
  [0.85, 0.78],
];

export function layoutDocument(doc, opts) {
  const lessons = [];
  doc.lessons.forEach((lesson, li) => {
    let chosen = null;
    for (let ci = 0; ci < COMBOS.length && !chosen; ci++) {
      const [scale, tScale] = COMBOS[ci];
      const S = composeLesson(doc, lesson, li, { ...opts, teacher: false, scale, tScale });
      const T = composeLesson(doc, lesson, li, { ...opts, teacher: true, scale, tScale });
      measureLesson(S, false);
      measureLesson(T, true);
      // 1쪽에 넉넉히 들어가면 1쪽, 아니면 2쪽 (2쪽을 억지로 채우지 않음)
      let p = scale === 1 ? plan([S, T], 1) : { ok: false };
      if (!p.ok) p = plan([S, T], 2);
      if (p.ok) chosen = { S, T, p, scale, tScale };
      else if (ci === COMBOS.length - 1) chosen = { S, T, p: greedyPlan([S, T]), scale, tScale, over: true };
    }
    const { S, T, p, scale, tScale } = chosen;
    // 같은 블록 배치, 높이는 각자: 남는 공간은 각자의 풀이 칸에 나눔
    const sPages = p.pages.map((pieces, pi) => buildPage(S, pieces, pi === 0));
    const tPages = p.pages.map((pieces, pi) => buildPage(T, pieces, pi === 0));
    for (const tables of [...sPages, ...tPages]) {
      initHeights(tables);
      fillPage(tables);
    }
    const prac = practicePages(opts, li);
    let warn = '';
    if (chosen.over) warn = `${lesson.no}차시는 내용이 많아 ${sPages.length}쪽이 되었습니다. 교과서 쪽 범위를 줄이거나 "수정 요청"으로 분량을 줄여 주세요.`;
    else if (scale < 1) warn = `${lesson.no}차시는 2쪽에 맞추려고 글자 크기를 ${Math.round(scale * 100)}%로 줄였습니다.`;
    else if (sPages.length < 2) warn = `${lesson.no}차시는 1쪽에 들어가서 1쪽으로 만들었습니다.`;
    if (!chosen.over && tScale < 1) warn = [warn, `${lesson.no}차시는 교사용 해설·지도 코멘트가 많아 교사용 글씨를 ${Math.round(tScale * 100)}%로 줄여 학생용과 같은 쪽 구성에 맞췄습니다.`].filter(Boolean).join(' ');
    lessons.push({
      student: [...sPages, ...prac.student],
      teacher: [...tPages, ...prac.teacher],
      mainPages: sPages.length,
      scale,
      tScale,
      warn,
    });
  });
  return { lessons };
}

export { CAP };
