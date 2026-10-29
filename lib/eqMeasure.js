// 한글 수식 스크립트의 상자 크기(너비·높이·기준선)를 추정합니다.
//
// 한컴오피스는 HWPX를 열 때 수식 크기를 다시 계산하지 않고 파일에 저장된
// <hp:sz>와 baseLine을 그대로 씁니다. 그래서 크기를 잘 맞춰 써야 수식 뒤 글자가
// 겹치거나 빈칸이 생기지 않습니다.
//
// 이 파일은 python-hwpx (Apache-2.0, https://github.com/airmang/python-hwpx)의
// equation/measure.py 를 JavaScript로 옮긴 것입니다. 글자 폭 값은 원저자가
// 한컴오피스가 저장한 실제 수식 상자에 맞춰 구한 값입니다.

const OPERATOR_WORDS = new Set([
  'pm', 'mp', 'times', 'TIMES', 'cdot', 'div', 'ast', 'star', 'circ', 'bullet', 'oplus', 'otimes',
  'leq', 'LEQ', 'geq', 'GEQ', 'neq', 'NEQ', 'equiv', 'approx', 'sim', 'simeq', 'cong', 'propto', 'prop',
  'll', 'gg', 'in', 'notin', 'subset', 'subseteq', 'supset', 'supseteq', 'cup', 'cap', 'emptyset',
  'forall', 'FORALL', 'exists', 'neg', 'land', 'lor', 'infty', 'inf', 'infinity', 'partial', 'nabla',
  'angle', 'triangle', 'TRIANGLE', 'therefore', 'THEREFORE', 'because', 'cdots', 'ldots', 'vdots',
  'ddots', 'dots', 'prime', 'rightarrow', 'leftarrow', 'leftrightarrow', 'Rightarrow', 'Leftarrow',
  'to', 'mapsto', '`',
]);
const SYMBOL_OPERATORS = ['<->', '~|~', '+-', '-+', '<=', '>=', '!=', '==', '->', '<-', '=>', '~='];
const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota',
  'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau',
  'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'GAMMA', 'DELTA', 'THETA', 'LAMBDA', 'XI', 'PI', 'SIGMA',
  'UPSILON', 'PHI', 'PSI', 'OMEGA',
]);
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan', 'log',
  'ln', 'lg', 'exp', 'det', 'dim', 'gcd', 'max', 'min', 'mod',
]);
const BIG_OPERATORS = new Set(['int', 'iint', 'iiint', 'dint', 'tint', 'oint', 'sum', 'prod', 'coprod', 'lim', 'limsup', 'liminf', 'bigcup', 'bigcap']);
const ACCENTS = new Set(['bar', 'vec', 'dyad', 'hat', 'tilde', 'dot', 'ddot', 'acute', 'grave', 'check', 'breve', 'widehat', 'widetilde', 'overline', 'underline']);
const MATRICES = new Set(['matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'dmatrix', 'cases', 'pile', 'lpile', 'rpile', 'eqalign']);

const E = {
  DIGIT: 0.47, LOWER: 0.57, UPPER: 0.81, UPRIGHT_LOWER: 0.4, UPRIGHT_UPPER: 0.67, GREEK: 0.57, GREEK_UPPER: 0.78,
  HANGUL: 0.83, PUNCT: 0.15, COMMA_SPACE: 0.17, BRACKET: 0.35, BRACE: 0.56, BAR: 0.45, DOUBLE_BAR: 1.3,
  PRIME: 0.21, DEGREE: 0.73, OPERATOR_GLYPH: 0.52, OPERATOR_SPACE: 0.25, FUNCTION_PAD: 0.16, SPACE: 0.25,
  THIN_SPACE: 0.09, OTHER: 0.36, SYMBOL: 1.05, SCRIPT_SCALE: 0.55, SCRIPT_WIDTH: 0.66, SCRIPT_RAISE: 0.48,
  SUBSCRIPT_DROP: -0.2, FRACTION_PAD: 0.25, FRACTION_GAP: 0.34, FRACTION_AXIS: 0.37, ATOP_GAP: 0.14,
  ROOT_SIGN: 1.21, ROOT_INDEX_ROOM: 0.41, ROOT_TOP: 0.14, BIG_OPERATOR: 1.24, BIG_OPERATOR_HEIGHT: 1.25,
  INTEGRAL_SIGN: 0.88, INTEGRAL_SPACE: 0.36, INTEGRAL_HEIGHT: 2.27, INTEGRAL_LIMIT_EXTRA: 0.2,
  LIMIT_SCALE: 0.75, LIMIT_GAP: 0.035, ACCENT_TOP: 0.25, COLUMN_GAP: 0.2, ROW_GAP: 0.25, LINE_GAP: 0.3,
  ASCENT: 0.85, DESCENT: 0.14,
};
const INTEGRALS = { int: 1, oint: 1, dint: 2, tint: 3 };
const MATRIX_DELIMITERS = { pmatrix: ['(', 2], bmatrix: ['[', 2], Bmatrix: ['{', 2], vmatrix: ['|', 2], Vmatrix: ['|', 2], dmatrix: ['|', 2], cases: ['{', 1] };
const LETTER_WIDTHS = { a: 0.51, b: 0.42, c: 0.32, d: 0.46, f: 0.67, k: 0.4, n: 0.6, r: 0.37, x: 0.52, y: 0.51, i: 0.31, j: 0.31, l: 0.31, t: 0.31, m: 1.03, w: 1.03 };
const UPRIGHT_WIDTHS = { f: 0.32, i: 0.32, j: 0.32, l: 0.32, r: 0.32, t: 0.32, m: 0.84, w: 0.84 };
const STRETCHED = { '(': 0.39, ')': 0.39, '[': 0.52, ']': 0.52, '|': 0.52, '{': 0.58, '}': 0.58 };
const STRETCHED_NAMES = { lbrace: '{', rbrace: '}', langle: '(', rangle: ')', lfloor: '[', rfloor: ']', lceil: '[', rceil: ']', line: '|', vert: '|' };
const OPERATOR_GLYPHS = { '+': 0.65, '-': 0.69, '=': 0.71, '<': 0.8, '>': 0.8, times: 0.61, TIMES: 0.55, LEQ: 0.95, GEQ: 0.95, leq: 0.95, geq: 0.95, NEQ: 0.8, '!=': 0.8, '->': 0.95, rarrow: 1.0, RARROW: 1.0, LRARROW: 1.0 };
const SIGNS = new Set(['+', '-', '+-', '-+', 'pm', 'mp']);
const GREEK_WIDTHS = { alpha: 0.61, beta: 0.54, theta: 0.43, lambda: 0.52, sigma: 0.52 };
const KEYWORD_GLYPHS = { lbrace: E.BRACE, rbrace: E.BRACE, langle: E.BRACKET, rangle: E.BRACKET, lfloor: E.BRACKET, rfloor: E.BRACKET, lceil: E.BRACKET, rceil: E.BRACKET, prime: E.PRIME, deg: E.DEGREE };
const CASED_KEYWORD_GLYPHS = { LINE: E.BAR, vert: E.BAR, VERT: E.DOUBLE_BAR };
const LIMIT_WORDS = new Set(['lim', 'limsup', 'liminf', 'max', 'min']);
const FONT_WORDS = new Set(['rm', 'it', 'bold']);
const RELATIONS = new Set(['=', '<', '>', '+', '-', '×', '÷', ...SYMBOL_OPERATORS]);
const SYMBOL_RELATIONS = new Set([
  'sim', 'simeq', 'approx', 'cong', 'equiv', 'in', 'ni', 'notin', 'subset', 'supset', 'nsubset', 'nsupset',
  'subseteq', 'supseteq', 'cup', 'cap', 'smallinter', 'smallunion', 'perp', 'parallel', 'propto', 'prop', 'le',
  'ge', 'leq', 'geq', 'ne', 'neq', 'times', 'div', 'divide', 'pm', 'mp', 'cdot', 'circ', 'bullet', 'rarrow',
  'larrow', 'lrarrow', 'rightarrow', 'leftarrow', 'therefore', 'because', 'vee', 'wedge', 'oplus', 'otimes',
  'll', 'gg', 'lsub', 'rsub',
]);
const SYMBOL_ORDINARY = new Set([
  'inf', 'infinity', 'angle', 'triangle', 'partial', 'nabla', 'hbar', 'emptyset', 'aleph', 'forall', 'exists',
  'neg', 'cdots', 'ldots', 'vdots', 'ddots', 'dagger', 'box', 'diamond', 'centigrade',
]);
const BREAK_CHARS = new Set('{}^_&#()[]|'.split(''));

const box = (width, ascent, descent) => ({ width, ascent, descent });
const height = (b) => b.ascent + b.descent;
const scaled = (b, f) => box(b.width * f, b.ascent * f, b.descent * f);
const isUpper = (s) => s === s.toUpperCase() && s !== s.toLowerCase();
const isAlpha = (s) => /^[A-Za-z]+$/.test(s);

export function tokenizeHwpEq(source) {
  const tokens = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      const j = source.indexOf('"', i + 1);
      if (j === -1) {
        tokens.push(source.slice(i));
        break;
      }
      tokens.push(source.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    const op = SYMBOL_OPERATORS.find((o) => source.startsWith(o, i));
    if (op) {
      tokens.push(op);
      i += op.length;
      continue;
    }
    if (BREAK_CHARS.has(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9.]/.test(source[j])) j++;
      tokens.push(source.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z가-힣]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z가-힣]/.test(source[j])) j++;
      tokens.push(source.slice(i, j));
      i = j;
      continue;
    }
    tokens.push(ch);
    i++;
  }
  return tokens;
}

