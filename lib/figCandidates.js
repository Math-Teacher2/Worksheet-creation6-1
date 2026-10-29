// 교과서 쪽에서 "그림 후보"(그래프·표·삽화가 실제로 그려진 영역)를 찾아냅니다.
// AI가 좌표를 어림해서 그림을 잘못 자르는 문제를 줄이려고, 앱이 먼저 후보 상자를 찾아 번호를 붙이고
// AI는 그 번호를 고르게 합니다. (글자 영역은 PDF의 글자 정보로 지우고, 남은 선·색 덩어리를 묶음)

const CELL = 3; // 격자 한 칸(px)

// data: RGBA, W·H: 픽셀, textRects: [{x0,y0,x1,y1,s}] (px, s=글자)
export function detectFigures({ data, W, H, textRects = [] }) {
  const gw = Math.ceil(W / CELL);
  const gh = Math.ceil(H / CELL);
  const ink = new Uint8Array(gw * gh);
  for (let y = 0; y < H; y++) {
    const gy = (y / CELL) | 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (lum < 185 || (sat > 70 && lum < 235)) ink[gy * gw + ((x / CELL) | 0)] = 1;
    }
  }
  // 글자 지우기
  const text = new Uint8Array(gw * gh);
  for (const t of textRects) {
    const x0 = Math.max(0, Math.floor((t.x0 - 1) / CELL));
    const x1 = Math.min(gw - 1, Math.floor((t.x1 + 1) / CELL));
    const y0 = Math.max(0, Math.floor((t.y0 - 1) / CELL));
    const y1 = Math.min(gh - 1, Math.floor((t.y1 + 1) / CELL));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) text[y * gw + x] = 1;
  }
  const core = new Uint8Array(gw * gh);
  for (let k = 0; k < core.length; k++) core[k] = ink[k] && !text[k] ? 1 : 0;
  // 상자 테두리·구분선처럼 아주 긴 직선은 지움 (틀 안의 그래프가 따로 잡히도록)
  const longH = (W * 0.3) / CELL;
  const longV = (H * 0.22) / CELL;
  const clearRuns = (len, n, at) => {
    let start = -1;
    let gap = 0;
    for (let i = 0; i <= len; i++) {
      const on = i < len && core[at(i)];
      if (on) {
        if (start < 0) start = i;
        gap = 0;
      } else if (start >= 0) {
        gap++;
        if (gap > 1 || i === len) {
          const end = i - gap;
          if (end - start + 1 >= n) for (let k = start; k <= end; k++) core[at(k)] = 2;
          start = -1;
          gap = 0;
        }
      }
    }
  };
  for (let y = 0; y < gh; y++) clearRuns(gw, longH, (x) => y * gw + x);
  for (let x = 0; x < gw; x++) clearRuns(gh, longV, (y) => y * gw + x);
  for (let k = 0; k < core.length; k++) if (core[k] === 2) core[k] = 0;
  // 가까운 선들을 잇기 (가로·세로 팽창)
  const R = 3;
  const tmp = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (core[y * gw + x]) for (let d = Math.max(0, x - R); d <= Math.min(gw - 1, x + R); d++) tmp[y * gw + d] = 1;
  const dil = new Uint8Array(gw * gh);
  for (let x = 0; x < gw; x++) for (let y = 0; y < gh; y++) if (tmp[y * gw + x]) for (let d = Math.max(0, y - R); d <= Math.min(gh - 1, y + R); d++) dil[d * gw + x] = 1;
  // 연결 덩어리
  const seen = new Int32Array(gw * gh);
  const comps = [];
  const stack = [];
  for (let s = 0; s < dil.length; s++) {
    if (!dil[s] || seen[s]) continue;
    let minx = 1e9;
    let miny = 1e9;
    let maxx = -1;
    let maxy = -1;
    const cells = [];
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const k = stack.pop();
      const x = k % gw;
      const y = (k / gw) | 0;
      if (core[k]) {
        cells.push(k);
        if (x < minx) minx = x;
        if (y < miny) miny = y;
        if (x > maxx) maxx = x;
        if (y > maxy) maxy = y;
      }
      if (x > 0 && dil[k - 1] && !seen[k - 1]) (seen[k - 1] = 1), stack.push(k - 1);
      if (x < gw - 1 && dil[k + 1] && !seen[k + 1]) (seen[k + 1] = 1), stack.push(k + 1);
      if (y > 0 && dil[k - gw] && !seen[k - gw]) (seen[k - gw] = 1), stack.push(k - gw);
      if (y < gh - 1 && dil[k + gw] && !seen[k + gw]) (seen[k + gw] = 1), stack.push(k + gw);
    }
    if (cells.length < 30) continue;
    const bw = maxx - minx + 1;
    const bh = maxy - miny + 1;
    if (bw * CELL < W * 0.05 || bh * CELL < H * 0.03) continue; // 너무 작거나 가는 것(밑줄·구분선)
    if (bw * CELL > W * 0.95 && bh * CELL > H * 0.5) continue; // 쪽 전체 장식
    // 테두리만 있는 상자(본문 틀)는 그림이 아님
    const ex = Math.max(2, Math.round(bw * 0.06));
    const ey = Math.max(2, Math.round(bh * 0.06));
    let edge = 0;
    for (const k of cells) {
      const x = k % gw;
      const y = (k / gw) | 0;
      if (x - minx < ex || maxx - x < ex || y - miny < ey || maxy - y < ey) edge++;
    }
    const fill = cells.length / (bw * bh);
    if (edge / cells.length > 0.8 && bw * bh * CELL * CELL > W * H * 0.04) continue;
    comps.push({ x0: minx * CELL, y0: miny * CELL, x1: (maxx + 1) * CELL, y1: (maxy + 1) * CELL, fill });
  }
  // 그림 안·옆의 짧은 글자(축 이름, 눈금, y=f(x) 같은 이름표)를 붙임
  // 글자 상자의 가운데가 그림 상자(조금 넓힌 것) 안에 있는 짧은 글자만 붙임 — 옆 본문 줄의 끝 글자가 섞이지 않게
  const near = Math.round(W * 0.008);
  for (const c of comps) {
    const base = { ...c };
    for (const t of textRects) {
      if ((t.s || '').trim().length > 10) continue;
      const cx = (t.x0 + t.x1) / 2;
      const cy = (t.y0 + t.y1) / 2;
      if (cx < base.x0 - near || cx > base.x1 + near || cy < base.y0 - near || cy > base.y1 + near) continue;
      c.x0 = Math.min(c.x0, t.x0);
      c.y0 = Math.min(c.y0, t.y0);
      c.x1 = Math.max(c.x1, t.x1);
      c.y1 = Math.max(c.y1, t.y1);
    }
  }
  // 겹치는 후보는 합침
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < comps.length && !merged; i++)
      for (let j = i + 1; j < comps.length && !merged; j++) {
        const a = comps[i];
        const b = comps[j];
        if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
          comps[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), fill: Math.max(a.fill, b.fill) };
          comps.splice(j, 1);
          merged = true;
        }
      }
  }
  comps.sort((a, b) => (Math.abs(a.y0 - b.y0) < H * 0.02 ? a.x0 - b.x0 : a.y0 - b.y0));
  return comps.map((c) => {
    const pad = 4;
    const x0 = Math.max(0, c.x0 - pad);
    const y0 = Math.max(0, c.y0 - pad);
    const x1 = Math.min(W, c.x1 + pad);
    const y1 = Math.min(H, c.y1 + pad);
    // 쪽 왼쪽·오른쪽 여백 칸에 있는 것(날개 설명, 지도서의 해설 그림 등)
    const margin = (x1 - x0 <= W * 0.24 && (x1 <= W * 0.24 || x0 >= W * 0.76));
    return { box: [y0, x0, y1, x1].map((v, i) => Math.round(((i % 2 === 0 ? v / H : v / W) * 1000) * 10) / 10), px: { x0, y0, x1, y1 }, margin };
  });
}

