// LaTeX 수식 -> 한글(HWP) 수식 스크립트 변환기.
//
// 한컴 수식 편집기 문법(EqEdit)에 맞춰 변환합니다. 토큰 선택은 python-hwpx
// (Apache-2.0, https://github.com/airmang/python-hwpx)의 equation/authoring.py에서
// 한컴 실제 렌더링으로 검증된 표기(예: \to -> "->", \forall -> "FORALL",
// \text -> {rm "..." it}, 예약어 따옴표 처리)를 참고해 JavaScript로 다시 작성했습니다.
// 원본과 달리 지원하지 않는 명령을 만나도 멈추지 않고 가장 가까운 표기로 바꿉니다.

const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta',
  'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma',
  'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
]);
const GREEK_UPPER = {
  Gamma: 'GAMMA', Delta: 'DELTA', Theta: 'THETA', Lambda: 'LAMBDA', Xi: 'XI', Pi: 'PI',
  Sigma: 'SIGMA', Upsilon: 'UPSILON', Phi: 'PHI', Psi: 'PSI', Omega: 'OMEGA',
};

const SYMBOLS = {
  times: 'TIMES', div: 'DIV', cdot: 'cdot', pm: '+-', mp: '-+', ast: 'ast', star: 'star',
  circ: 'CIRC', bullet: 'bullet', oplus: 'oplus', otimes: 'otimes',
  le: 'LEQ', leq: 'LEQ', leqslant: 'LEQ', ge: 'GEQ', geq: 'GEQ', geqslant: 'GEQ',
  ne: '!=', neq: '!=', lt: '<', gt: '>',
  approx: 'approx', equiv: 'equiv', sim: 'sim', simeq: 'simeq', cong: 'cong', propto: 'propto',
  ll: 'll', gg: 'gg',
  in: 'IN', notin: 'notin', ni: 'ni', subset: 'SUBSET', subseteq: 'subseteq', supset: 'supset',
  supseteq: 'supseteq', cup: 'CUP', cap: 'SMALLINTER', setminus: '-',
  emptyset: 'EMPTYSET', varnothing: 'EMPTYSET', forall: 'FORALL', exists: 'exists', neg: 'neg',
  lnot: 'neg', land: 'land', lor: 'lor', wedge: 'land', vee: 'lor',
  infty: 'INF', partial: 'partial', nabla: 'nabla', angle: 'ANGLE', triangle: 'TRIANGLE',
  therefore: 'therefore', because: 'because',
  square: '"□"', Box: '"□"', boxed: '"□"', blacksquare: '"■"', bigcirc: '"○"',
  cdots: 'cdots', ldots: 'ldots', dots: 'cdots', vdots: 'vdots', ddots: 'ddots',
  prime: "'", degree: 'DEG',
  to: '` rarrow `', rightarrow: '` rarrow `', longrightarrow: '` rarrow `', leftarrow: '<-', longleftarrow: '<-',
  leftrightarrow: '<->', Rightarrow: 'RARROW', Longrightarrow: 'RARROW', implies: 'RARROW',
  Leftarrow: 'LARROW', Longleftarrow: 'LARROW', impliedby: 'LARROW',
  Leftrightarrow: 'LRARROW', Longleftrightarrow: 'LRARROW', iff: 'LRARROW',
  mapsto: 'mapsto', uparrow: 'uparrow', downarrow: 'downarrow',
  mid: '~|~', parallel: 'parallel', perp: 'perp', vert: '|', lvert: '|', rvert: '|',
  Vert: '||', lVert: '||', rVert: '||',
  lbrace: 'LBRACE', rbrace: 'RBRACE', langle: 'LANGLE', rangle: 'RANGLE',
  lfloor: 'lfloor', rfloor: 'rfloor', lceil: 'lceil', rceil: 'rceil',
  hbar: 'hbar', ell: 'l', aleph: 'aleph',
};

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan',
  'log', 'ln', 'lg', 'exp', 'det', 'dim', 'gcd', 'max', 'min', 'sup', 'arg', 'deg', 'mod',
]);
const BIG_OPS = { lim: 'lim', sum: 'sum', prod: 'prod', coprod: 'coprod', int: 'int', iint: 'dint', iiint: 'tint', oint: 'oint', bigcup: 'bigcup', bigcap: 'bigcap' };
const ACCENTS = {
  bar: 'bar', overline: 'overline', vec: 'vec', overrightarrow: 'vec', hat: 'hat', widehat: 'hat',
  tilde: 'tilde', widetilde: 'tilde', dot: 'dot', ddot: 'ddot', underline: 'underline',
  overleftrightarrow: 'dyad', acute: 'acute', grave: 'grave', check: 'check', breve: 'breve',
};
const SPACING = { ',': '`', ';': '~', ':': '~', ' ': '~', '>': '~', quad: '~~', qquad: '~~~~', '!': '', thinspace: '`', enspace: '~', medspace: '~' };
const IGNORED = new Set([
  'displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'left.', 'right.', 'big', 'Big',
  'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'nonumber', 'notag', 'relax',
]);
const TEXT_CMDS = new Set(['text', 'textrm', 'mathrm', 'mbox', 'operatorname', 'textup', 'mathsf', 'textsf', 'texttt', 'mathtt', 'textnormal']);
const ENVS = { cases: 'cases', matrix: 'matrix', pmatrix: 'pmatrix', bmatrix: 'bmatrix', vmatrix: 'dmatrix', Vmatrix: 'dmatrix', Bmatrix: 'matrix', smallmatrix: 'matrix', array: 'matrix', aligned: 'eqalign', align: 'eqalign', 'align*': 'eqalign', gathered: 'pile', gather: 'pile', split: 'eqalign', rcases: 'cases', dcases: 'cases' };