function row(boxes) {
  let r = box(0, E.ASCENT, E.DESCENT);
  for (const b of boxes) r = box(r.width + b.width, Math.max(r.ascent, b.ascent), Math.max(r.descent, b.descent));
  return r;
}
function stack(lines, gap) {
  const h = lines.reduce((s, l) => s + height(l), 0) + gap * (lines.length - 1);
  return box(Math.max(...lines.map((l) => l.width)), lines[0].ascent, h - lines[0].ascent);
}
function fraction(num, den, gap = E.FRACTION_GAP) {
  return box(Math.max(num.width, den.width) + 2 * E.FRACTION_PAD, height(num) + gap / 2 + E.FRACTION_AXIS, height(den) + gap / 2 - E.FRACTION_AXIS);
}
function grid(rows) {
  if (!rows.length) return row([]);
  const columns = Math.max(...rows.map((r) => r.length));
  const widths = [];
  for (let c = 0; c < columns; c++) widths.push(Math.max(0, ...rows.filter((r) => c < r.length).map((r) => r[c].width)));
  const h = rows.reduce((s, r) => s + Math.max(...r.map(height)), 0) + E.ROW_GAP * (rows.length - 1);
  return box(widths.reduce((a, b) => a + b, 0) + E.COLUMN_GAP * (columns - 1), h / 2 + E.FRACTION_AXIS, h / 2 - E.FRACTION_AXIS);
}
function binomial(top, bottom) {
  const b = grid([[top], [bottom]]);
  return box(b.width + 2 * STRETCHED['('], b.ascent, b.descent);
}
function script(b) {
  return box(b.width * E.SCRIPT_WIDTH, b.ascent * E.SCRIPT_SCALE, b.descent * E.SCRIPT_SCALE);
}
function charWidth(ch, upright = false) {
  if (ch >= '가' && ch <= '힣') return E.HANGUL;
  if (/[0-9]/.test(ch)) return E.DIGIT;
  if (ch === ' ') return E.SPACE;
  if (upright) return isUpper(ch) ? E.UPRIGHT_UPPER : UPRIGHT_WIDTHS[ch] ?? E.UPRIGHT_LOWER;
  return LETTER_WIDTHS[ch] ?? (isUpper(ch) ? E.UPPER : E.LOWER);
}
const uprightWord = (w) => [...w].reduce((s, c) => s + charWidth(c, true), 0);
const isOperator = (t) => OPERATOR_WORDS.has(t) || RELATIONS.has(t) || SYMBOL_RELATIONS.has(t.toLowerCase());

