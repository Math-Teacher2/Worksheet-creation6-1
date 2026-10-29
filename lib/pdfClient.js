// 브라우저 전용: PDF/이미지 -> AI에게 보낼 페이지 이미지, 그림 잘라내기용 고해상도 렌더링

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

const docCache = new WeakMap();
export async function openPdf(file) {
  if (docCache.has(file)) return docCache.get(file);
  const p = (async () => {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  })();
  docCache.set(file, p);
  try {
    return await p;
  } catch (e) {
    docCache.delete(file);
    throw new Error(`PDF를 열지 못했습니다: ${file.name} (${e.message || e})`);
  }
}

// "1-3, 7, 10~12" -> [1,2,3,7,10,11,12]
export function parsePageRange(input, total) {
  const all = Array.from({ length: total }, (_, i) => i + 1);
  if (!input || !String(input).trim()) return all;
  const set = new Set();
  for (const part of String(input).split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*[-~]\s*(\d+))?$/);
    if (!m) continue;
    const a = Math.max(1, parseInt(m[1], 10));
    const b = Math.min(total, parseInt(m[2] || m[1], 10));
    for (let p = a; p <= b; p++) set.add(p);
  }
  const list = [...set].sort((x, y) => x - y);
  return list.length ? list : all;
}

export async function getPageCount(file) {
  if (!file) return 0;
  if (file.type && file.type.startsWith('image/')) return 1;
  return (await openPdf(file)).numPages;
}

