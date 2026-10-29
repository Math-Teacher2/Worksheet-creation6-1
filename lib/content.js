// 만들기 설정: AI 생각 깊이, 한 번에 만들 차시 수, 다른 모델 자동 전환
// (무엇을 넣을지·문항 양은 "내 학습지 구성"에서 정합니다)

export const DEFAULT_CONTENT = {
  thinking: 'medium', // AI 생각 깊이: low | medium | high
  perChunk: 1, // 한 번에 만들 차시 수
  fallback: true, // 서버가 바쁘면 다른 모델로 자동 전환
};

export const THINK_LABEL = { low: '빠르게(절약)', medium: '보통', high: '깊게' };

export function normalizeContent(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_CONTENT;
  return {
    thinking: ['low', 'medium', 'high'].includes(s.thinking) ? s.thinking : d.thinking,
    perChunk: [1, 2, 3].includes(Number(s.perChunk)) ? Number(s.perChunk) : d.perChunk,
    fallback: typeof s.fallback === 'boolean' ? s.fallback : d.fallback,
  };
}
