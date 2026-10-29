// AI 호출 오류를 종류별로 나누고, 교사가 이해할 수 있는 말로 이유와 해결 방법을 설명합니다.

export class LlmError extends Error {
  constructor(kind, { status = 0, raw = '', retryAfter = 0, quota = '', partial = '', model = '', provider = '' } = {}) {
    super(explainKind(kind, { status, quota, model }).title);
    this.kind = kind;
    this.status = status;
    this.raw = String(raw || '').slice(0, 2000);
    this.retryAfter = retryAfter;
    this.quota = quota;
    this.partial = partial;
    this.model = model;
    this.provider = provider;
  }
}

// 상태 코드·메시지로 오류 종류 판단
export function classify(status, msg) {
  const m = String(msg || '').toLowerCase();
  if (status === 401 || /api key not valid|api_key_invalid|invalid.*api.?key|incorrect api key|invalid x-api-key|authentication_error|api key expired/.test(m)) return 'key';
  // 주의: Gemini 한도 초과 메시지에도 "plan and billing details"라는 말이 들어 있으므로 billing 단어만으로 판단하지 않음
  if (status === 402 || /insufficient_quota|credit balance is too low|payment required|billing_hard_limit/.test(m)) return 'billing';
  if (/user location is not supported|location is not supported|unsupported_country|not available in your country/.test(m)) return 'region';
  if (status === 403) return 'permission';
  if (status === 404) return 'model';
  if (status === 429) return /per ?day|perday|daily|requests per day/.test(m) ? 'quota-day' : 'quota-minute';
  if (status === 413) return 'too-large';
  if (status === 400 && /too large|exceeds|maximum|token count|context length|context window|too many (images|pages)|payload size|prompt is too long/.test(m)) return 'too-large';
  if (status === 400) return 'bad-request';
  if (status === 503 || status === 529 || /overloaded|unavailable|high demand/.test(m)) return 'overloaded';
  if (status === 504 || /deadline exceeded|timed? ?out/.test(m)) return 'timeout';
  if (status >= 500) return 'server';
  return 'unknown';
}

// 재시도 대기(초). null이면 그 오류는 자동 재시도하지 않음
export const RETRY_PLAN = {
  overloaded: [10, 25, 50],
  server: [5, 15, 30],
  timeout: [5, 20],
  'timeout-idle': [3, 10],
  network: [5, 15, 30],
  'quota-minute': [35, 65],
  'stream-cut': [5, 15],
  empty: [5],
};

