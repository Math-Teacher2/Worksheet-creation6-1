// 학습지 문장(리치 텍스트) 파서.
//
// AI가 쓰는 표기 규칙:
//   $...$      인라인 수식 (LaTeX)
//   $$...$$    가운데 정렬 수식 (문장 전체가 수식일 때)
//   [[정답]]   학생이 채울 빈칸. 안의 내용이 교사용 정답으로 표시됨 (수식 가능: [[$f(x)\to L$]])
//   **굵게**   굵은 글씨
//
// 결과: [{t:'text', v, b}, {t:'math', v, d}, {t:'blank', ans:[...nodes], raw}]

function findMathEnd(s, from, dbl) {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '$') {
      if (!dbl) return i;
      if (s[i + 1] === '$') return i;
    }
  }
  return -1;
}

function findBlankEnd(s, from) {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '$') {
      const dbl = s[i + 1] === '$';
      const j = findMathEnd(s, i + (dbl ? 2 : 1), dbl);
      if (j < 0) return -1;
      i = j + (dbl ? 1 : 0);
      continue;
    }
    if (c === '[' && s[i + 1] === '[') {
      depth++;
      i++;
      continue;
    }
    if (c === ']' && s[i + 1] === ']') {
      if (depth === 0) return i;
      depth--;
      i++;
    }
  }
  return -1;
}

