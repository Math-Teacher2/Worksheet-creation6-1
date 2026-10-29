'use client';

// 문서 모델을 화면에 그대로 그림 (HWPX와 같은 표·쪽 구성)
import { Fragment } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { PAGE, TABLE_GAP } from '../lib/compose';
import { blankWidth, STUDENT_BLANK_SIZE } from '../lib/measure';

const toMM = (v) => `${(v / 283.4646).toFixed(2)}mm`;
const toPt = (v) => `${(v / 100).toFixed(1)}pt`;
const FONT = {
  batang: "'함초롬바탕','HCR Batang','Noto Serif KR','Batang',serif",
  dotum: "'함초롬돋움','HCR Dotum','Pretendard','Malgun Gothic','Noto Sans KR',sans-serif",
};

const mathCache = new Map();
function mathHtml(src) {
  if (mathCache.has(src)) return mathCache.get(src);
  let html;
  try {
    html = katex.renderToString(src, { throwOnError: false, strict: 'ignore', output: 'html' });
  } catch {
    html = String(src).replace(/[<>&]/g, '');
  }
  if (mathCache.size > 4000) mathCache.clear();
  mathCache.set(src, html);
  return html;
}

function border(b) {
  if (!b) return 'none';
  const w = parseFloat(b.width) || 0.12;
  const style = b.type === 'DASH' ? 'dashed' : b.type === 'DOT' ? 'dotted' : 'solid';
  return `${Math.max(0.12, w)}mm ${style} ${b.color}`;
}

function Para({ p, ctx }) {
  return (
    <p
      className="mp"
      style={{
        textAlign: p.align === 'JUSTIFY' ? 'justify' : p.align.toLowerCase(),
        fontSize: toPt(p.size),
        lineHeight: (p.line || 160) / 100,
        color: p.color,
        fontWeight: p.bold ? 700 : 400,
        fontFamily: FONT[p.font] || FONT.batang,
        marginTop: p.prev ? toMM(p.prev) : 0,
        marginBottom: p.next ? toMM(p.next) : 0,
        paddingLeft: p.left ? toMM(p.left) : 0,
      }}
    >
      {p.nodes.length ? p.nodes.map((n, i) => <Node key={i} n={n} p={p} ctx={ctx} />) : ' '}
    </p>
  );
}

function Node({ n, p, ctx }) {
  const size = n.size || p.size;
  if (n.t === 'text' || n.t === 'hint') {
    const st = {};
    if (n.size) st.fontSize = toPt(n.size);
    if (n.color) st.color = n.color;
    if (n.b) st.fontWeight = 700;
    if (n.font) st.fontFamily = FONT[n.font];
    return Object.keys(st).length ? <span style={st}>{n.v}</span> : <Fragment>{n.v}</Fragment>;
  }
  if (n.t === 'math') return <span className="m" style={n.color || n.size ? { ...(n.color ? { color: n.color } : {}), ...(n.size ? { fontSize: toPt(n.size) } : {}) } : undefined} dangerouslySetInnerHTML={{ __html: mathHtml(n.v) }} />;
  if (n.t === 'blank') {
    const w = blankWidth(n, size, { teacher: ctx.teacher });
    return (
      <span className={`blank ${ctx.teacher ? 'filled' : ''}`} style={{ minWidth: toMM(w), fontSize: toPt(ctx.teacher ? size : size * STUDENT_BLANK_SIZE) }}>
        {ctx.teacher ? n.ans.map((a, i) => (a.t === 'math' ? <span key={i} dangerouslySetInnerHTML={{ __html: mathHtml(a.v) }} /> : <Fragment key={i}>{a.v}</Fragment>)) : ' '}
      </span>
    );
  }
  if (n.t === 'gap') return <span style={{ display: 'inline-block', width: toMM(n.w || size) }} />;
  if (n.t === 'img') {
    const f = ctx.figs[n.id];
    if (!f) return null;
    return (
      <span className="fig" style={{ width: toMM(n.w), height: toMM(n.h) }}>
        <img src={f.dataUrl} alt={f.desc || '교과서 그림'} />
        {ctx.onEditFigure ? (
          <span className="fig-tools no-print">
            <button type="button" onClick={() => ctx.onEditFigure(n.id)}>
              ✂ 위치 조정
            </button>
            <button type="button" onClick={() => ctx.onRemoveFigure(n.id)}>
              삭제
            </button>
          </span>
        ) : null}
      </span>
    );
  }
  if (n.t === 'tbl') return <Table t={n.table} ctx={ctx} inline />;
  return null;
}

function Table({ t, ctx, inline }) {
  const total = t.widths.reduce((a, b) => a + b, 0);
  return (
    <table className={`mt ${inline ? 'inline' : ''}`} style={{ width: toMM(total) }}>
      <colgroup>
        {t.widths.map((w, i) => (
          <col key={i} style={{ width: toMM(w) }} />
        ))}
      </colgroup>
      <tbody>
        {t.rows.map((r) => (
          <tr key={r.id} style={{ height: toMM(r.h ?? r.h0 ?? r.minH ?? 0) }}>
            {r.cells.map((c, ci) => (
              <td
                key={ci}
                colSpan={c.cs > 1 ? c.cs : undefined}
                rowSpan={c.rs > 1 ? c.rs : undefined}
                style={{
                  background: c.fill || 'transparent',
                  borderLeft: border(c.b.l),
                  borderRight: border(c.b.r),
                  borderTop: border(c.b.t),
                  borderBottom: border(c.b.b),
                  padding: `${toMM(c.m[2])} ${toMM(c.m[1])} ${toMM(c.m[3])} ${toMM(c.m[0])}`,
                  verticalAlign: c.v === 'CENTER' ? 'middle' : c.v === 'BOTTOM' ? 'bottom' : 'top',
                }}
              >
                {c.tool?.path && ctx.onAddFigure ? (
                  <button type="button" className="add-fig no-print" onClick={() => ctx.onAddFigure(c.tool.path)} title="교과서에서 그림을 골라 이 칸에 넣습니다">
                    + 그림
                  </button>
                ) : null}
                {c.paras.map((p, pi) => (
                  <Para key={pi} p={p} ctx={ctx} />
                ))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ModelView({ laid, teacher = false, figs = {}, onEditFigure, onRemoveFigure, onAddFigure }) {
  const ctx = { teacher, figs, onEditFigure, onRemoveFigure, onAddFigure };
  let pageNo = 0;
  return (
    <div className="mdoc">
      {laid.lessons.map((L, li) => {
        const pages = teacher ? L.teacher : L.student;
        return pages.map((tables, pi) => {
          pageNo++;
          return (
            <section
              key={`${li}-${pi}`}
              className="mpage"
              style={{ padding: `${toMM(PAGE.MT)} ${toMM(PAGE.MR)} ${toMM(PAGE.MB + PAGE.FOOT)} ${toMM(PAGE.ML)}` }}
            >
              <div className="mbody" style={{ height: toMM(PAGE.BODY_H) }}>
                {tables.map((t, ti) => (
                  <div key={t.id || ti} style={{ marginBottom: ti < tables.length - 1 ? toMM(TABLE_GAP) : 0 }}>
                    <Table t={t} ctx={ctx} />
                  </div>
                ))}
              </div>
              <div className="mfoot no-print-hide">- {pageNo} -</div>
            </section>
          );
        });
      })}
    </div>
  );
}