const UNICODE = {
  '≤': 'LEQ', '≦': 'LEQ', '≥': 'GEQ', '≧': 'GEQ', '≠': '!=', '±': '+-', '∓': '-+', '×': 'TIMES',
  '÷': 'DIV', '·': 'cdot', '∙': 'cdot', '⋅': 'cdot', '∞': 'INF', '→': '` rarrow `', '←': '<-', '↔': '<->',
  '⇒': 'RARROW', '⇐': 'LARROW', '⇔': 'LRARROW', '∈': 'IN', '∉': 'notin', '⊂': 'SUBSET', '⊆': 'subseteq',
  '⊃': 'supset', '⊇': 'supseteq', '∪': 'CUP', '∩': 'SMALLINTER', '∅': 'EMPTYSET', '∀': 'FORALL', '∃': 'exists',
  '∴': 'therefore', '∵': 'because', '∠': 'ANGLE', '△': 'TRIANGLE', '°': 'DEG', '′': "'", '…': 'ldots',
  '⋯': 'CDOTS', '−': '-', '–': '-', '≈': 'approx', '≡': 'equiv', '∼': 'sim', '∥': 'parallel', '⊥': 'perp',
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'θ': 'theta', 'λ': 'lambda',
  'μ': 'mu', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'τ': 'tau', 'φ': 'phi', 'ω': 'omega', 'Δ': 'DELTA',
  'Σ': 'SIGMA', 'Ω': 'OMEGA', '√': 'sqrt', '∑': 'sum', '∫': 'int', '｜': '|',
};

