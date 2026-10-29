// 문서 모델의 높이를 한컴오피스 줄 배치 규칙에 맞춰 추정합니다.
//
// 한컴 규칙(실제 HWPX 줄 정보로 확인):
//   줄 높이 = max(글자 크기, 그 줄의 가장 큰 수식·그림 높이) + 글자 크기 × (줄 간격% − 100%)
//   문단 높이 = 줄 높이 합 + 문단 위·아래 간격,  칸 높이 = 문단 합 + 칸 위·아래 여백
// 글자 폭은 한컴이 만든 PDF에서 잰 함초롬 글꼴 폭(한글 0.97em, 공백 0.3em, 숫자 0.55em)을
// 조금 넉넉하게 잡았습니다. 넘치면 표가 다음 쪽으로 밀리므로 항상 크게 잡는 쪽을 택합니다.

import { latexToHwp } from './latex2hwp';
import { measureHwpEquation } from './eqMeasure';
import { blankEm } from './rich';

const WRAP_SAFETY = 0.95; // 실제 줄 폭의 95%만 쓴다고 보고 줄바꿈 계산

const eqCache = new Map();
export function eqSize(latex, size) {
  const key = `${size}|${latex}`;
  if (eqCache.has(key)) return eqCache.get(key);
  const script = latexToHwp(latex);
  const m = script ? measureHwpEquation(script, size) : { width: 0, height: size, baseLine: 86 };
  const out = { script, width: m.width + 112, height: m.height, baseLine: m.baseLine };
  if (eqCache.size > 5000) eqCache.clear();
  eqCache.set(key, out);
  return out;
}

