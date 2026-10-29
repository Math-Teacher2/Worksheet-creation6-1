// 학습지 만들기 작업 진행기 (소단원 단위)
//  0) 단원 목차: 올린 교과서·지도서 PDF를 소단원별로 나눔 (쪽마다 제목 글자만 보내는 가벼운 요청 1번)
//  1) 소단원 하나를 고르면 → 차시 계획(그 소단원 쪽만) → 차시마다 작성 → (선택) 검산
//  2) 소단원이 끝나면 다음 소단원을 만들지 물어봄. 끝난 차시는 바로 화면에 붙고 브라우저에 저장됨
//  오류가 나도 끝난 차시는 남고, [이어서 만들기]로 남은 차시만 만듦

import { generate } from './llm';
import { LlmError, explainError, STOP_KINDS } from './errors';
import { buildSystemPrompt, buildChunkInstruction, PLAN_SYSTEM, buildPlanInstruction, VERIFY_SYSTEM, buildVerifyInstruction, TOC_SYSTEM, buildTocInstruction } from './prompt';
import { parseModelJson } from './jsonRepair';
import { normalizeDoc, collectAnswerItems, applyAnswerFixes } from './doc';
import { snapToCandidate } from './figCandidates';

const str = (v) => (v === undefined || v === null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

export const fileKey = (file) => (file ? `${file.name}|${file.size}` : '');

export function newJob({ file, kind = 'textbook' }) {
  return {
    v: 2,
    key: fileKey(file),
    fileName: file?.name || '',
    fileSize: file?.size || 0,
    kind, // textbook | guide(교사용 교과서·지도서)
    createdAt: Date.now(),
    toc: null, // {subject, unit, units:[{id, chapterNo, chapterTitle, title, pages:[from,to], kind, selected}]}
    units: {}, // id -> {plan, chunks, status}
    usage: { input: 0, output: 0 },
    requests: 0,
  };
}

export const unitPages = (u) => range(u.pages[0], u.pages[1]);
export const unitName = (u) => `${u.chapterNo ? `${u.chapterNo} ` : ''}${u.title || u.chapterTitle || `${u.pages[0]}~${u.pages[1]}쪽`}`;

export const chunkName = (ch) => {
  const ls = ch.lessons || [];
  if (ls.length && ls[0].auto) return `교과서 ${ch.pages[0]}~${ch.pages[ch.pages.length - 1]}쪽`;
  const nos = ls.map((l) => l.no);
  return nos.length > 1 ? `${nos[0]}~${nos[nos.length - 1]}차시` : `${nos[0]}차시`;
};

export function unitProgress(job, unitId) {
  const st = job?.units?.[unitId];
  if (!st || !st.chunks.length) return { done: 0, total: 0, failed: 0, complete: false, started: !!st?.plan };
  const done = st.chunks.filter((c) => c.status === 'done').length;
  const failed = st.chunks.filter((c) => c.status === 'fail').length;
  return { done, total: st.chunks.length, failed, complete: done === st.chunks.length, started: true };
}

// 화면 순서(목차 순서)대로 모든 차시 묶음 id
export function globalOrder(job) {
  if (!job?.toc) return [];
  return job.toc.units.flatMap((u) => (job.units[u.id]?.chunks || []).map((c) => c.id));
}

// 다음에 만들 소단원 (선택된 것 중 아직 다 끝나지 않은 첫 소단원)
export function nextUnit(job, afterId) {
  if (!job?.toc) return null;
  const list = job.toc.units;
  const start = afterId ? list.findIndex((u) => u.id === afterId) + 1 : 0;
  return list.slice(start).find((u) => u.selected && !unitProgress(job, u.id).complete) || null;
}

export function estimateRequests(job, unit, { verify, perChunk }) {
  const st = job?.units?.[unit?.id];
  const pages = unit ? unit.pages[1] - unit.pages[0] + 1 : 0;
  const planReq = st?.plan ? 0 : pages > 4 ? 1 : 0;
  const nChunks = st?.chunks?.length ? st.chunks.filter((c) => c.status !== 'done').length : Math.max(1, Math.ceil(pages / (3 * (perChunk || 1))));
  return { plan: planReq, chunks: nChunks, total: planReq + nChunks * (verify ? 2 : 1), approx: !st?.chunks?.length };
}

// ---------- 0) 단원 목차 ----------
function normalizeToc(raw, total) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const units = arr(src.units)
    .map((u) => {
      const o = u && typeof u === 'object' ? u : {};
      const pg = arr(o.pages).map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= total);
      if (!pg.length) return null;
      const a = Math.min(...pg);
      const b = Math.max(...pg);
      return {
        chapterNo: str(o.chapterNo).trim(),
        chapterTitle: str(o.chapterTitle).trim(),
        title: str(o.title || o.section).trim(),
        pages: [a, b],
        kind: o.kind === 'review' ? 'review' : 'lesson',
      };
    })
    .filter(Boolean)
    .sort((x, y) => x.pages[0] - y.pages[0]);
  units.forEach((u, i) => {
    u.id = `u${i + 1}`;
    u.selected = u.kind === 'lesson';
  });
  return { subject: str(src.subject), unit: str(src.unit), units };
}