// 한컴 수식에서 명령어로 읽히는 단어들: 변수로 쓰일 때는 따옴표로 감쌉니다.
const RESERVED = new Set([
  ...GREEK, ...Object.values(GREEK_UPPER), ...FUNCTIONS, ...Object.values(BIG_OPS), ...Object.keys(BIG_OPS),
  ...Object.values(ACCENTS), 'over', 'atop', 'choose', 'binom', 'sqrt', 'root', 'of', 'left', 'right',
  'LEFT', 'RIGHT', 'rm', 'it', 'bold', 'RM', 'IT', 'BOLD', 'cases', 'matrix', 'pmatrix', 'bmatrix',
  'dmatrix', 'pile', 'lpile', 'rpile', 'eqalign', 'times', 'TIMES', 'div', 'DIV', 'cdot', 'pm', 'mp',
  'leq', 'geq', 'neq', 'LEQ', 'GEQ', 'NEQ', 'le', 'ge', 'ne', 'in', 'notin', 'subset', 'supset', 'cup',
  'cap', 'inf', 'INF', 'infty', 'to', 'from', 'sim', 'approx', 'equiv', 'circ', 'deg', 'DEG', 'angle',
  'ANGLE', 'prime', 'dots', 'cdots', 'ldots', 'partial', 'nabla', 'forall', 'exists', 'neg', 'land',
  'lor', 'vec', 'bar', 'hat', 'dot', 'line', 'vert', 'VERT', 'LINE', 'smallinter', 'smallunion',
  'therefore', 'because', 'triangle', 'TRIANGLE', 'emptyset', 'ast', 'star', 'prod', 'sum', 'int',
  'oint', 'dint', 'tint', 'lim', 'Lim', 'not', 'rarrow', 'larrow', 'lrarrow', 'RARROW', 'LARROW',
  'LRARROW', 'under', 'dyad', 'acute', 'grave', 'check', 'breve', 'tilde', 'ddot', 'mapsto', 'and',
  'or', 'mod', 'propto', 'cong', 'simeq', 'perp', 'parallel', 'hbar', 'aleph', 'color', 'scale',
]);

function lex(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '\\') {
      if (i + 1 >= n) {
        i++;
        continue;
      }
      const nx = src[i + 1];
      if (nx === '\\') {
        tokens.push('\\\\');
        i += 2;
      } else if (/[a-zA-Z]/.test(nx)) {
        let j = i + 1;
        while (j < n && /[a-zA-Z]/.test(src[j])) j++;
        let name = src.slice(i + 1, j);
        if ((name === 'left' || name === 'right') && src[j] === '.') {
          tokens.push(`\\${name}.`);
          j++;
        } else if (src[j] === '*' && (name === 'operatorname')) {
          j++;
          tokens.push(`\\${name}`);
        } else {
          tokens.push(`\\${name}`);
        }
        i = j;
        // \text{...} 류는 안쪽 글자를 그대로 보존
        if (TEXT_CMDS.has(name)) {
          let k = i;
          while (k < n && src[k] === ' ') k++;
          if (src[k] === '{') {
            let depth = 0;
            let m = k;
            for (; m < n; m++) {
              if (src[m] === '\\') {
                m++;
                continue;
              }
              if (src[m] === '{') depth++;
              else if (src[m] === '}') {
                depth--;
                if (depth === 0) break;
              }
            }
            const raw = src
              .slice(k + 1, m)
              .replace(/\\[,;: !]/g, ' ')
              .replace(/\\([{}%&$#_])/g, '$1')
              .replace(/\\[a-zA-Z]+\s*/g, '');
            tokens.push({ rawtext: raw });
            i = Math.min(n, m + 1);
          }
        }
      } else {
        tokens.push(`\\${nx}`);
        i += 2;
      }
    } else if ('{}^_&[]'.includes(ch)) {
      tokens.push(ch);
      i++;
    } else if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      tokens.push(src.slice(i, j));
      i = j;
    } else if (/[a-zA-Z]/.test(ch)) {
      let j = i;
      while (j < n && /[a-zA-Z]/.test(src[j])) j++;
      tokens.push(src.slice(i, j));
      i = j;
    } else if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(ch)) {
      let j = i;
      while (j < n && /[가-힣ㄱ-ㅎㅏ-ㅣ ]/.test(src[j])) j++;
      tokens.push({ hangul: src.slice(i, j).trim() });
      i = j;
    } else {
      tokens.push(ch);
      i++;
    }
  }
  return tokens;
}

