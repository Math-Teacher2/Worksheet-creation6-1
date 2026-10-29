// 학습지 레이아웃 5종. 같은 내용을 서로 다른 모양으로 짜는 규칙입니다.
// header : 머리 표 모양      banner | band | titleline | exam
// section: 주제 제목 줄 모양  numbox | tab | label | band | underline
// box    : 활동 칸 모양      bar | fill | plain | outline | dashed
// problem: 문제 칸 모양      head | number | exam
// font   : 본문 글꼴         batang | dotum

export const LAYOUTS = {
  block: {
    name: '컬러 블록형',
    desc: '색 막대와 머리 띠로 활동을 구분하는 교과서식 학습지',
    header: 'banner',
    section: 'numbox',
    box: 'bar',
    problem: 'head',
    font: 'batang',
    palette: 'navy',
  },
  tab: {
    name: '개념서 탭형',
    desc: '주제마다 색 탭을 달고 개념을 면으로 강조하는 참고서식',
    header: 'band',
    section: 'tab',
    box: 'fill',
    problem: 'number',
    font: 'batang',
    palette: 'green',
  },
  cornell: {
    name: '코넬 노트형',
    desc: '왼쪽 좁은 칸에 활동 이름을 두고 오른쪽에 내용을 쓰는 노트식',
    header: 'titleline',
    section: 'label',
    box: 'plain',
    problem: 'number',
    font: 'batang',
    palette: 'purple',
  },
  exam: {
    name: '시험지형 (흑백)',
    desc: '학교 평가지처럼 표 머리와 회색 띠로 구성, 흑백 인쇄에 강함',
    header: 'exam',
    section: 'band',
    box: 'outline',
    problem: 'exam',
    font: 'batang',
    palette: 'mono',
  },
  minimal: {
    name: '미니멀 라인형',
    desc: '가는 선과 여백 위주의 깔끔한 돋움체 활동지',
    header: 'titleline',
    section: 'underline',
    box: 'dashed',
    problem: 'number',
    font: 'dotum',
    palette: 'navy',
  },
};

export const DEFAULT_LAYOUT = 'block';

const OPTIONS = {
  header: ['banner', 'band', 'titleline', 'exam'],
  section: ['numbox', 'tab', 'label', 'band', 'underline'],
  box: ['bar', 'fill', 'plain', 'outline', 'dashed'],
  problem: ['head', 'number', 'exam'],
  font: ['batang', 'dotum'],
};

// AI가 분석한 레이아웃(또는 사용자 설정)을 안전한 값으로 정리
export function normalizeLayout(raw, fallback = DEFAULT_LAYOUT) {
  const base = LAYOUTS[raw?.base] || LAYOUTS[fallback] || LAYOUTS.block;
  const out = { ...base };
  for (const [k, opts] of Object.entries(OPTIONS)) {
    if (raw && opts.includes(raw[k])) out[k] = raw[k];
  }
  if (raw?.name) out.name = String(raw.name).slice(0, 30);
  if (raw?.desc) out.desc = String(raw.desc).slice(0, 80);
  return out;
}

export function getLayout(id, custom) {
  if (id === 'custom' && custom) return custom;
  return LAYOUTS[id] || LAYOUTS[DEFAULT_LAYOUT];
}