// 쪽 범위를 직접 정한 소단원
export function customUnit(job, from, to, title) {
  const n = (job?.toc?.units || []).filter((u) => u.id.startsWith('c')).length + 1;
  return { id: `c${n}`, chapterNo: '', chapterTitle: '', title: title || `직접 지정 ${from}~${to}쪽`, pages: [from, to], kind: 'lesson', selected: true };
}

/**
 * 단원 목차 만들기: 쪽마다 큰 글씨(제목)와 첫 글자만 보내 소단원과 쪽 범위를 찾음.
 * 글자 정보가 없는 PDF(스캔본)는 축소 이미지를 보냄(최대 90장).
 */
export async function buildToc({ llm, file, kind, subject, content, signal, cb }) {
  const { pageOutline, renderForAi, getPageCount } = await import('./pdfClient');
  const total = await getPageCount(file);
  const max = Math.min(total, 400);
  const outlines = [];
  for (let p = 1; p <= max; p++) {
    outlines.push(await pageOutline(file, p));
    if (p % 10 === 0) cb.status(`단원 목차를 만들려고 쪽 제목을 읽는 중... (${p}/${max})`);
  }
  const noText = outlines.filter((o) => !o.lead).length;
  const parts = [];
  const lines = outlines.map((o) => `[${o.page}] 제목: ${o.headings || '-'} | 본문: ${o.lead || '(글자 없음)'}`);
  parts.push({ type: 'text', text: `[PDF 쪽별 제목·첫 글자] 총 ${total}쪽${total > max ? ` (앞 ${max}쪽만)` : ''}\n${lines.join('\n')}` });
  if (noText > max * 0.3) {
    // 스캔본: 축소 이미지 (요청 하나에 넣을 수 있는 이미지 수 제한 때문에 최대 90장, 고르게 뽑음)
    const step = Math.max(1, Math.ceil(max / 90));
    for (let p = 1; p <= max; p += step) {
      const im = await renderForAi(file, p, { width: 420, quality: 0.55 });
      parts.push({ type: 'text', text: `[${p}쪽 축소 이미지]` });
      parts.push({ type: 'image', mime: im.mime, data: im.data, res: 'low' });
      cb.status(`단원 목차 준비 중... 이미지 (${p}/${max})`);
    }
  }
  parts.push({ type: 'text', text: buildTocInstruction({ subject, kind, total: max }) });
  cb.status('AI가 소단원별로 나누는 중...');
  const r = await generate({
    ...llm,
    system: TOC_SYSTEM,
    parts,
    json: true,
    maxTokens: 12000,
    thinking: 'low',
    fallback: content?.fallback,
    signal,
    onStatus: (m, info) => {
      cb.status(`단원 목차: ${m}`);
      cb.log({ level: 'wait', text: `[단원 목차] ${m}`, error: info?.error ? explainError(info.error) : null });
    },
    onText: (t) => cb.status(`AI가 소단원별로 나누는 중... (${t.length.toLocaleString()}자)`),
  });
  let toc;
  try {
    toc = normalizeToc(parseModelJson(r.text, { allowTruncated: true }), max);
  } catch {
    toc = { units: [] };
  }
  if (!toc.units.length) throw new LlmError('parse', { model: r.model, raw: '단원 목차(units)가 비어 있음' });
  return { toc, usage: r.usage, model: r.model };
}