// 모델이 자주 하는 실수 보정: \( \) \[ \] 구분자, 수식 안의 빈칸
function splitBlanksInMath(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      out += s.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '$') {
      const dbl = s[i + 1] === '$';
      const open = dbl ? 2 : 1;
      const j = findMathEnd(s, i + open, dbl);
      if (j < 0) {
        out += s.slice(i);
        break;
      }
      const body = s.slice(i + open, j);
      const fence = dbl ? '$$' : '$';
      if (body.includes('[[')) {
        body.split(/\[\[(.*?)\]\]/).forEach((p, k) => {
          if (k % 2 === 0) {
            if (p.trim()) out += `${fence}${p}${fence}`;
          } else {
            const ans = p.trim();
            out += /[가-힣]/.test(ans) || !ans ? `[[${ans}]]` : `[[$${ans}$]]`;
          }
        });
      } else out += `${fence}${body}${fence}`;
      i = j + open;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function cleanRichSource(src) {
  let s = String(src ?? '');
  s = s.replace(/(?<!\\)\\\[/g, '$$$$').replace(/(?<!\\)\\\]/g, '$$$$');
  s = s.replace(/(?<!\\)\\\(/g, '$').replace(/(?<!\\)\\\)/g, '$');
  // 수식 안에 들어간 빈칸 [[...]] 을 수식 밖으로 꺼냄: $a=[[3]]$ -> $a=$[[$3$]]
  s = splitBlanksInMath(s);
  // 흔한 빈칸 대체 표기: \square, \Box, □ 를 빈칸으로
  s = s.replace(/\$\s*\\(?:square|Box)\s*\$/g, '[[ ]]');
  return s;
}

export function parseRich(src) {
  const s = cleanRichSource(src);
  const out = [];
  let buf = '';
  let bold = false;
  const flush = () => {
    if (buf) {
      out.push({ t: 'text', v: buf, b: bold });
      buf = '';
    }
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '[' && s[i + 1] === '[') {
      const j = findBlankEnd(s, i + 2);
      if (j > 0) {
        flush();
        const raw = s.slice(i + 2, j);
        out.push({ t: 'blank', raw, ans: parseRich(raw).filter((n) => n.t !== 'blank') });
        i = j + 2;
        continue;
      }
    }
    if (c === '\\' && s[i + 1] === '$') {
      buf += '$';
      i += 2;
      continue;
    }
    if (c === '$') {
      const dbl = s[i + 1] === '$';
      const open = dbl ? 2 : 1;
      const j = findMathEnd(s, i + open, dbl);
      if (j > 0) {
        flush();
        const v = s.slice(i + open, j).trim();
        if (v) out.push({ t: 'math', v, d: dbl });
        i = j + open;
        continue;
      }
    }
    if (c === '*' && s[i + 1] === '*') {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

// 문장 전체가 별행 수식 하나인지
export function isDisplayOnly(nodes) {
  const real = nodes.filter((n) => !(n.t === 'text' && !n.v.trim()));
  return real.length === 1 && real[0].t === 'math' && real[0].d;
}

// 빈칸 크기 추정 (em 단위): 정답 길이로 결정
export function blankEm(node) {
  let w = 0;
  for (const n of node.ans || []) {
    if (n.t === 'text') {
      for (const ch of n.v) w += /[가-힣]/.test(ch) ? 1 : 0.55;
    } else if (n.t === 'math') {
      const v = n.v
        .replace(/\\(?:left|right|displaystyle|limits)/g, '')
        .replace(/\\[a-zA-Z]+/g, 'x')
        .replace(/[{}\s^_]/g, '');
      w += v.length * 0.55 + (/\\frac|\\dfrac/.test(n.v) ? 0.6 : 0);
    }
  }
  return Math.max(2.6, Math.min(18, w + 1.6));
}

export function plainText(nodes) {
  return (nodes || [])
    .map((n) => (n.t === 'text' ? n.v : n.t === 'math' ? n.v : n.t === 'blank' ? '□' : ''))
    .join('');
}

// ---- 한글 수식 지침에 따른 수식 나누기 ----
// 최상위(괄호 밖) 위치에서 문자열을 나눔
function topLevelSplit(src, test) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      const m = src.slice(i).match(/^\\(left|right|[a-zA-Z]+|.)/);
      const cmd = m ? m[0] : '\\';
      if (cmd === '\\left') depth++;
      if (cmd === '\\right') depth--;
      cur += cmd;
      i += cmd.length - 1;
      continue;
    }
    if ('{(['.includes(c)) depth++;
    if ('})]'.includes(c)) depth--;
    const n = depth === 0 ? test(src, i) : 0;
    if (n) {
      out.push(cur);
      cur = '';
      out.push({ sep: src.slice(i, i + n) });
      i += n - 1;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

// 쉼표로 나열된 수식은 따로따로(쉼표는 본문 글자), 한글 \text{}는 본문으로 뺌
export function splitMathForHwp(v) {
  const nodes = [];
  // 1) 한글이 든 \text{...}
  const parts = String(v).split(/\\(?:text|textrm|mathrm|mbox)\s*\{([^{}]*[가-힣][^{}]*)\}/);
  parts.forEach((p, i) => {
    if (i % 2 === 1) {
      nodes.push({ t: 'text', v: p });
      return;
    }
    if (!p.trim()) return;
    // 2) 최상위 쉼표
    const segs = topLevelSplit(p, (s, k) => (s[k] === ',' ? 1 : 0));
    segs.forEach((sg) => {
      if (typeof sg === 'object') nodes.push({ t: 'text', v: ', ' });
      else if (sg.trim()) nodes.push({ t: 'math', v: sg.trim() });
    });
  });
  return nodes.length ? nodes : [{ t: 'math', v }];
}

// 긴 수식은 등호 앞에서 끊어 새 수식으로(뒤 수식은 '='로 시작)
export function splitAtEquals(v) {
  const segs = topLevelSplit(v, (s, k) => (s[k] === '=' && s[k - 1] !== '\\' && s[k - 1] !== '<' && s[k - 1] !== '>' && s[k - 1] !== '!' ? 1 : 0));
  const out = [];
  let cur = '';
  segs.forEach((sg) => {
    if (typeof sg === 'object') {
      if (cur.trim()) out.push(cur.trim());
      cur = '=';
    } else cur += sg;
  });
  if (cur.trim()) out.push(cur.trim());
  return out.length > 1 ? out : [v];
}