// 페이지를 지정 너비로 그린 canvas
export async function renderPageCanvas(pdf, pageNo, width) {
  const page = await pdf.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = width / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function pageText(pdf, pageNo) {
  try {
    const page = await pdf.getPage(pageNo);
    const tc = await page.getTextContent();
    return tc.items
      .map((it) => it.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

// 위·왼쪽에 0~1000 눈금자를 붙임 (Gemini 외 모델이 좌표를 정확히 읽도록)
function withRuler(canvas) {
  const pad = 30;
  const out = document.createElement('canvas');
  out.width = canvas.width + pad;
  out.height = canvas.height + pad;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, pad, pad);
  ctx.strokeStyle = '#d00';
  ctx.fillStyle = '#d00';
  ctx.font = 'bold 13px sans-serif';
  ctx.lineWidth = 1;
  for (let v = 0; v <= 1000; v += 50) {
    const x = pad + (v / 1000) * canvas.width;
    const y = pad + (v / 1000) * canvas.height;
    const major = v % 100 === 0;
    ctx.beginPath();
    ctx.moveTo(x, pad);
    ctx.lineTo(x, pad - (major ? 12 : 6));
    ctx.moveTo(pad, y);
    ctx.lineTo(pad - (major ? 12 : 6), y);
    ctx.stroke();
    if (major && v > 0 && v < 1000) {
      ctx.textAlign = 'center';
      ctx.fillText(String(v), x, 12);
      ctx.save();
      ctx.translate(12, y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(String(v), 0, 4);
      ctx.restore();
    }
  }
  return out;
}

function toJpegPart(canvas, quality) {
  return { mime: 'image/jpeg', data: canvas.toDataURL('image/jpeg', quality).split(',')[1] };
}

async function imageFileCanvas(file, maxWidth) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  return c;
}

// 교과서 -> [{page, mime, data, text}]
export async function prepareSource(file, range, { imageWidth = 1300, ruler = false, budget = 14_000_000, onProgress } = {}) {
  const pdf = await openPdf(file);
  const pages = parsePageRange(range, pdf.numPages).slice(0, 80);
  let width = imageWidth;
  let quality = 0.8;
  for (let round = 0; round < 4; round++) {
    const images = [];
    let total = 0;
    for (let i = 0; i < pages.length; i++) {
      const canvas = await renderPageCanvas(pdf, pages[i], width);
      const part = toJpegPart(ruler ? withRuler(canvas) : canvas, quality);
      total += part.data.length;
      images.push({ ...part, page: pages[i], text: await pageText(pdf, pages[i]) });
      if (onProgress) onProgress(i + 1, pages.length);
    }
    if (total <= budget) return { images, pages, pageCount: pdf.numPages };
    width = Math.round(width * 0.82);
    quality = Math.max(0.6, quality - 0.06);
  }
  throw new Error('교과서 쪽이 너무 많아 한 번에 보낼 수 없습니다. 쪽 범위를 줄여 주세요.');
}

// 구성 참고 학습지(PDF/이미지) -> [{mime, data}]
export async function prepareTemplate(file, range, onProgress) {
  if (file.type && file.type.startsWith('image/')) {
    return { images: [toJpegPart(await imageFileCanvas(file, 1200), 0.75)] };
  }
  const pdf = await openPdf(file);
  const pages = range && String(range).trim() ? parsePageRange(range, pdf.numPages).slice(0, 6) : Array.from({ length: Math.min(3, pdf.numPages) }, (_, i) => i + 1);
  const images = [];
  for (let i = 0; i < pages.length; i++) {
    images.push(toJpegPart(await renderPageCanvas(pdf, pages[i], 1000), 0.7));
    if (onProgress) onProgress(i + 1, pages.length);
  }
  return { images };
}

// ---------- 차시별로 나눠 보낼 때 쓰는 낱쪽 렌더링 (캐시) ----------
const pageImgCache = new WeakMap();
function cacheOf(file) {
  if (!pageImgCache.has(file)) pageImgCache.set(file, new Map());
  return pageImgCache.get(file);
}

// 교과서 한 쪽 → {mime, data, page, text}
// marks: true면 그림 후보 상자와 번호를 그려 넣음 (반환값의 cands에 후보 목록)
export async function renderForAi(file, pageNo, { width = 1300, quality = 0.8, ruler = false, marks = false } = {}) {
  const key = `${pageNo}|${width}|${quality}|${ruler ? 1 : 0}|${marks ? 1 : 0}`;
  const cache = cacheOf(file);
  if (cache.has(key)) return cache.get(key);
  const pdf = await openPdf(file);
  const canvas = await renderPageCanvas(pdf, pageNo, width);
  const cands = marks ? await figureCandidates(file, pageNo) : [];
  if (cands.length) drawCandidateMarks(canvas, cands);
  const part = toJpegPart(ruler ? withRuler(canvas) : canvas, quality);
  const out = { ...part, page: pageNo, text: await pageText(pdf, pageNo), cands };
  cache.set(key, out);
  return out;
}

export async function pageTextOf(file, pageNo) {
  const pdf = await openPdf(file);
  return pageText(pdf, pageNo);
}

// 교사용 지도서(PDF 하나 또는 이미지 여러 장) → 낱쪽 목록 [{ref:'G1', label, file, page|null}]
export async function guideEntries(files, range) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return [];
  const pdfs = list.filter((f) => !(f.type && f.type.startsWith('image/')));
  const imgs = list.filter((f) => f.type && f.type.startsWith('image/'));
  const out = [];
  if (pdfs.length) {
    const pdf = await openPdf(pdfs[0]);
    parsePageRange(range, pdf.numPages)
      .slice(0, 60)
      .forEach((p) => out.push({ ref: `G${out.length + 1}`, label: `지도서 PDF ${p}쪽`, file: pdfs[0], page: p }));
  }
  imgs.slice(0, 40).forEach((f) => out.push({ ref: `G${out.length + 1}`, label: `지도서 이미지 ${f.name}`, file: f, page: null }));
  return out;
}

export async function renderEntry(entry, { width = 1000, quality = 0.72 } = {}) {
  const key = `g|${entry.page}|${width}|${quality}`;
  const cache = cacheOf(entry.file);
  if (cache.has(key)) return cache.get(key);
  let out;
  if (entry.page) {
    const pdf = await openPdf(entry.file);
    const canvas = await renderPageCanvas(pdf, entry.page, width);
    out = { ...toJpegPart(canvas, quality), text: await pageText(pdf, entry.page) };
  } else {
    out = { ...toJpegPart(await imageFileCanvas(entry.file, width), quality), text: '' };
  }
  cache.set(key, out);
  return out;
}

// ---------- 그림 후보 (앱이 찾은 그림 영역) ----------
const candCache = new WeakMap();
const CAND_WIDTH = 900;

function textRectsOf(tc, viewport) {
  const [a, b, c, d, e, f] = viewport.transform;
  const out = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const [ia, ib, ic, id, ie, iff] = it.transform;
    // viewport.transform × item.transform
    const m = [a * ia + c * ib, b * ia + d * ib, a * ic + c * id, b * ic + d * id, a * ie + c * iff + e, b * ie + d * iff + f];
    const fh = Math.hypot(m[2], m[3]);
    const w = (it.width || 0) * viewport.scale;
    const x0 = m[4];
    const y1 = m[5] + fh * 0.25;
    out.push({ x0, y0: m[5] - fh, x1: x0 + Math.max(w, fh * 0.5), y1, s: it.str });
  }
  return out;
}

const textCache = new Map();
const fileKeyOf = (f) => `${f.name}|${f.size}`;
// 그림 자르기용: 쪽의 글자 상자들 [{s, box(0~1000)}]
export async function pageTextBoxes(file, pageNo) {
  const k = `${fileKeyOf(file)}|${pageNo}`;
  if (!textCache.has(k)) await figureCandidates(file, pageNo);
  return textCache.get(k) || [];
}

// [{id:'P5-1', page, box:[ymin,xmin,ymax,xmax], margin}]
export async function figureCandidates(file, pageNo) {
  if (!file || (file.type && file.type.startsWith('image/'))) return [];
  if (!candCache.has(file)) candCache.set(file, new Map());
  const cache = candCache.get(file);
  if (cache.has(pageNo)) return cache.get(pageNo);
  const p = (async () => {
    try {
      const { detectFigures } = await import('./figCandidates');
      const pdf = await openPdf(file);
      const page = await pdf.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: CAND_WIDTH / base.width });
      const canvas = await renderPageCanvas(pdf, pageNo, CAND_WIDTH);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const tc = await page.getTextContent();
      const found = detectFigures({ data, W: canvas.width, H: canvas.height, textRects: textRectsOf(tc, viewport) });
      const texts = textRectsOf(tc, viewport).map((t) => ({ s: t.s, box: [(t.y0 / canvas.height) * 1000, (t.x0 / canvas.width) * 1000, (t.y1 / canvas.height) * 1000, (t.x1 / canvas.width) * 1000] }));
      textCache.set(`${fileKeyOf(file)}|${pageNo}`, texts);
      return found.slice(0, 12).map((c, i) => ({ id: `P${pageNo}-${i + 1}`, page: pageNo, box: c.box, margin: !!c.margin }));
    } catch (e) {
      console.warn('그림 후보 찾기 실패', pageNo, e);
      return [];
    }
  })();
  cache.set(pageNo, p);
  return p;
}