// ---------- 1) 차시 계획 ----------
function normalizePlan(raw, pages) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const lessons = arr(src.lessons)
    .map((l) => {
      const o = l && typeof l === 'object' ? l : {};
      const pg = [...new Set(arr(o.pages).map((x) => parseInt(x, 10)).filter((x) => pages.includes(x)))].sort((a, b) => a - b);
      return {
        chapterNo: str(o.chapterNo).trim(),
        chapterTitle: str(o.chapterTitle),
        topic: str(o.topic),
        pages: pg,
        sections: arr(o.sections).map(str).filter((x) => x.trim()).slice(0, 4),
      };
    })
    .filter((l) => l.pages.length);
  lessons.forEach((l, i) => (l.no = i + 1));
  return { subject: str(src.subject), unit: str(src.unit), lessons };
}

function fallbackPlan(pages) {
  const lessons = [];
  for (let i = 0; i < pages.length; i += 3) lessons.push({ no: lessons.length + 1, pages: pages.slice(i, i + 3), auto: true, sections: [] });
  return { subject: '', unit: '', lessons, fallback: true };
}

function groupChunks(plan, perChunk, unitId) {
  const chunks = [];
  const n = plan.lessons.some((l) => l.auto) ? 1 : Math.max(1, perChunk || 1);
  for (let i = 0; i < plan.lessons.length; i += n) {
    const ls = plan.lessons.slice(i, i + n);
    chunks.push({
      id: `${unitId}.${chunks.length + 1}`,
      lessons: ls,
      pages: [...new Set(ls.flatMap((l) => l.pages))].sort((a, b) => a - b),
      status: 'todo',
      error: null,
      usage: { input: 0, output: 0 },
    });
  }
  return chunks;
}

// AI가 고른 그림 후보 번호(cand)를 상자로 바꾸고, 직접 준 상자는 가장 잘 맞는 후보에 붙임
export function resolveFigures(raw, candsByPage, { dropMargin = false } = {}) {
  if (!raw || !Array.isArray(raw.figures)) return { snapped: 0, byCand: 0, dropped: 0 };
  let dropped = 0;
  const byId = new Map();
  Object.values(candsByPage).forEach((list) => list.forEach((c) => byId.set(c.id.toUpperCase(), c)));
  let snapped = 0;
  let byCand = 0;
  raw.figures.forEach((f) => {
    if (!f || typeof f !== 'object') return;
    const ids = String(f.cand || f.candidate || '').toUpperCase().split(/[+,\s]+/).filter(Boolean);
    const hits = ids.map((id) => byId.get(id)).filter(Boolean);
    if (hits.length && dropMargin && hits.every((c) => c.margin)) {
      f.box = null; // 지도서 여백 그림 → 버림 (normalizeDoc에서 빠지고 참조도 지워짐)
      dropped++;
      return;
    }
    if (hits.length && hits.every((c) => c.page === hits[0].page)) {
      f.page = hits[0].page;
      f.box = hits.reduce((a, c) => [Math.min(a[0], c.box[0]), Math.min(a[1], c.box[1]), Math.max(a[2], c.box[2]), Math.max(a[3], c.box[3])], [1000, 1000, 0, 0]);
      f.snap = true;
      byCand++;
      return;
    }
    const page = parseInt(f.page, 10);
    if (Array.isArray(f.box) && f.box.length === 4 && candsByPage[page]) {
      const bx = f.box.map(Number);
      const inMargin = bx[3] - bx[1] <= 240 && (bx[3] <= 240 || bx[1] >= 760);
      const c = snapToCandidate(bx, candsByPage[page]);
      if (dropMargin && (inMargin || (c && c.margin))) {
        f.box = null;
        dropped++;
        return;
      }
      if (c) {
        f.box = c.box;
        f.snap = true;
        snapped++;
      }
    }
  });
  return { snapped, byCand, dropped };
}

function prefixFigures(d, pre) {
  const map = new Map(d.figures.map((f) => [f.id, `${pre}${f.id}`]));
  const m = (id) => map.get(id) || id;
  d.figures.forEach((f) => (f.id = m(f.id)));
  d.lessons.forEach((l) =>
    l.sections.forEach((s) =>
      s.blocks.forEach((b) => {
        b.figures = (b.figures || []).map(m);
        if (b.type === 'problems') b.items.forEach((it) => (it.figures = (it.figures || []).map(m)));
      })
    )
  );
  return d;
}

