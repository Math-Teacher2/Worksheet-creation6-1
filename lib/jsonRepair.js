// AI 응답에서 JSON을 꺼내고, 흔한 오류를 고칩니다.
// 특히 LaTeX 백슬래시(\frac, \to, \neq ...)를 JSON 규칙대로 \\ 로 쓰지 않은 경우,
// JSON.parse가 \f(폼피드), \t(탭), \n(줄바꿈)으로 잘못 읽어 수식이 깨지는 문제를 막습니다.

export function stripFences(text) {
  return String(text || '')
    .replace(/^﻿/, '')
    .replace(/^\s*```(?:json|JSON)?\s*/, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

// 문자열 리터럴 안의 잘못된 이스케이프를 고침
export function repairEscapes(src) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (!inStr) {
      if (c === '"') inStr = true;
      out += c;
      continue;
    }
    if (c === '"') {
      inStr = false;
      out += c;
      continue;
    }
    if (c === '\n') {
      out += '\\n';
      continue;
    }
    if (c === '\r') continue;
    if (c === '\t') {
      out += '\\t';
      continue;
    }
    if (c !== '\\') {
      out += c;
      continue;
    }
    const nx = src[i + 1];
    if (nx === undefined) {
      out += '\\\\';
      continue;
    }
    if (nx === '\\' || nx === '"' || nx === '/') {
      out += c + nx;
      i++;
      continue;
    }
    if (nx === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
      out += src.slice(i, i + 6);
      i += 5;
      continue;
    }
    // \b \f \n \r \t 뒤에 영문자가 이어지면 LaTeX 명령으로 판단 (\frac, \neq, \to, \theta, \right, \beta ...)
    if ('bfnrt'.includes(nx) && !/[a-zA-Z]/.test(src[i + 2] || '')) {
      out += c + nx;
      i++;
      continue;
    }
    // 그 밖의 모든 경우(\lim, \{, \, ...)는 백슬래시를 두 번
    out += '\\\\';
  }
  return out;
}

function removeTrailingCommas(s) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += s[i + 1] || '';
        i++;
      } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '}' || s[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

// 잘린 JSON을 닫아 줌 (출력 한도에 걸린 경우 일부라도 살리기 위함)
function closeTruncated(s) {
  const stack = [];
  let inStr = false;
  let lastSafe = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      stack.pop();
      lastSafe = i + 1;
    } else if (c === ',') lastSafe = i;
  }
  if (!stack.length && !inStr) return s;
  // 마지막으로 완결된 위치까지 자르고 남은 괄호를 닫음
  let cut = s.slice(0, lastSafe);
  const st = [];
  let str = false;
  for (let i = 0; i < cut.length; i++) {
    const c = cut[i];
    if (str) {
      if (c === '\\') i++;
      else if (c === '"') str = false;
      continue;
    }
    if (c === '"') str = true;
    else if (c === '{' || c === '[') st.push(c);
    else if (c === '}' || c === ']') st.pop();
  }
  cut = cut.replace(/,\s*$/, '');
  while (st.length) cut += st.pop() === '{' ? '}' : ']';
  return cut;
}

export function parseModelJson(text, { allowTruncated = false } = {}) {
  let s = stripFences(text);
  const start = s.indexOf('{');
  if (start < 0) throw new Error('AI 응답에서 JSON을 찾지 못했습니다.');
  s = s.slice(start);
  const end = s.lastIndexOf('}');
  const attempts = [];
  const body = end > 0 ? s.slice(0, end + 1) : s;
  attempts.push(() => JSON.parse(removeTrailingCommas(repairEscapes(body))));
  if (allowTruncated) attempts.push(() => JSON.parse(removeTrailingCommas(closeTruncated(repairEscapes(s)))));
  let lastErr;
  for (const f of attempts) {
    try {
      return f();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`AI 응답을 해석하지 못했습니다. (${lastErr?.message || 'JSON 오류'})`);
}