const REL = new Set(['=', '<', '>', 'LEQ', 'GEQ', '!=', 'approx', 'equiv', 'sim', 'simeq', 'cong', 'IN', 'SUBSET', 'notin', 'subseteq', 'supset', 'supseteq', 'RARROW', 'LRARROW', 'LARROW']);
const NEG_AFTER = new Set(['=', '<', '>', 'LEQ', 'GEQ', '!=']);
const ARG_FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'exp', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan', 'lg']);
const OPEN_CLOSE = { '(': [')', ']'], '[': [']', ')'], '|': ['|'], '\\{': ['\\}'] };

const P = (s, k = 'other') => ({ s, k });
const join = (parts) => parts.map((x) => x.s).filter((x) => x !== '').join(' ');

class Parser {
  constructor(tokens) {
    this.t = tokens;
    this.p = 0;
    this.depth = 0;
  }
  peek() {
    return this.t[this.p];
  }
  next() {
    return this.t[this.p++];
  }

  parse() {
    const parts = this.sequence(new Set());
    while (this.p < this.t.length) {
      this.next();
      parts.push(...this.sequence(new Set()));
    }
    return finalize(join(parts));
  }

  // 순서열 파싱: 지침의 규칙(lim/int 묶기, 등호 뒤 음수 it, 함수 뒤 ` 등)을 적용
  sequence(stop) {
    const parts = [];
    let wrap = null; // {start, type:'lim'|'int'}
    this.depth++;
    if (this.depth > 60) {
      this.depth--;
      return parts;
    }
    const closeWrap = () => {
      if (!wrap) return;
      const body = parts.splice(wrap.start);
      if (body.length === 1 && body[0].k === 'frac' && body[0].s.startsWith('{')) parts.push(body[0]);
      else if (body.length) parts.push(P(`{${join(body)}}`, 'brace'));
      wrap = null;
    };
    const push = (part) => {
      if (!part || part.s === '') return;
      const prev = parts[parts.length - 1];
      const prev2 = parts[parts.length - 2];
      if (wrap && wrap.type === 'lim' && part.k === 'rel') closeWrap();
      const pv = parts[parts.length - 1];
      // 등호·부등호 바로 뒤의 음수: = it -
      if (part.k === 'minus' && pv && pv.k === 'rel' && NEG_AFTER.has(pv.s.trim())) parts.push(P('it', 'it'));
      // 계수와 함수 이름 사이 `: 3`tan
      if (part.k === 'func' && pv && (pv.k === 'num' || pv.k === 'var')) part.s = '`' + part.s;
      // 함수 이름과 문자 사이 `: sin`x, log _{`2} `x
      if ((part.k === 'var' || part.k === 'num') && pv && (pv.k === 'func' || (pv.k === 'sub' && parts[parts.length - 2]?.k === 'func'))) part.s = '`' + part.s;
      // 대문자 뒤에 LEFT가 오면 `: P` LEFT ( x RIGHT )
      if (part.k === 'paren' && pv && pv.k === 'var' && /^[B-Z]$/.test(pv.s) && !(prev2 && /(^|\s)rm$/i.test(prev2.s))) pv.s += '`';
      parts.push(part);
      if (wrap && wrap.type === 'int' && part.k === 'var' && /^`?d[a-zA-Z]$/.test(part.s)) closeWrap();
      void prev;
    };
    for (;;) {
      const tk = this.peek();
      if (tk === undefined || (typeof tk === 'string' && stop.has(tk))) break;
      if (tk === '^' || tk === '_') {
        this.next();
        while (parts.length && /^[`~]+$/.test(parts[parts.length - 1].s)) parts.pop();
        const base = parts[parts.length - 1];
        const isLog = base && base.k === 'func' && /log$/.test(base.s);
        let body = this.argument();
        if (tk === '^' && /^(circ|CIRC|DEG)$/.test(body.trim())) {
          parts.push(P('DEG', 'var'));
          continue;
        }
        if (isLog && tk === '_') body = '`' + body;
        if (tk === '^' && /^-/.test(body.trim())) body = '`' + body.trim();
        const bigOwner = (() => {
          let j = parts.length - 1;
          while (j >= 0 && ['sub', 'sup', 'subsup'].includes(parts[j].k)) j--;
          return parts[j] && ['lim', 'int', 'big'].includes(parts[j].k);
        })();
        if (tk === '^' && base && base.k === 'sub' && !bigOwner) {
          base.s += `^{\`\`\`${body}}`;
          base.k = 'subsup';
        } else if (tk === '_' && base && base.k === 'sup' && !bigOwner) {
          const sup = base.s.replace(/^\^\{/, '').replace(/\}$/, '');
          base.s = `_{${body}}^{\`\`\`${sup}}`;
          base.k = 'subsup';
        } else {
          parts.push(P(`${tk}{${body}}`, tk === '^' ? 'sup' : 'sub'));
        }
        // 첨자 묶음의 주인 찾기: lim·int 뒤의 식은 { }로 묶음
        let bi = parts.length - 1;
        while (bi >= 0 && ['sub', 'sup', 'subsup'].includes(parts[bi].k)) bi--;
        const owner = parts[bi];
        if (owner && (owner.k === 'lim' || owner.k === 'int') && !(this.peek() === '^' || this.peek() === '_')) {
          wrap = { start: parts.length, type: owner.k };
        }
        continue;
      }
      if (tk === "'") {
        let n = 0;
        while (this.peek() === "'") {
          this.next();
          n++;
        }
        const pv = parts[parts.length - 1];
        if (pv && pv.k === 'var' && /^[a-z]$/.test(pv.s)) parts.push(P(n === 1 ? '` prime' : `\` ${"'".repeat(n)}`, 'prime'));
        else parts.push(P("'".repeat(n), 'prime'));
        continue;
      }
      if (typeof tk === 'string' && OPEN_CLOSE[tk]) {
        this.next();
        push(this.group(tk, stop));
        continue;
      }
      const a = this.atom();
      if (a && a.k === 'int') {
        push(a);
        // 위끝·아래끝이 없으면 바로 묶기 시작
        if (!(this.peek() === '^' || this.peek() === '_')) wrap = { start: parts.length, type: 'int' };
        continue;
      }
      push(a);
    }
    closeWrap();
    // 식 중간의 줄임표: ` CDOTS `
    parts.forEach((x, i) => {
      if (x.k === 'cdots') x.s = parts.length > 1 ? (i === 0 || i === parts.length - 1 ? 'CDOTS' : '` CDOTS `') : 'cdots';
    });
    this.depth--;
    return parts;
  }

  // 괄호 묶음 -> LEFT ( … RIGHT ), 좌표·구간은 여는 괄호 뒤 `, 쉼표 뒤 ``
  group(open, outerStop) {
    const closers = OPEN_CLOSE[open];
    const stop = new Set([...closers, ...outerStop]);
    const inner = this.sequence(stop);
    const c = this.peek();
    if (!closers.includes(c)) {
      return P(`${open === '\\{' ? 'LBRACE' : open} ${join(inner)}`, 'other');
    }
    this.next();
    return P(this.leftRightText(open === '\\{' ? '{' : open, inner, c === '\\}' ? '}' : c), 'paren');
  }

  leftRightText(open, inner, close) {
    const hasComma = inner.some((x) => x.k === 'comma');
    if (hasComma) {
      inner.forEach((x) => {
        if (x.k === 'comma') x.s = ',``';
      });
      if (inner[0]) inner[0].s = '`' + inner[0].s;
    }
    const last = inner[inner.length - 1];
    if (last && last.k === 'var' && /^[B-Z]$/.test(last.s)) last.s += '`';
    return `LEFT ${open} ${join(inner)} RIGHT ${close}`;
  }

  // 한 덩어리 인자: {...} 이면 안쪽 내용, 아니면 원자 하나
  argument() {
    if (this.peek() === '{') {
      this.next();
      const inner = this.sequence(new Set(['}']));
      if (this.peek() === '}') this.next();
      return join(inner);
    }
    const tk = this.peek();
    if (typeof tk === 'string' && /^[0-9]{2,}$/.test(tk)) {
      this.t[this.p] = tk.slice(1);
      return tk[0];
    }
    const a = this.atom();
    return a ? a.s : '';
  }

  rawGroupText() {
    const pk = this.peek();
    if (pk && typeof pk === 'object' && pk.rawtext !== undefined) {
      this.next();
      return pk.rawtext;
    }
    if (this.peek() !== '{') {
      const tk = this.next();
      return typeof tk === 'string' ? tk : tk?.hangul || '';
    }
    this.next();
    let depth = 0;
    const out = [];
    for (;;) {
      const tk = this.next();
      if (tk === undefined) break;
      if (tk === '{') {
        depth++;
        continue;
      }
      if (tk === '}') {
        if (depth === 0) break;
        depth--;
        continue;
      }
      if (typeof tk === 'object') out.push(tk.hangul);
      else if (tk.startsWith('\\')) {
        const name = tk.slice(1);
        if (SPACING[name] !== undefined) out.push(' ');
        else if (name.length === 1) out.push(name);
        else out.push(SYMBOLS[name] ? '' : name);
      } else out.push(tk);
    }
    return out.join(' ').replace(/\s+/g, ' ').replace(/\s([,.)\]])/g, '$1').trim();
  }

  quoted(text) {
    const t = String(text).replace(/"/g, "'").replace(/\s+/g, ' ').trim();
    if (!t) return '';
    // 영문 대문자·숫자뿐이면(단위, 점 이름) rm 으로 바로 씀
    if (/^[A-Za-z0-9]+$/.test(t)) return `rm ${t} it`;
    return `{rm "${t}" it}`;
  }

  atom() {
    const tk = this.next();
    if (tk === undefined) return null;
    if (typeof tk === 'object') return P(this.quoted(tk.rawtext !== undefined ? tk.rawtext : tk.hangul), 'text');
    if (tk === '{') {
      const inner = this.sequence(new Set(['}']));
      if (this.peek() === '}') this.next();
      return P(`{${join(inner)}}`, 'brace');
    }
    if (tk === '}' || tk === ')' || tk === ']') return P(tk === '}' ? '' : tk, 'other');
    if (tk === '&') return P('&', 'amp');
    if (tk === '\\\\') return P('#', 'row');
    if (tk.startsWith('\\')) return this.command(tk.slice(1));
    if (/^[a-zA-Z]+$/.test(tk)) {
      if (ARG_FUNCS.has(tk)) return P(tk, 'func');
      if (tk === 'lim') return P('lim', 'lim');
      return P(RESERVED.has(tk) ? `"${tk}"` : tk, 'var');
    }
    if (/^[0-9.]+$/.test(tk)) return P(tk, 'num');
    if (tk === '-' || tk === '−' || tk === '–') return P('-', 'minus');
    if (tk === ',') return P(',', 'comma');
    if (tk === '=' || tk === '<' || tk === '>') return P(tk, 'rel');
    if (UNICODE[tk]) return P(UNICODE[tk], REL.has(UNICODE[tk]) ? 'rel' : 'var');
    if (tk === '"') return P("''", 'other');
    if (tk === '#') return P('"#"', 'other');
    return P(tk, 'other');
  }

  command(name) {
    if (IGNORED.has(name)) return P('', 'other');
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
      const a = this.argument();
      const b = this.argument();
      return P(`{{${a}} over {${b}}}`, 'frac');
    }
    if (name === 'binom' || name === 'dbinom' || name === 'tbinom') {
      const a = this.argument();
      const b = this.argument();
      return P(`{{${a}} choose {${b}}}`, 'frac');
    }
    if (name === 'sqrt') {
      if (this.peek() === '[') {
        this.next();
        const idx = this.sequence(new Set([']']));
        if (this.peek() === ']') this.next();
        const body = this.argument();
        return P(`root {${join(idx)}} of {${body}}`, 'frac');
      }
      return P(`sqrt {${this.argument()}}`, 'frac');
    }
    if (TEXT_CMDS.has(name)) return P(this.quoted(this.rawGroupText()), 'text');
    if (name === 'textbf' || name === 'mathbf' || name === 'boldsymbol' || name === 'bm') return P(`{rm {bold {${this.argument()}}} it}`, 'var');
    if (name === 'mathbb' || name === 'mathcal' || name === 'mathscr' || name === 'mathfrak') return P(`{rm {bold {${this.argument()}}} it}`, 'var');
    if (name === 'mathit' || name === 'textit' || name === 'emph') return P(`{${this.argument()}}`, 'var');
    if (name === 'begin') return P(this.environment(), 'frac');
    if (name === 'end') {
      this.argument();
      return P('', 'other');
    }
    if (name === 'left') return this.leftRight();
    if (name === 'left.') return this.leftRight('.');
    if (name === 'right' || name === 'right.') {
      if (name === 'right') this.next();
      return P('', 'other');
    }
    if (name === 'overline' || name === 'bar') {
      const a = this.argument();
      // 선분: {bar{rm AB}}
      if (/^[A-Z]{1,3}$/.test(a.trim())) return P(`{bar{rm ${a.trim()}}}`, 'var');
      return P(`{bar{${a}}}`, 'var');
    }
    if (ACCENTS[name]) return P(`${ACCENTS[name]} {${this.argument()}}`, 'var');
    if (name === 'overset' || name === 'stackrel') {
      const top = this.argument();
      const base = this.argument();
      return P(`{{${top}} atop {${base}}}`, 'var');
    }
    if (name === 'underset') {
      const bottom = this.argument();
      const base = this.argument();
      return P(`{{${base}} atop {${bottom}}}`, 'var');
    }
    if (name === 'boxed' || name === 'fbox' || name === 'phantom' || name === 'hphantom' || name === 'cancel') {
      const a = this.argument();
      return P(name.includes('phantom') ? '~' : `{${a}}`, 'other');
    }
    if (name === 'color' || name === 'textcolor') {
      this.argument();
      return P(name === 'textcolor' ? `{${this.argument()}}` : '', 'other');
    }
    if (name === 'not') {
      const nx = this.peek();
      if (nx === '=') {
        this.next();
        return P('!=', 'rel');
      }
      if (nx === '\\in') {
        this.next();
        return P('notin', 'rel');
      }
      return P('', 'other');
    }
    if (name === '{') return this.group('\\{', new Set());
    if (name === 'lim') return P('lim', 'lim');
    if (name === 'int' || name === 'iint' || name === 'iiint' || name === 'oint') return P(BIG_OPS[name], 'int');
    if (BIG_OPS[name]) return P(BIG_OPS[name], 'big');
    if (ARG_FUNCS.has(name)) return P(name, 'func');
    if (FUNCTIONS.has(name)) return P(name, 'var');
    if (name === 'inf') return P('"inf"', 'var');
    if (GREEK.has(name)) return P(name, 'var');
    if (GREEK_UPPER[name]) return P(GREEK_UPPER[name], 'var');
    if (name === 'cdots' || name === 'dots' || name === 'ldots') return P('CDOTS', 'cdots');
    if (SYMBOLS[name] !== undefined) {
      const v = SYMBOLS[name];
      return P(v, REL.has(v.trim()) ? 'rel' : v.includes('rarrow') ? 'arrow' : 'var');
    }
    if (SPACING[name] !== undefined) return P(SPACING[name], 'space');
    if (name.length === 1) {
      if (name === '}') return P('RBRACE', 'other');
      if (name === '|') return P('||', 'other');
      if (name === '&') return P('"&"', 'other');
      if (name === '#') return P('"#"', 'other');
      if (name === '_') return P('"_"', 'other');
      if (name === ',') return P('`', 'space');
      return P(name, 'other');
    }
    return P(this.quoted(name), 'text');
  }

  delimiter(tk) {
    if (tk === undefined || typeof tk === 'object') return '.';
    if (['(', ')', '[', ']', '|', '.', '/'].includes(tk)) return tk;
    if (tk === '\\{' || tk === '\\lbrace') return '{';
    if (tk === '\\}' || tk === '\\rbrace') return '}';
    if (tk === '\\langle' || tk === '<') return '<';
    if (tk === '\\rangle' || tk === '>') return '>';
    if (tk === '\\lvert' || tk === '\\rvert' || tk === '\\vert') return '|';
    if (tk === '\\|' || tk === '\\Vert' || tk === '\\lVert' || tk === '\\rVert') return '||';
    if (tk === '\\lfloor' || tk === '\\rfloor' || tk === '\\lceil' || tk === '\\rceil') return tk.slice(1);
    return '.';
  }

  leftRight(forcedOpen) {
    const open = forcedOpen || this.delimiter(this.next());
    const inner = this.sequence(new Set(['\\right', '\\right.']));
    let close = '.';
    const tk = this.next();
    if (tk === '\\right') close = this.delimiter(this.next());
    return P(this.leftRightText(open, inner, close), 'paren');
  }

  environment() {
    let name = '';
    if (this.peek() === '{') {
      this.next();
      const ps = [];
      while (this.peek() !== undefined && this.peek() !== '}') {
        const tk = this.next();
        ps.push(typeof tk === 'string' ? tk : '');
      }
      if (this.peek() === '}') this.next();
      name = ps.join('');
    }
    if (name === 'array' && this.peek() === '{') {
      let d = 0;
      do {
        const tk = this.next();
        if (tk === '{') d++;
        else if (tk === '}') d--;
      } while (d > 0 && this.peek() !== undefined);
    }
    const builder = ENVS[name] || 'pile';
    // 행·열 나누기
    const rows = [[]];
    for (;;) {
      const cell = this.sequence(new Set(['&', '\\\\', '\\end']));
      rows[rows.length - 1].push(join(cell));
      const tk = this.next();
      if (tk === undefined) break;
      if (tk === '&') continue;
      if (tk === '\\\\') {
        if (this.peek() === '[') while (this.peek() !== undefined && this.next() !== ']');
        rows.push([]);
        continue;
      }
      if (tk === '\\end') {
        this.argument();
        break;
      }
    }
    const rs = rows.filter((r) => r.some((c) => c.trim()));
    const n = rs.length;
    if (builder === 'cases') {
      // 지침: 줄 앞 `, 식과 조건 사이 &`````, 첫 줄 끝 _{{}_{`}}, 끝 줄 끝 ^{{}^{`}}
      const body = rs
        .map((r, i) => {
          const suf = n === 1 ? '' : i === 0 ? ' _{{}_{`}}' : i === n - 1 ? ' ^{{}^{`}}' : ' _{{}_{`}}^{{}^{`}}';
          const [a, ...rest] = r.map((c) => c.trim());
          return `\`${a}${suf}` + rest.map((c) => `&\`\`\`\`\` ${c}${suf}`).join('');
        })
        .join('#');
      return `{cases{${body}}}`;
    }
    if (builder === 'pmatrix' || builder === 'bmatrix' || builder === 'dmatrix' || builder === 'matrix') {
      const body = rs.map((r) => '`' + r.map((c) => c.trim()).join('&`````````') + '`').join('#');
      return `{${builder}{${body}}}`;
    }
    return `${builder} {${rs.map((r) => r.join(' & ')).join(' # ')}}`;
  }
}

// 문자열 단위 마무리 정리
function finalize(out) {
  return out
    .replace(/\s+/g, ' ')
    .replace(/` rarrow ` /g, '` rarrow ` ')
    .trim();
}

export function latexToHwp(latex) {
  const src = String(latex ?? '')
    .replace(/^\s*\$+|\$+\s*$/g, '')
    .trim();
  if (!src) return '';
  try {
    const out = new Parser(lex(src)).parse();
    return out || '""';
  } catch {
    return `"${src.replace(/"/g, "'")}"`;
  }
}