function tokenWidth(token, upright = false, sign = false, tight = false) {
  const lower = token.toLowerCase();
  if (token.startsWith('"')) return [...token.replace(/"/g, '')].reduce((s, c) => s + charWidth(c, upright), 0);
  if (GREEK.has(token)) return GREEK_WIDTHS[token] ?? (isUpper(token) ? E.GREEK_UPPER : E.GREEK);
  if (CASED_KEYWORD_GLYPHS[token] !== undefined) return CASED_KEYWORD_GLYPHS[token];
  if (KEYWORD_GLYPHS[lower] !== undefined) return KEYWORD_GLYPHS[lower];
  if (isOperator(token)) {
    const glyph = OPERATOR_GLYPHS[token] ?? E.OPERATOR_GLYPH;
    return glyph + (sign ? 1 : 2) * E.OPERATOR_SPACE * (tight ? 0.25 : 1);
  }
  if (SYMBOL_ORDINARY.has(lower)) return E.SYMBOL;
  if (/^[0-9.]+$/.test(token) && /[0-9]/.test(token)) return [...token].reduce((s, c) => s + (/[0-9]/.test(c) ? E.DIGIT : E.PUNCT), 0);
  if (/^[A-Za-z가-힣]+$/.test(token)) return [...token].reduce((s, c) => s + charWidth(c, upright), 0);
  if ('()[]'.includes(token)) return E.BRACKET;
  if (token === '|') return E.BAR;
  if (token === "'") return E.PRIME;
  if (token === ',') return E.PUNCT + E.COMMA_SPACE;
  if ('.;:!'.includes(token)) return E.PUNCT;
  return E.OTHER;
}
function followsOperand(token, operand) {
  if (FONT_WORDS.has(token.toLowerCase())) return operand;
  return !(isOperator(token) || token === '(' || token === '[' || token === ',');
}
function stretched(token) {
  if (token === undefined) return 0;
  const name = token === 'VERT' ? token : token.toLowerCase();
  return STRETCHED[STRETCHED_NAMES[name] ?? token] ?? E.BRACKET;
}

class Measurer {
  constructor(tokens) {
    this.t = tokens;
    this.p = 0;
    this.tooDeep = false;
    this.upright = false;
    this.tight = 0;
  }
  peek() {
    return this.t[this.p];
  }
  next() {
    return this.t[this.p++];
  }
  sequence(depth, stop) {
    const lines = [];
    let items = [];
    let operand = false;
    for (;;) {
      const tk = this.peek();
      if (tk === undefined || tk === stop || (stop === 'RIGHT' && (tk === 'RIGHT' || tk === 'right'))) break;
      this.next();
      if (tk === '#') {
        lines.push(row(items));
        items = [];
        operand = false;
      } else if (tk === '&') {
        operand = false;
      } else if (!this.infix(tk, items, depth)) {
        items.push(this.dispatch(tk, depth, !operand && SIGNS.has(tk)));
        operand = followsOperand(tk, operand);
      }
    }
    if (!lines.length) return row(items);
    return stack([...lines, row(items)], E.LINE_GAP);
  }
  infix(tk, items, depth) {
    if (tk === '^' || tk === '_') {
      items.push(this.scripts(items.length ? items.pop() : box(0, 0, 0), tk, depth));
    } else if (tk === 'over' || tk.toLowerCase() === 'atop') {
      const num = items.length ? items.pop() : row([]);
      items.push(fraction(num, this.atom(depth), tk === 'over' ? E.FRACTION_GAP : E.ATOP_GAP));
    } else if (tk.toLowerCase() === 'choose') {
      const top = items.length ? items.pop() : row([]);
      items.push(binomial(top, this.atom(depth)));
    } else return false;
    return true;
  }
  atom(depth) {
    const tk = this.next();
    return tk === undefined ? box(0, 0, 0) : this.dispatch(tk, depth);
  }
  group(depth) {
    if (depth + 1 > 64) {
      this.tooDeep = true;
      return box(0, 0, 0);
    }
    const upright = this.upright;
    const inner = this.sequence(depth + 1, '}');
    this.upright = upright;
    if (this.peek() === '}') this.next();
    return inner;
  }
  scripts(base, op, depth) {
    this.tight++;
    const s = { [op]: script(this.atom(depth)) };
    this.tight--;
    const following = this.peek();
    if ((following === '^' || following === '_') && following !== op) {
      this.next();
      s[following] = script(this.atom(depth));
    }
    const up = s['^'];
    const lo = s['_'];
    const width = base.width + Math.max(up ? up.width : 0, lo ? lo.width : 0);
    const top = Math.max(base.ascent - E.ASCENT, 0);
    const bottom = Math.max(base.descent - E.DESCENT, 0);
    const ascent = up ? Math.max(base.ascent, top + E.SCRIPT_RAISE + height(up)) : base.ascent;
    const descent = lo ? Math.max(base.descent, bottom + E.SUBSCRIPT_DROP + height(lo)) : base.descent;
    return box(width, ascent, descent);
  }
  dispatch(tk, depth, sign = false) {
    if (tk === '{') return this.group(depth);
    if (tk === 'sqrt' || tk === 'root') return this.root(tk, depth);
    if (ACCENTS.has(tk)) {
      const inner = this.atom(depth);
      return box(inner.width, inner.ascent + E.ACCENT_TOP, inner.descent);
    }
    if (tk.toLowerCase() === 'binom') {
      const top = this.atom(depth);
      return binomial(top, this.atom(depth));
    }
    if (MATRICES.has(tk)) {
      const b = this.matrix(depth);
      const [delim, count] = MATRIX_DELIMITERS[tk] || ['', 0];
      return box(b.width + count * (STRETCHED[delim] ?? E.BRACKET), b.ascent, b.descent);
    }
    if (tk === 'LEFT' || tk === 'left') return this.delimited(depth);
    if (tk === 'RIGHT' || tk === 'right') return box(stretched(this.next()), E.ASCENT, E.DESCENT);
    if (INTEGRALS[tk]) return this.integral(tk, depth);
    if (LIMIT_WORDS.has(tk.toLowerCase()) && (this.peek() === '_' || this.peek() === 'from')) return this.limit(tk, depth);
    if (BIG_OPERATORS.has(tk) && !LIMIT_WORDS.has(tk.toLowerCase()) && tk !== 'iint' && tk !== 'iiint') return this.bigOperator(depth);
    return this.symbol(tk, sign);
  }
  symbol(tk, sign = false) {
    if (FUNCTIONS.has(tk) || LIMIT_WORDS.has(tk.toLowerCase())) return box(uprightWord(tk) + E.FUNCTION_PAD, E.ASCENT, E.DESCENT);
    if (FONT_WORDS.has(tk.toLowerCase()) || tk === 'of' || tk === '&') {
      if (tk.toLowerCase() === 'rm' || tk.toLowerCase() === 'it') this.upright = tk.toLowerCase() === 'rm';
      return box(0, 0, 0);
    }
    if (tk === '~') return box(E.SPACE, 0, 0);
    if (tk === '`') return box(E.THIN_SPACE, 0, 0);
    return box(tokenWidth(tk, this.upright, sign, this.tight > 0), E.ASCENT, E.DESCENT);
  }
  root(tk, depth) {
    let index = box(0, 0, 0);
    if (tk === 'root') {
      index = this.atom(depth);
      if (this.peek() === 'of') this.next();
    }
    const inner = this.atom(depth);
    const overhang = Math.max(0, script(index).width - E.ROOT_INDEX_ROOM);
    return box(inner.width + E.ROOT_SIGN + overhang, inner.ascent + E.ROOT_TOP, inner.descent);
  }
  delimited(depth) {
    const opening = stretched(this.next());
    const body = this.sequence(depth, 'RIGHT');
    let closing = 0;
    if (this.peek() === 'RIGHT' || this.peek() === 'right') {
      this.next();
      closing = stretched(this.next());
    }
    return box(body.width + opening + closing, body.ascent, body.descent);
  }
  integral(tk, depth) {
    const width = E.INTEGRAL_SIGN * INTEGRALS[tk];
    let ascent = E.INTEGRAL_HEIGHT * 0.6;
    let descent = E.INTEGRAL_HEIGHT * 0.4;
    let limitWidth = 0;
    while (['_', '^', 'from', 'to'].includes(this.peek())) {
      const upper = ['^', 'to'].includes(this.next());
      const lim = script(this.atom(depth));
      limitWidth = Math.max(limitWidth, lim.width);
      if (upper) ascent += E.INTEGRAL_LIMIT_EXTRA;
      else descent += E.INTEGRAL_LIMIT_EXTRA;
    }
    return box(width + limitWidth + E.INTEGRAL_SPACE, ascent, descent);
  }
  limit(tk, depth) {
    this.next();
    this.tight++;
    const lim = scaled(this.atom(depth), E.LIMIT_SCALE);
    this.tight--;
    const width = uprightWord(tk) + E.FUNCTION_PAD;
    return box(Math.max(width, lim.width), E.ASCENT, E.DESCENT + height(lim) + E.LIMIT_GAP);
  }
  bigOperator(depth) {
    const b = box(E.BIG_OPERATOR, E.BIG_OPERATOR_HEIGHT * 0.6, E.BIG_OPERATOR_HEIGHT * 0.4);
    const limits = [];
    while (['_', '^', 'from', 'to'].includes(this.peek())) {
      this.next();
      limits.push(scaled(this.atom(depth), E.LIMIT_SCALE));
    }
    if (!limits.length) return b;
    const extra = limits.reduce((s, l) => s + height(l), 0) / 2;
    return box(Math.max(b.width, ...limits.map((l) => l.width)), b.ascent + extra, b.descent + extra);
  }
  matrix(depth) {
    if (this.peek() !== '{') return box(E.LOWER * 6, E.ASCENT, E.DESCENT);
    this.next();
    const rows = [[]];
    const upright = this.upright;
    while (this.peek() !== undefined && this.peek() !== '}') {
      rows[rows.length - 1].push(this.cell(depth));
      if (this.peek() === '#') {
        this.next();
        rows.push([]);
      } else if (this.peek() === '&') this.next();
    }
    if (this.peek() === '}') this.next();
    this.upright = upright;
    return grid(rows.filter((r) => r.length));
  }
  cell(depth) {
    const items = [];
    let operand = false;
    while (![undefined, '}', '&', '#'].includes(this.peek())) {
      const tk = this.next() || '';
      if (!this.infix(tk, items, depth + 1)) {
        items.push(this.dispatch(tk, depth + 1, !operand && SIGNS.has(tk)));
        operand = followsOperand(tk, operand);
      }
    }
    return row(items);
  }
}

// baseUnit: 글자 크기 (1000 = 10pt). 반환: HWPUNIT 단위 너비·높이와 baseLine(%)
export function measureHwpEquation(scriptText, baseUnit = 1000) {
  const text = String(scriptText || '').trim();
  let b = null;
  if (text.length <= 10000) {
    const m = new Measurer(tokenizeHwpEq(text));
    try {
      b = m.sequence(0);
    } catch {
      b = null;
    }
    if (m.tooDeep) b = null;
  }
  if (!b) {
    const visible = text.replace(/[{}\s]/g, '').length;
    b = box(Math.max(1, visible) * E.LOWER, E.ASCENT, E.DESCENT);
  }
  const h = Math.max(height(b), E.ASCENT + E.DESCENT);
  return {
    // 한컴(Windows) 실제 저장값 대비 약간 넉넉하게: 좁으면 뒤 글자가 겹치므로
    width: Math.max(1, Math.round(b.width * baseUnit * 1.04 + baseUnit * 0.06)),
    height: Math.max(1, Math.round(h * baseUnit)),
    baseLine: Math.max(1, Math.min(100, Math.round((100 * b.ascent) / h))),
  };
}