export function charEm(ch) {
  const c = ch.codePointAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return 1.0;
  if ((c >= 0x3131 && c <= 0x318e) || (c >= 0x3000 && c <= 0x33ff) || (c >= 0xff00 && c <= 0xffef)) return 1.0;
  if (c >= 0x2460 && c <= 0x27bf) return 1.0; // ①, ■, ★, ▶ 등
  if (c >= 0x2190 && c <= 0x22ff) return 1.0;
  if (c >= 0x4e00 && c <= 0x9fff) return 1.0;
  if (ch === ' ') return 0.3;
  if (ch === '·') return 0.35;
  if (/[0-9]/.test(ch)) return 0.55;
  if (/[A-Z]/.test(ch)) return 0.7;
  if (/[a-z]/.test(ch)) return 0.52;
  if (/[.,:;'"`()[\]{}|!]/.test(ch)) return 0.32;
  if (ch === '-' || ch === '~') return 0.4;
  return 0.6;
}

export function textWidth(str, size, bold = false) {
  let w = 0;
  for (const ch of str) w += charEm(ch);
  return w * size * (bold ? 1.04 : 1);
}

// 문단을 "원자" 목록으로: {w, h, space(앞에 공백이 있어 줄을 나눌 수 있음)}
function atomsOf(p, ctx) {
  const atoms = [];
  let pendingSpace = false;
  const add = (w, h) => {
    atoms.push({ w, h, space: pendingSpace || atoms.length === 0 });
    pendingSpace = false;
  };
  // 붙어 있는 원자는 하나의 단어로 이어 붙임
  const glue = (w, h) => {
    if (!pendingSpace && atoms.length) {
      const a = atoms[atoms.length - 1];
      a.w += w;
      a.h = Math.max(a.h, h);
    } else add(w, h);
  };
  for (const n of p.nodes) {
    const size = n.size || p.size;
    if (n.t === 'text' || n.t === 'hint') {
      const parts = String(n.v).split(/( +)/);
      for (const part of parts) {
        if (!part) continue;
        if (/^ +$/.test(part)) {
          if (atoms.length) atoms[atoms.length - 1].w += 0; // 공백 폭은 줄 끝에서 사라짐
          pendingSpace = true;
          if (atoms.length) atoms[atoms.length - 1].trail = textWidth(part, size);
          continue;
        }
        glue(textWidth(part, size, n.b || p.bold), size);
      }
    } else if (n.t === 'math') {
      const e = eqSize(n.v, size);
      glue(e.width, Math.max(size, e.height));
    } else if (n.t === 'blank') {
      glue(blankWidth(n, size, ctx) + size * 0.6, blankLineHeight(n, size, ctx));
    } else if (n.t === 'img') {
      glue(n.w, n.h);
    } else if (n.t === 'tbl') {
      const h = measureTable(n.table, ctx);
      glue(n.table.widths.reduce((a, b) => a + b, 0), h);
    } else if (n.t === 'gap') {
      glue(n.w || size, size);
    }
  }
  return atoms;
}

// 학생용 빈칸은 직접 써넣기 쉽게 더 크게 (교사용은 그대로)
export const STUDENT_BLANK_SIZE = 1.22; // 빈칸 글자 크기(=칸 높이) 배율
export const STUDENT_BLANK_WIDTH = 1.35; // 칸 너비 배율

export function blankWidth(n, size, ctx) {
  let ansW = 0;
  for (const a of n.ans || []) {
    if (a.t === 'text') ansW += textWidth(a.v, size, true);
    else if (a.t === 'math') ansW += eqSize(a.v, size).width;
  }
  const em = Math.max(blankEm(n), ansW / size + 1.2);
  if (!ctx?.teacher) return Math.round(Math.max(em * STUDENT_BLANK_WIDTH, 3) * size);
  return Math.round(em * size);
}

export function blankHeight(n, size, ctx) {
  if (!ctx?.teacher) return Math.round(size * STUDENT_BLANK_SIZE);
  const hasMath = (n.ans || []).some((a) => a.t === 'math');
  if (!hasMath) return size;
  let h = size;
  for (const a of n.ans) if (a.t === 'math') h = Math.max(h, eqSize(a.v, size).height);
  return Math.round(h + 260);
}

// 줄 높이 계산용: 글자처럼 넣은 1칸 표는 한컴에서 줄을 더 차지하는 경우가 있어 넉넉히
export function blankLineHeight(n, size, ctx) {
  const h = blankHeight(n, size, ctx);
  return ctx?.teacher && h > size ? Math.round(h * 1.25) : h;
}

export function paraHeight(p, width, ctx) {
  const atoms = atomsOf(p, ctx);
  const W = Math.max(1000, (width - (p.left || 0)) * WRAP_SAFETY);
  const extra = (p.size * ((p.line || 160) - 100)) / 100;
  let lines = 0;
  let total = 0;
  let lineW = 0;
  let lineH = p.size;
  const flush = () => {
    total += Math.max(p.size, lineH) + extra;
    lines++;
    lineW = 0;
    lineH = p.size;
  };
  for (const a of atoms) {
    const spaceW = a.space && lineW > 0 ? p.size * 0.3 : 0;
    if (lineW > 0 && lineW + spaceW + a.w > W) flush();
    if (a.w > W && lineW === 0 && a.h <= p.size * 1.2) {
      // 줄보다 긴 단어는 글자 단위로 나뉨
      const n = Math.ceil(a.w / W);
      for (let i = 0; i < n - 1; i++) {
        lineH = Math.max(lineH, a.h);
        flush();
      }
      lineW = a.w - (n - 1) * W;
      lineH = Math.max(lineH, a.h);
      continue;
    }
    lineW += (lineW > 0 ? spaceW : 0) + a.w;
    lineH = Math.max(lineH, a.h);
  }
  if (lineW > 0 || lines === 0) flush();
  return Math.round(total + (p.prev || 0) + (p.next || 0));
}

export function cellContentHeight(cell, width, ctx) {
  const [ml, mr, mt, mb] = cell.m;
  const inner = width - ml - mr;
  let h = 0;
  for (const p of cell.paras) h += paraHeight(p, inner, ctx);
  return Math.round(h + mt + mb + (cell.space || 0));
}

// 표의 각 줄 자연 높이(h0)를 계산하고 표 전체 높이를 돌려줌
export function measureTable(table, ctx) {
  const { widths, rows } = table;
  const occupied = [];
  const spans = [];
  rows.forEach((row, r) => {
    occupied[r] = occupied[r] || [];
    let c = 0;
    let h0 = row.minH || 0;
    row.cells.forEach((cell) => {
      while (occupied[r][c]) c++;
      const cs = cell.cs || 1;
      const rs = cell.rs || 1;
      for (let rr = r; rr < r + rs; rr++) {
        occupied[rr] = occupied[rr] || [];
        for (let cc = c; cc < c + cs; cc++) occupied[rr][cc] = true;
      }
      const w = widths.slice(c, c + cs).reduce((a, b) => a + b, 0);
      cell._w = w;
      cell._c = c;
      const need = Math.max(cell.minH || 0, cellContentHeight(cell, w, ctx));
      cell._need = need;
      if (rs === 1) h0 = Math.max(h0, need);
      else spans.push({ r, rs, need });
      c += cs;
    });
    row.h0 = Math.max(h0, 400);
  });
  for (const sp of spans) {
    const sum = rows.slice(sp.r, sp.r + sp.rs).reduce((a, x) => a + x.h0, 0);
    if (sp.need > sum) rows[sp.r + sp.rs - 1].h0 += sp.need - sum;
  }
  table.h0 = rows.reduce((a, x) => a + x.h0, 0);
  return table.h0;
}