// AI에게 보낼 쪽 이미지에 후보 상자와 번호를 그림
export function drawCandidateMarks(canvas, cands, offset = { x: 0, y: 0, w: canvas.width, h: canvas.height }) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  const fs = Math.max(13, Math.round(offset.w / 70));
  ctx.font = `bold ${fs}px sans-serif`;
  for (const c of cands) {
    const [y0, x0, y1, x1] = c.box;
    const X0 = offset.x + (x0 / 1000) * offset.w;
    const Y0 = offset.y + (y0 / 1000) * offset.h;
    const X1 = offset.x + (x1 / 1000) * offset.w;
    const Y1 = offset.y + (y1 / 1000) * offset.h;
    ctx.strokeStyle = '#1565c0';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
    ctx.setLineDash([]);
    const label = c.id;
    const tw = ctx.measureText(label).width + 8;
    const ty = Y0 - fs - 4 >= 0 ? Y0 - fs - 4 : Y0;
    ctx.fillStyle = '#1565c0';
    ctx.fillRect(X0, ty, tw, fs + 4);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, X0 + 4, ty + fs);
  }
  ctx.restore();
  return canvas;
}

// ---------- 단원 목차용: 쪽마다 큰 글씨(제목)와 첫 글자 ----------
const outlineCache = new WeakMap();
export async function pageOutline(file, pageNo) {
  if (!outlineCache.has(file)) outlineCache.set(file, new Map());
  const cache = outlineCache.get(file);
  if (cache.has(pageNo)) return cache.get(pageNo);
  let out = { page: pageNo, headings: '', lead: '' };
  try {
    const pdf = await openPdf(file);
    const page = await pdf.getPage(pageNo);
    const tc = await page.getTextContent();
    const items = tc.items.filter((it) => it.str && it.str.trim());
    if (items.length) {
      const hs = items.map((it) => Math.hypot(it.transform[2], it.transform[3])).sort((a, b) => a - b);
      const med = hs[hs.length >> 1] || 10;
      const heads = [];
      for (const it of items) {
        const h = Math.hypot(it.transform[2], it.transform[3]);
        const s = it.str.replace(/\s+/g, ' ').trim();
        if (h >= med * 1.35 && s && !heads.includes(s)) heads.push(s);
      }
      out = {
        page: pageNo,
        headings: heads.join(' / ').slice(0, 90),
        lead: items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim().slice(0, 90),
      };
    }
  } catch {
    /* 무시 */
  }
  cache.set(pageNo, out);
  return out;
}