export function explainKind(kind, { status = 0, quota = '', model = '', seconds = 0 } = {}) {
  const code = status ? ` (${status})` : '';
  switch (kind) {
    case 'key':
      return {
        title: `API 키 오류${code}`,
        why: '입력한 API 키가 올바르지 않거나 만료되었습니다. 다른 AI 회사의 키를 넣었거나, 복사할 때 앞뒤 글자가 빠져도 이렇게 됩니다.',
        fix: '키 발급 페이지에서 키를 다시 복사해 붙여 넣은 뒤 [이어서 만들기]를 눌러 주세요.',
      };
    case 'billing':
      return {
        title: `결제·잔액 문제${code}`,
        why: '유료 API의 잔액(크레딧)이 없거나 결제 수단이 등록되어 있지 않습니다.',
        fix: '해당 AI 회사 콘솔에서 결제 상태와 잔액을 확인해 주세요. 무료로 쓰려면 Google Gemini를 고르세요.',
      };
    case 'region':
      return {
        title: `지역 제한${code}`,
        why: '지금 접속한 지역(네트워크)에서는 이 AI 서비스를 쓸 수 없다고 응답했습니다.',
        fix: '다른 네트워크에서 시도하거나, 고급 설정의 "서버 경유 연결"을 켜 보세요.',
      };
    case 'permission':
      return {
        title: `권한 없음${code}`,
        why: `이 키(프로젝트)로는 ${model || '이 모델'}을(를) 쓸 권한이 없습니다. API 사용 설정이 꺼져 있거나 조직 정책으로 막혀 있을 수 있습니다.`,
        fix: '키를 만든 콘솔에서 API 사용 설정을 확인하거나, 모델 목록에서 다른 모델을 골라 주세요.',
      };
    case 'model':
      return {
        title: `모델을 찾을 수 없음${code}`,
        why: `모델 이름(${model || '?'})이 틀렸거나, 이 키로는 쓸 수 없거나, 서비스가 끝난 모델입니다.`,
        fix: '모델 목록에서 다른 모델을 고른 뒤 [이어서 만들기]를 눌러 주세요. 끝난 차시는 그대로 남습니다.',
      };
    case 'quota-minute':
      return {
        title: `분당 사용 한도 초과${code}`,
        why: '짧은 시간에 요청이나 글자(토큰)를 너무 많이 보냈습니다. 무료 등급은 1분에 보낼 수 있는 요청 수와 토큰 수가 정해져 있습니다.',
        fix: '보통 1분 안에 풀립니다. 앱이 기다렸다가 자동으로 다시 시도합니다. 자주 생기면 "한 번에 만들 차시 수"를 1로 두세요.',
      };
    case 'quota-day':
      return {
        title: `오늘 사용 한도 초과${code}`,
        why: `이 키의 오늘 무료 사용량(하루 요청 수)을 다 썼습니다${quota ? ` [${quota}]` : ''}. Gemini 무료 한도는 미국 태평양 시각 자정(한국 시각 오후 4~5시)에 초기화되고, 모델마다 따로 계산됩니다.`,
        fix: '한도가 초기화된 뒤 [이어서 만들기]를 누르면 끝난 차시는 그대로 두고 남은 차시만 만듭니다. 지금 계속하려면 모델을 바꿔 보세요(다른 모델은 한도가 따로입니다). "문제·정답 검산"을 끄면 요청 수가 절반으로 줄어듭니다.',
      };
    case 'too-large':
      return {
        title: `보낸 자료가 너무 큼${code}`,
        why: '한 번에 보낸 페이지 이미지와 글자의 양이 이 모델의 입력 한도를 넘었습니다.',
        fix: '"한 번에 만들 차시 수"를 1로 줄이거나 지도서 쪽 범위를 줄여 주세요.',
      };
    case 'bad-request':
      return {
        title: `요청 형식 오류${code}`,
        why: '모델이 요청의 일부 설정(생각 깊이, 이미지 해상도, JSON 출력 등)을 받아들이지 않았습니다. 앱이 설정을 하나씩 빼며 다시 시도했지만 실패했습니다.',
        fix: '모델 목록에서 다른 모델을 골라 보세요. 아래 "자세히"의 원문 메시지를 알려 주시면 고칠 수 있습니다.',
      };
    case 'overloaded':
      return {
        title: `AI 서버가 바쁨${code || ' (503)'}`,
        why: 'AI 회사 서버에 요청이 몰려 지금은 처리하지 못한다는 응답입니다. 키나 학습지 내용의 문제가 아니며, 새로 나온 모델일수록 자주 생깁니다.',
        fix: '앱이 10초·25초·50초 간격으로 다시 시도하고, "다른 모델로 자동 전환"이 켜져 있으면 같은 회사의 다른 모델로 이어 갑니다. 그래도 안 되면 몇 분 뒤 [이어서 만들기]를 눌러 주세요.',
      };
    case 'server':
      return {
        title: `AI 서버 내부 오류${code}`,
        why: 'AI 회사 서버에서 일시적인 오류가 났습니다. 요청이 너무 길거나 복잡할 때도 가끔 생깁니다.',
        fix: '앱이 자동으로 다시 시도합니다. 계속되면 "AI 생각 깊이"를 낮추거나 잠시 뒤 [이어서 만들기]를 눌러 주세요.',
      };
    case 'timeout':
      return {
        title: `응답 시간 초과${code}`,
        why: 'AI가 정해진 시간 안에 답을 끝내지 못했습니다. 한 번에 처리할 양이 많거나 생각 깊이가 깊을 때 생깁니다.',
        fix: '"AI 생각 깊이"를 낮추거나 "한 번에 만들 차시 수"를 1로 줄여 주세요.',
      };
    case 'timeout-idle':
      return {
        title: '응답이 멈춤',
        why: `AI 서버에서 ${seconds || '한참'}초 넘게 아무 응답이 오지 않아 연결을 끊었습니다. 서버가 바쁘거나 네트워크가 불안정할 때 생깁니다.`,
        fix: '앱이 자동으로 다시 시도합니다.',
      };
    case 'network':
      return {
        title: '네트워크 연결 실패',
        why: '인터넷 연결이 끊겼거나, 학교·회사 보안 프로그램(방화벽)이 AI 서버 연결을 막았습니다. 노트북이 잠자기 모드로 들어가거나 탭이 오래 숨겨져 있어도 생깁니다.',
        fix: '연결을 확인하고 [이어서 만들기]를 누르세요. 계속되면 고급 설정의 "서버 경유 연결"을 켜 보세요.',
      };
    case 'stream-cut':
      return {
        title: '응답이 중간에 끊김',
        why: 'AI가 결과를 보내는 도중 연결이 끊겨 끝부분을 받지 못했습니다.',
        fix: '앱이 자동으로 다시 시도합니다.',
      };
    case 'max-tokens':
      return {
        title: '출력 길이 한도 초과',
        why: 'AI가 한 번에 쓸 수 있는 분량(출력 토큰)을 넘어 결과가 잘렸습니다. 내용이 많은 차시를 한꺼번에 만들 때 생깁니다.',
        fix: '앱이 더 간결하게 다시 만들도록 한 번 더 시도합니다. 계속되면 개념 설명을 "보통"으로, 문제를 "일부"로 바꿔 보세요.',
      };
    case 'recitation':
      return {
        title: '출판물 반복 차단 (RECITATION)',
        why: 'Gemini는 출판된 글을 길게 그대로 옮겨 쓰면 저작권 보호를 위해 답을 중간에 멈춥니다. 교과서 문장을 그대로 옮기다가 걸린 것입니다.',
        fix: '앱이 개념 설명을 학습지 문체로 바꿔 쓰게 해서 한 번 더 시도합니다(문제의 수식·조건은 그대로). 같은 차시에서 계속되면 Claude 등 다른 AI를 써 보세요.',
      };
    case 'safety':
      return {
        title: '안전 필터에 걸림',
        why: 'AI 회사의 안전 필터가 결과를 막았습니다. 교과서 내용과 상관없이 드물게 오작동하기도 합니다.',
        fix: '앱이 한 번 더 시도합니다. 같은 차시에서 계속되면 다른 모델을 써 보세요.',
      };
    case 'blocked-input':
      return {
        title: '입력 자료가 차단됨',
        why: 'AI 회사가 보낸 자료(이미지·글자)를 처리하지 않겠다고 응답했습니다.',
        fix: '해당 차시의 쪽 범위를 바꾸거나 다른 AI를 써 보세요.',
      };
    case 'empty':
      return {
        title: '빈 응답',
        why: 'AI가 아무 내용도 보내지 않았습니다. 서버가 바쁠 때 가끔 생깁니다.',
        fix: '앱이 자동으로 다시 시도합니다.',
      };
    case 'parse':
      return {
        title: '결과 해석 실패',
        why: 'AI가 보낸 결과가 정해진 형식(JSON)이 아니거나 중간이 깨져 있었습니다.',
        fix: '앱이 한 번 더 시도합니다. 계속되면 다른 모델을 써 보세요.',
      };
    case 'no-key':
      return { title: 'API 키가 없습니다', why: '선택한 AI 회사의 API 키가 입력되지 않았습니다.', fix: '① AI 선택에서 키를 입력해 주세요.' };
    case 'aborted':
      return { title: '중단했습니다', why: '중단 버튼을 눌러 작업을 멈췄습니다.', fix: '[이어서 만들기]를 누르면 끝난 차시는 두고 남은 차시만 만듭니다.' };
    default:
      return {
        title: `알 수 없는 오류${code}`,
        why: '예상하지 못한 오류가 났습니다.',
        fix: '잠시 뒤 [이어서 만들기]를 눌러 보세요. 계속되면 아래 "자세히"의 원문 메시지를 알려 주세요.',
      };
  }
}

// 어떤 오류든 화면에 보일 설명으로
export function explainError(e) {
  if (!e) return null;
  if (e.name === 'AbortError') return { kind: 'aborted', ...explainKind('aborted') };
  if (e instanceof LlmError || e.kind) {
    const x = explainKind(e.kind, { status: e.status, quota: e.quota, model: e.model, seconds: e.seconds });
    const raw = [e.model ? `모델: ${e.model}` : '', e.status ? `상태 코드: ${e.status}` : '', e.raw || ''].filter(Boolean).join('\n');
    return { kind: e.kind, ...x, raw };
  }
  return { kind: 'unknown', title: e.message || String(e), why: '', fix: '', raw: e.stack ? String(e.stack).slice(0, 800) : '' };
}

// 이 오류가 나면 다음 차시도 실패할 가능성이 큼 → 작업을 멈춤
export const STOP_KINDS = new Set(['key', 'billing', 'region', 'permission', 'model', 'quota-day', 'quota-minute', 'overloaded', 'server', 'network', 'timeout', 'timeout-idle', 'no-key', 'aborted', 'bad-request']);