// 두 상자(0~1000)가 얼마나 겹치는지: [겹친 넓이/a 넓이, 겹친 넓이/b 넓이]
export function overlap(a, b) {
  const y0 = Math.max(a[0], b[0]);
  const x0 = Math.max(a[1], b[1]);
  const y1 = Math.min(a[2], b[2]);
  const x1 = Math.min(a[3], b[3]);
  if (y1 <= y0 || x1 <= x0) return [0, 0];
  const inter = (y1 - y0) * (x1 - x0);
  const area = (r) => Math.max(1, (r[2] - r[0]) * (r[3] - r[1]));
  return [inter / area(a), inter / area(b)];
}

// AI가 준 상자를 가장 잘 맞는 후보에 붙임. 맞는 후보가 없으면 null
export function snapToCandidate(box, cands) {
  // 상자 안에 후보가 둘 이상 통째로 들어 있으면(나란한 그래프 두 개 등) 합친 상자
  const inside = (cands || []).filter((c) => overlap(box, c.box)[1] >= 0.8);
  if (inside.length >= 2) {
    const u = inside.reduce((a, c) => [Math.min(a[0], c.box[0]), Math.min(a[1], c.box[1]), Math.max(a[2], c.box[2]), Math.max(a[3], c.box[3])], [1000, 1000, 0, 0]);
    return { box: u, id: inside.map((c) => c.id).join('+') };
  }
  let best = null;
  let bestScore = 0;
  for (const c of cands || []) {
    const [ofBox, ofCand] = overlap(box, c.box);
    // 후보의 대부분이 상자 안에 있고, 상자의 상당 부분이 후보로 채워질 때
    if (ofCand < 0.55 || ofBox < 0.3) continue;
    const score = ofCand + ofBox;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// 본문 글줄처럼 보이는 글자(한글 4자 이상, 8자 이상)
const isBodyText = (str) => (String(str).match(/[가-힣]/g) || []).length >= 4 && String(str).trim().length >= 8;

// 그림 상자 가장자리에 걸친 본문 글줄을 잘라냄 (texts: [{box:[y0,x0,y1,x1], s}] 0~1000)
export function trimBodyText(box, texts) {
  let [y0, x0, y1, x1] = box;
  const area0 = (y1 - y0) * (x1 - x0);
  for (let iter = 0; iter < 6; iter++) {
    let changed = false;
    for (const t of texts || []) {
      if (!isBodyText(t.s)) continue;
      const [ty0, tx0, ty1, tx1] = t.box;
      const iy = Math.min(y1, ty1) - Math.max(y0, ty0);
      const ix = Math.min(x1, tx1) - Math.max(x0, tx0);
      if (iy <= 0 || ix <= 0) continue;
      if (iy * ix < (ty1 - ty0) * (tx1 - tx0) * 0.3) continue;
      const h = y1 - y0;
      const w = x1 - x0;
      if (ty1 <= y0 + h * 0.3) y0 = ty1 + 1;
      else if (ty0 >= y1 - h * 0.3) y1 = ty0 - 1;
      else if (tx1 <= x0 + w * 0.35) x0 = tx1 + 1;
      else if (tx0 >= x1 - w * 0.35) x1 = tx0 - 1;
      else continue;
      changed = true;
    }
    if (!changed) break;
  }
  if (y1 - y0 < 8 || x1 - x0 < 8 || (y1 - y0) * (x1 - x0) < area0 * 0.35) return box;
  return [y0, x0, y1, x1];
}
