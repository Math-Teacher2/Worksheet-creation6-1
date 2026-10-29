// 학습지 색 테마. 화면 미리보기와 HWPX가 같은 색을 씁니다.
export const THEMES = {
  navy: {
    name: '네이비 · 코랄',
    primary: '#1F3A5F', // 과목 상자, 단원 번호, 핵심 개념 막대
    accent: '#D9534F', // 단원 번호 글자, 차시 상자
    lessonBox: '#E0603F',
    headSoft: '#EAF0F7', // 표 머리 칸
    line: '#B9C4D3',
    exploreSoft: '#F4F7FB',
    conceptSoft: '#E9EFF7',
    conceptBar: '#1F3A5F',
    checkLine: '#9AA9BD',
    strategy: '#A86A12',
    strategySoft: '#FDF5E6',
    problem: '#23786E',
    problemSoft: '#E6F3F0',
    problemLine: '#9CCFC6',
    think: '#D9534F',
    thinkSoft: '#FCEEEA',
    review: '#23786E',
    reviewSoft: '#E8F4F1',
    answer: '#D32F2F',
    muted: '#7D8899',
    text: '#1E1E1E',
  },
  green: {
    name: '그린 · 오렌지',
    primary: '#245B3E',
    accent: '#E07A1F',
    lessonBox: '#E07A1F',
    headSoft: '#EAF4EE',
    line: '#B7CDBF',
    exploreSoft: '#F4F9F5',
    conceptSoft: '#E7F2EA',
    conceptBar: '#245B3E',
    checkLine: '#9DB8A6',
    strategy: '#9A5B0E',
    strategySoft: '#FDF4E6',
    problem: '#1F6E8C',
    problemSoft: '#E5F1F6',
    problemLine: '#9CC5D6',
    think: '#C2452D',
    thinkSoft: '#FBEDE8',
    review: '#1F6E8C',
    reviewSoft: '#E7F1F6',
    answer: '#D32F2F',
    muted: '#7A8A80',
    text: '#1E1E1E',
  },
  purple: {
    name: '퍼플 · 핑크',
    primary: '#46337A',
    accent: '#D6457A',
    lessonBox: '#D6457A',
    headSoft: '#EFEBF8',
    line: '#C4BBDD',
    exploreSoft: '#F7F5FC',
    conceptSoft: '#EEEAF8',
    conceptBar: '#46337A',
    checkLine: '#ABA0CC',
    strategy: '#9A5B0E',
    strategySoft: '#FDF4E6',
    problem: '#2C6E8F',
    problemSoft: '#E6F0F6',
    problemLine: '#A2C4D8',
    think: '#C23B6E',
    thinkSoft: '#FBECF2',
    review: '#2C6E8F',
    reviewSoft: '#E8F1F6',
    answer: '#D32F2F',
    muted: '#857D96',
    text: '#1E1E1E',
  },
  mono: {
    name: '흑백 (인쇄용)',
    primary: '#222222',
    accent: '#222222',
    lessonBox: '#444444',
    headSoft: '#EDEDED',
    line: '#555555',
    exploreSoft: '#FFFFFF',
    conceptSoft: '#F4F4F4',
    conceptBar: '#333333',
    checkLine: '#888888',
    strategy: '#333333',
    strategySoft: '#F7F7F7',
    problem: '#222222',
    problemSoft: '#EDEDED',
    problemLine: '#777777',
    think: '#333333',
    thinkSoft: '#F7F7F7',
    review: '#333333',
    reviewSoft: '#F4F4F4',
    answer: '#D32F2F',
    muted: '#666666',
    text: '#111111',
  },
};

export const DEFAULT_THEME = 'navy';

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
const hex = (c) => {
  const m = String(c || '').trim().match(/^#?([0-9a-f]{6})$/i);
  return m ? m[1] : null;
};
function mix(c1, c2, t) {
  const a = hex(c1) || '000000';
  const b = hex(c2) || 'ffffff';
  const ch = (s, i) => parseInt(s.slice(i, i + 2), 16);
  return '#' + [0, 2, 4].map((i) => clamp(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// 대표색 2개로 테마 전체를 만듭니다 (레이아웃 참고 파일 분석 결과에 사용)
export function paletteFrom(primary, accent, name = '참고 파일 색') {
  const p = hex(primary) ? `#${hex(primary).toUpperCase()}` : '#1F3A5F';
  const a = hex(accent) ? `#${hex(accent).toUpperCase()}` : '#D9534F';
  return {
    name,
    primary: p,
    accent: a,
    lessonBox: a,
    headSoft: mix(p, '#FFFFFF', 0.9),
    line: mix(p, '#FFFFFF', 0.65),
    exploreSoft: mix(p, '#FFFFFF', 0.95),
    conceptSoft: mix(p, '#FFFFFF', 0.9),
    conceptBar: p,
    checkLine: mix(p, '#FFFFFF', 0.5),
    strategy: mix(a, '#000000', 0.25),
    strategySoft: mix(a, '#FFFFFF', 0.92),
    problem: mix(p, a, 0.35),
    problemSoft: mix(p, '#FFFFFF', 0.9),
    problemLine: mix(p, '#FFFFFF', 0.6),
    think: a,
    thinkSoft: mix(a, '#FFFFFF', 0.92),
    review: p,
    reviewSoft: mix(p, '#FFFFFF', 0.92),
    answer: '#D32F2F',
    muted: '#7D8899',
    text: '#1E1E1E',
  };
}

export function getTheme(id, custom) {
  if (id === 'custom' && custom) return custom;
  return THEMES[id] || THEMES[DEFAULT_THEME];
}