// 끝난 차시를 문서에 끼워 넣음 (같은 묶음의 이전 결과는 교체). 차시 번호는 문서 전체에서 1, 2, 3…으로
export function mergeChunk(doc, chunkId, chunkDoc, order, subject) {
  const pos = (c) => {
    const i = order.indexOf(c);
    return i < 0 ? 1e9 : i;
  };
  const keep = (doc?.lessons || []).filter((l) => l.chunk !== chunkId);
  const add = chunkDoc.lessons.map((l) => ({ ...l, chunk: chunkId }));
  const lessons = [...keep, ...add].sort((a, b) => pos(a.chunk) - pos(b.chunk));
  lessons.forEach((l, i) => (l.no = i + 1));
  const pre = `k${chunkId}_`;
  const figures = [...(doc?.figures || []).filter((f) => !String(f.id).startsWith(pre)), ...chunkDoc.figures];
  return normalizeDoc({
    subject: subject || doc?.subject || chunkDoc.subject,
    unit: doc?.unit || chunkDoc.unit,
    lessons,
    figures,
  });
}

/**
 * 소단원 하나 만들기
 * p: {
 *   llm, file, job, unitId, composition, content, subject, scope, extra, verify, rulerMode, imageWidth,
 *   only(차시 묶음 id, 선택), signal,
 *   cb: { status(text), log({level,text,error}), update(job), chunkDone(chunkId, chunkDoc) }
 * }
 */
