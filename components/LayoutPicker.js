'use client';

// 레이아웃 5종(+참고 파일로 만든 레이아웃) 고르기. 작은 미리보기 그림을 함께 보여 줌
import { LAYOUTS } from '../lib/layouts';
import { getTheme } from '../lib/themes';

function Thumb({ L, th }) {
  const W = 120;
  const H = 84;
  const els = [];
  const line = th.line;
  // 머리
  if (L.header === 'banner') {
    els.push(<rect key="h1" x="6" y="5" width="20" height="10" fill={th.primary} />, <rect key="h2" x="26" y="5" width="74" height="10" fill="#fff" stroke={th.primary} strokeWidth="0.8" />, <rect key="h3" x="100" y="5" width="14" height="10" fill={th.lessonBox} />, <rect key="h4" x="6" y="15" width="108" height="5" fill="#fff" stroke={line} strokeWidth="0.5" />);
  } else if (L.header === 'band') {
    els.push(<rect key="h1" x="6" y="5" width="94" height="10" fill={th.primary} />, <rect key="h3" x="100" y="5" width="14" height="10" fill={th.lessonBox} />, <rect key="h4" x="6" y="15" width="108" height="5" fill={th.headSoft} />);
  } else if (L.header === 'titleline') {
    els.push(<rect key="h1" x="6" y="7" width="40" height="5" fill={th.text} opacity="0.8" />, <line key="h2" x1="6" y1="14" x2="114" y2="14" stroke={th.primary} strokeWidth="1.4" />, <line key="h4" x1="6" y1="19" x2="114" y2="19" stroke={line} strokeWidth="0.5" strokeDasharray="1.5 1" />);
  } else {
    els.push(<rect key="h1" x="6" y="5" width="108" height="15" fill="#fff" stroke="#333" strokeWidth="0.6" />, <line key="h2" x1="6" y1="12.5" x2="114" y2="12.5" stroke="#333" strokeWidth="0.5" />, ...[30, 42, 66, 78, 100].map((x) => <line key={`v${x}`} x1={x} y1="5" x2={x} y2="20" stroke="#333" strokeWidth="0.5" />));
  }
  // 주제 제목
  const y0 = 25;
  if (L.section === 'numbox') els.push(<rect key="s1" x="6" y={y0} width="5" height="5" fill={th.primary} />, <line key="s2" x1="6" y1={y0 + 5} x2="114" y2={y0 + 5} stroke={th.primary} strokeWidth="0.8" />);
  else if (L.section === 'tab') els.push(<rect key="s1" x="6" y={y0} width="34" height="5" fill={th.primary} />, <line key="s2" x1="6" y1={y0 + 5} x2="114" y2={y0 + 5} stroke={th.primary} strokeWidth="0.8" />);
  else if (L.section === 'label') els.push(<line key="s2" x1="6" y1={y0 + 5} x2="114" y2={y0 + 5} stroke={th.primary} strokeWidth="1" />, <line key="s3" x1="22" y1={y0 + 5} x2="22" y2="80" stroke={line} strokeWidth="0.5" />);
  else if (L.section === 'band') els.push(<rect key="s1" x="6" y={y0} width="108" height="5" fill={th.headSoft} stroke={th.primary} strokeWidth="0.3" />);
  else els.push(<line key="s2" x1="6" y1={y0 + 5} x2="114" y2={y0 + 5} stroke={th.primary} strokeWidth="0.5" />);
  // 활동 칸 3개
  const x = L.section === 'label' ? 24 : 6;
  const w = 114 - x;
  [
    [33, 13, th.conceptBar, th.conceptSoft],
    [48, 10, th.strategy, th.strategySoft],
    [60, 19, th.problem, th.problemSoft],
  ].forEach(([y, h, c, soft], i) => {
    const k = `b${i}`;
    if (L.box === 'bar') els.push(<rect key={k} x={x} y={y} width={w} height={h} fill={soft} />, <rect key={`${k}b`} x={x} y={y} width="1.6" height={h} fill={c} />);
    else if (L.box === 'fill') els.push(<rect key={k} x={x} y={y} width={w} height={h} fill={soft} rx="1.5" />);
    else if (L.box === 'plain') els.push(<line key={k} x1={x} y1={y + h} x2="114" y2={y + h} stroke={line} strokeWidth="0.5" />);
    else if (L.box === 'outline') els.push(<rect key={k} x={x} y={y} width={w} height={h} fill="#fff" stroke={line} strokeWidth="0.6" />);
    else els.push(<rect key={k} x={x} y={y} width={w} height={h} fill="#fff" stroke={line} strokeWidth="0.6" strokeDasharray="2 1.2" />);
    els.push(<rect key={`${k}t`} x={x + 3} y={y + 2} width="18" height="2" fill={c} opacity="0.9" />, <rect key={`${k}l`} x={x + 3} y={y + 6} width={w - 10} height="1.4" fill="#c7ccd6" />);
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} fill="#fff" stroke="#e2e6ee" />
      {els}
    </svg>
  );
}

export default function LayoutPicker({ value, onChange, custom, customTheme }) {
  const items = Object.entries(LAYOUTS);
  return (
    <div className="layout-grid">
      {items.map(([id, L]) => (
        <button key={id} type="button" className={`layout-card ${value === id ? 'on' : ''}`} onClick={() => onChange(id)} title={L.desc}>
          <Thumb L={L} th={getTheme(L.palette)} />
          <b>{L.name}</b>
          <span>{L.desc}</span>
        </button>
      ))}
      {custom ? (
        <button type="button" className={`layout-card ${value === 'custom' ? 'on' : ''}`} onClick={() => onChange('custom')} title={custom.desc}>
          <Thumb L={custom} th={customTheme || getTheme(custom.palette)} />
          <b>{custom.name || '참고 파일 레이아웃'}</b>
          <span>{custom.desc || '올린 파일을 분석해 만든 레이아웃'}</span>
        </button>
      ) : null}
    </div>
  );
}
