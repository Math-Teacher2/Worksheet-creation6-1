// 교과서 페이지에서 그림 영역을 잘라냅니다 (브라우저 전용).
// AI가 준 좌표가 조금 어긋나도, 그림이 잘린 쪽은 넓히고 빈 여백은 줄여서 보정합니다.
import { openPdf, renderPageCanvas, pageTextBoxes } from './pdfClient';
import { trimBodyText } from './figCandidates';

const CROP_WIDTH = 1800; // 잘라낼 때 페이지 렌더링 너비(px)
const cache = new Map(); // key -> Promise<canvas>

function pageCanvas(pdf, file, page) {
  const key = `${file.name}:${file.size}:${page}`;
  if (!cache.has(key)) {
    if (cache.size > 8) cache.delete(cache.keys().next().value);
    cache.set(key, renderPageCanvas(pdf, page, CROP_WIDTH));
  }
  return cache.get(key);
}

export function clearFigureCache() {
  cache.clear();
}

// 배경색 추정: 상자 테두리 픽셀의 중앙값
function backgroundOf(data, W, x0, y0, x1, y1) {
  const rs = [];
  const gs = [];
  const bs = [];
  const push = (x, y) => {
    const i = (y * W + x) * 4;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };
  for (let x = x0; x <= x1; x += 2) {
    push(x, y0);
    push(x, y1);
  }
  for (let y = y0; y <= y1; y += 2) {
    push(x0, y);
    push(x1, y);
  }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1] ?? 255;
  return [med(rs), med(gs), med(bs)];
}

function makeInk(data, W, bg) {
  return (x, y) => {
    const i = (y * W + x) * 4;
    const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
    return d > 60;
  };
}

function rowInk(ink, y, x0, x1) {
  let n = 0;
  for (let x = x0; x <= x1; x++) if (ink(x, y)) n++;
  return n;
}
function colInk(ink, x, y0, y1) {
  let n = 0;
  for (let y = y0; y <= y1; y++) if (ink(x, y)) n++;
  return n;
}

// 상자 보정: 가장자리가 그림을 가로지르면 넓히고(최대 3%), 안쪽 빈 여백은 줄임
export function refineBox(canvas, rect, { grow = true } = {}) {
  const W = canvas.width;
  const H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, W, H);
  let { x0, y0, x1, y1 } = rect;
  const bg = backgroundOf(data, W, x0, y0, x1, y1);
  const ink = makeInk(data, W, bg);
  const maxGrowX = Math.round(W * 0.03);
  const maxGrowY = Math.round(H * 0.03);
  const clean = (n, len) => n <= Math.max(1, len * 0.002);
  // 넓히기 (AI가 준 좌표일 때만; 사람이 직접 그린 영역은 줄이기만 함)
  if (grow) for (let g = 0; g < maxGrowY && y0 > 0 && !clean(rowInk(ink, y0, x0, x1), x1 - x0); g++) y0--;
  if (grow) for (let g = 0; g < maxGrowY && y1 < H - 1 && !clean(rowInk(ink, y1, x0, x1), x1 - x0); g++) y1++;
  if (grow) for (let g = 0; g < maxGrowX && x0 > 0 && !clean(colInk(ink, x0, y0, y1), y1 - y0); g++) x0--;
  if (grow) for (let g = 0; g < maxGrowX && x1 < W - 1 && !clean(colInk(ink, x1, y0, y1), y1 - y0); g++) x1++;
  // 줄이기
  while (y0 < y1 - 10 && rowInk(ink, y0, x0, x1) === 0) y0++;
  while (y1 > y0 + 10 && rowInk(ink, y1, x0, x1) === 0) y1--;
  while (x0 < x1 - 10 && colInk(ink, x0, y0, y1) === 0) x0++;
  while (x1 > x0 + 10 && colInk(ink, x1, y0, y1) === 0) x1--;
  const pad = 8;
  return { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(W - 1, x1 + pad), y1: Math.min(H - 1, y1 + pad) };
}

function boxToRect(box, W, H) {
  const [ymin, xmin, ymax, xmax] = box;
  return {
    x0: Math.max(0, Math.floor((xmin / 1000) * W)),
    y0: Math.max(0, Math.floor((ymin / 1000) * H)),
    x1: Math.min(W - 1, Math.ceil((xmax / 1000) * W)),
    y1: Math.min(H - 1, Math.ceil((ymax / 1000) * H)),
  };
}
function rectToBox(r, W, H) {
  return [(r.y0 / H) * 1000, (r.x0 / W) * 1000, (r.y1 / H) * 1000, (r.x1 / W) * 1000].map((v) => Math.round(v * 10) / 10);
}

// fig: {id, page, box} -> {id, page, box(보정후), dataUrl, w, h, frac}
export async function cropFigure(file, fig, { refine = true, grow = true } = {}) {
  const pdf = await openPdf(file);
  const page = Math.min(Math.max(1, fig.page), pdf.numPages);
  const canvas = await pageCanvas(pdf, file, page);
  const W = canvas.width;
  const H = canvas.height;
  let rect = boxToRect(fig.box, W, H);
  if (refine) {
    rect = refineBox(canvas, rect, { grow });
    // 그림 가장자리에 걸친 본문 글줄(지도 Tip 문장 등)은 잘라내고, 남은 여백만 다시 줄임
    try {
      const texts = await pageTextBoxes(file, page);
      const before = rectToBox(rect, W, H);
      const after = trimBodyText(before, texts);
      if (after !== before) rect = refineBox(canvas, boxToRect(after, W, H), { grow: false });
    } catch {
      /* 글자 정보가 없으면 그대로 */
    }
  }
  const w = rect.x1 - rect.x0 + 1;
  const h = rect.y1 - rect.y0 + 1;
  const out = document.createElement('canvas');
  // 너무 큰 그림은 줄여서 저장 (파일 크기 관리)
  const scale = Math.min(1, 1100 / w);
  out.width = Math.max(1, Math.round(w * scale));
  out.height = Math.max(1, Math.round(h * scale));
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, rect.x0, rect.y0, w, h, 0, 0, out.width, out.height);
  return {
    id: fig.id,
    page,
    box: rectToBox(rect, W, H),
    desc: fig.desc || '',
    dataUrl: out.toDataURL('image/png'),
    w: out.width,
    h: out.height,
    frac: w / W,
  };
}

export async function cropAll(file, figures, onProgress) {
  const out = {};
  for (let i = 0; i < figures.length; i++) {
    try {
      out[figures[i].id] = await cropFigure(file, figures[i], { grow: !figures[i].snap });
    } catch (e) {
      console.warn('그림 잘라내기 실패', figures[i], e);
    }
    if (onProgress) onProgress(i + 1, figures.length);
  }
  return out;
}

// 편집기 표시용 페이지 이미지
export async function pagePreview(file, page, width = 900) {
  const pdf = await openPdf(file);
  const p = Math.min(Math.max(1, page), pdf.numPages);
  const c = await renderPageCanvas(pdf, p, width);
  return { url: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height, page: p, pageCount: pdf.numPages };
}

export function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