export async function runUnit(p) {
  const { file, unitId, composition, content, subject, scope, extra, verify, rulerMode, imageWidth, signal, cb, only } = p;
  const { renderForAi } = await import('./pdfClient');
  const job = structuredClone(p.job);
  const unit = job.toc.units.find((u) => u.id === unitId);
  if (!unit) throw new Error('소단원을 찾을 수 없습니다.');
  const st = (job.units[unitId] = job.units[unitId] || { plan: null, chunks: [], status: 'todo' });
  const pages = unitPages(unit);
  const hasGuide = job.kind === 'guide';
  const llm = { ...p.llm };
  const save = () => cb.update(structuredClone(job));
  const uname = unitName(unit);

  const call = async (args, label) => {
    job.requests++;
    const r = await generate({
      ...llm,
      thinking: content.thinking,
      fallback: content.fallback,
      signal,
      onStatus: (m, info) => {
        cb.status(`${label}: ${m}`);
        cb.log({ level: info?.kind === 'fallback' ? 'warn' : 'wait', text: `[${label}] ${m}`, error: info?.error ? explainError(info.error) : null });
      },
      ...args,
    });
    job.usage.input += r.usage?.input || 0;
    job.usage.output += r.usage?.output || 0;
    if (r.model && r.model !== llm.model) {
      cb.log({ level: 'warn', text: `이후 요청은 ${r.model} 모델로 보냅니다(원래 모델이 계속 바빠서).` });
      llm.model = r.model;
    }
    save();
    return r;
  };

  // ----- 차시 계획 (이 소단원 쪽만) -----
  if (!st.plan) {
    if (pages.length <= 4) {
      st.plan = { subject: '', unit: '', lessons: [{ no: 1, pages, auto: true, sections: [] }] };
    } else {
      cb.status(`${uname}: 차시 계획을 세우려고 ${pages.length}쪽을 훑어보는 중...`);
      const parts = [];
      const step = Math.max(1, Math.ceil(pages.length / 40)); // 이미지는 최대 40장
      for (let i = 0; i < pages.length; i++) {
        const pg = pages[i];
        const im = await renderForAi(file, pg, { width: 520, quality: 0.6 });
        parts.push({ type: 'text', text: `[교과서 PDF ${pg}쪽] 글자 일부: ${(im.text || '').slice(0, 400) || '(없음)'}` });
        if (i % step === 0) parts.push({ type: 'image', mime: im.mime, data: im.data, res: 'low' });
      }
      parts.push({ type: 'text', text: buildPlanInstruction({ subject, scope, pageList: pages, unitTitle: uname, hasGuide }) });
      try {
        const r = await call({ system: PLAN_SYSTEM, parts, json: true, maxTokens: 10000, thinking: 'low', onText: (t) => cb.status(`${uname}: 차시 계획을 세우는 중... (${t.length.toLocaleString()}자)`) }, `${uname} 차시 계획`);
        let plan;
        try {
          plan = normalizePlan(parseModelJson(r.text, { allowTruncated: true }), pages);
        } catch {
          plan = { lessons: [] };
        }
        if (!plan.lessons.length) {
          cb.log({ level: 'warn', text: `${uname}: 차시 계획을 읽지 못해 3쪽씩 나눠 만듭니다.` });
          plan = fallbackPlan(pages);
        }
        st.plan = plan;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        const ex = explainError(e);
        cb.log({ level: 'error', text: `${uname} 차시 계획 실패: ${ex.title}`, error: ex });
        throw Object.assign(e, { stopJob: true, stage: `${uname} 차시 계획` });
      }
      cb.log({ level: 'info', text: `${uname}: ${st.plan.lessons.length}차시 — ${st.plan.lessons.map((l) => `${l.topic || l.chapterTitle || ''}(${l.pages[0]}~${l.pages[l.pages.length - 1]}쪽)`).join(', ')}` });
    }
    st.chunks = groupChunks(st.plan, content.perChunk, unitId);
    st.status = 'run';
    save();
  }

  // ----- 차시별 작성 -----
  let prevTopic = '';
  for (const ch of st.chunks) {
    const skip = only !== undefined && only !== null ? ch.id !== only : ch.status === 'done';
    if (skip) {
      prevTopic = ch.lessons.map((l) => l.topic).filter(Boolean).join(', ') || prevTopic;
      continue;
    }
    ch.status = 'run';
    ch.error = null;
    save();
    const u0 = { ...job.usage };
    try {
      const d = await makeChunk(ch, prevTopic);
      ch.status = 'done';
      ch.lessonCount = d.lessons.length;
      ch.usage = { input: job.usage.input - u0.input, output: job.usage.output - u0.output };
      ch.model = llm.model;
      save();
      await cb.chunkDone(ch.id, d);
      prevTopic = d.lessons.map((l) => l.topic).filter(Boolean).join(', ');
    } catch (e) {
      ch.usage = { input: job.usage.input - u0.input, output: job.usage.output - u0.output };
      if (e.name === 'AbortError') {
        ch.status = 'todo';
        save();
        throw e;
      }
      const ex = explainError(e);
      ch.status = 'fail';
      ch.error = ex;
      save();
      cb.log({ level: 'error', text: `${uname} ${chunkName(ch)} 실패: ${ex.title}`, error: ex });
      if (STOP_KINDS.has(e.kind)) throw Object.assign(e, { stopJob: true, stage: `${uname} ${chunkName(ch)}` });
    }
  }
  st.status = st.chunks.every((c) => c.status === 'done') ? 'done' : 'partial';
  save();
  return job;

  // ----- 차시 하나 만들기 -----
  async function makeChunk(ch, prev) {
    const label = `${uname} ${chunkName(ch)}`;
    cb.status(`${label}: 교과서 쪽을 준비하는 중...`);
    const imgs = [];
    for (const pg of ch.pages) imgs.push(await renderForAi(file, pg, { width: imageWidth, ruler: rulerMode, marks: true }));
    const candsByPage = Object.fromEntries(imgs.map((im) => [im.page, im.cands || []]));
    const base = [{ type: 'text', text: hasGuide ? '[교사용 교과서·지도서] 아래 페이지들이 학습지 내용의 근거입니다(교과서 본문 부분이 학생용 근거, 지도 내용·정답은 교사용).' : '[교과서] 아래 페이지들이 학습지 내용의 유일한 근거입니다.' }];
    imgs.forEach((im) => {
      const cl = (im.cands || []).map((c) => `${c.id}[${c.box.map(Math.round).join(',')}]${c.margin ? '(여백)' : ''}`).join(' ');
      base.push({ type: 'text', text: `[교과서 PDF ${im.page}쪽] 그림 후보: ${cl || '(없음)'}\n추출 텍스트(참고, 수식 누락): ${im.text ? im.text.slice(0, 2000) : '(없음)'}` });
      base.push({ type: 'image', mime: im.mime, data: im.data, res: 'high' });
    });
    const system = buildSystemPrompt({ rulerMode, composition, hasGuide });
    const lessons = ch.lessons[0]?.auto ? null : ch.lessons;
    let mode = '';
    let d = null;
    for (let attempt = 0; attempt < 3 && !d; attempt++) {
      const instr = buildChunkInstruction({ subject, scope, extra, pageLabels: ch.pages.map(String), lessons, prev, mode, unitTitle: uname });
      try {
        cb.status(`${label}: AI가 작성하는 중...`);
        const r = await call(
          {
            system,
            parts: [...base, { type: 'text', text: instr }],
            json: true,
            maxTokens: 40000,
            onText: (t) => {
              const blocks = (t.match(/"type"\s*:/g) || []).length;
              cb.status(`${label}: 작성하는 중... ${blocks}개 블록 · ${t.length.toLocaleString()}자`);
            },
          },
          label
        );
        const truncated = r.finish === 'MAX_TOKENS';
        if (truncated && mode !== 'concise' && attempt < 2) throw new LlmError('max-tokens', { model: r.model, raw: `출력 ${r.text.length.toLocaleString()}자에서 잘림` });
        let raw;
        try {
          raw = parseModelJson(r.text, { allowTruncated: truncated });
        } catch (pe) {
          throw new LlmError('parse', { model: r.model, raw: `${pe.message}\n…${r.text.slice(-300)}` });
        }
        const fr = resolveFigures(raw, candsByPage, { dropMargin: hasGuide });
        if (fr.dropped) cb.log({ level: 'info', text: `${label}: 지도서 여백의 해설용 그림 ${fr.dropped}개는 문제에 붙이지 않았습니다.` });
        if (fr.snapped) cb.log({ level: 'info', text: `${label}: AI가 어림한 그림 상자 ${fr.snapped}개를 실제 그림 영역에 맞췄습니다.` });
        const nd = normalizeDoc(raw);
        if (!nd.lessons.length || !nd.lessons.some((l) => l.sections.some((s) => s.blocks.length))) throw new LlmError(truncated ? 'max-tokens' : 'parse', { model: r.model, raw: '학습지 내용(lessons)이 비어 있음' });
        if (truncated) cb.log({ level: 'warn', text: `${label}: 출력 한도 때문에 끝부분이 조금 잘렸을 수 있습니다. 확인 후 이 차시만 다시 만들 수 있습니다.` });
        d = nd;
      } catch (e) {
        if (e.name === 'AbortError' || !(e instanceof LlmError) || attempt >= 2) throw e;
        if (e.kind === 'recitation' && mode !== 'paraphrase') {
          mode = 'paraphrase';
          cb.log({ level: 'warn', text: `${label}: 교과서 문장 반복으로 중단됨(RECITATION) → 설명을 학습지 문체로 바꿔 쓰도록 다시 요청합니다.`, error: explainError(e) });
          continue;
        }
        if (e.kind === 'max-tokens' && mode !== 'concise') {
          mode = 'concise';
          cb.log({ level: 'warn', text: `${label}: 결과가 길어 잘림 → 더 간결하게 다시 요청합니다.`, error: explainError(e) });
          continue;
        }
        if (['parse', 'safety', 'empty', 'stream-cut', 'max-tokens', 'recitation'].includes(e.kind)) {
          cb.log({ level: 'warn', text: `${label}: ${explainError(e).title} → 한 번 더 요청합니다.`, error: explainError(e) });
          continue;
        }
        throw e;
      }
    }

    prefixFigures(d, `k${ch.id}_`);
    const outside = d.figures.filter((f) => !ch.pages.includes(f.page));
    if (outside.length) cb.log({ level: 'warn', text: `${label}: 그림 ${outside.length}개가 이 차시 쪽 밖을 가리킵니다. 그림 아래 [✂ 위치 조정]으로 확인해 주세요.` });

    // 검산
    if (verify) {
      const items = collectAnswerItems(d);
      if (items.length) {
        cb.status(`${label}: 교과서와 대조해 문제·정답을 검산하는 중...`);
        try {
          const vparts = [];
          imgs.forEach((im) => {
            vparts.push({ type: 'text', text: `[교과서 PDF ${im.page}쪽]` });
            vparts.push({ type: 'image', mime: im.mime, data: im.data, res: 'high' });
          });
          vparts.push({ type: 'text', text: buildVerifyInstruction(items, hasGuide) });
          const v = await call({ system: VERIFY_SYSTEM, parts: vparts, json: true, maxTokens: 16000, onText: (t) => cb.status(`${label}: 검산하는 중... (${t.length.toLocaleString()}자)`) }, `${label} 검산`);
          const fixes = parseModelJson(v.text, { allowTruncated: true }).fixes || [];
          const res = applyAnswerFixes(d, fixes);
          if (res.changed) {
            d = res.doc;
            cb.log({ level: 'info', text: `${label}: 검산에서 ${fixes.length}개 문항을 바로잡았습니다. ${fixes.map((x) => (x.reason ? `(${x.reason})` : '')).join(' ').slice(0, 200)}` });
          }
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          cb.log({ level: 'warn', text: `${label}: 검산은 실패해서 건너뛰었습니다 — ${explainError(e).title}`, error: explainError(e) });
        }
      }
    }
    return d;
  }
}
