// 여러 AI 제공사(Gemini, Claude, OpenAI, OpenAI 호환)를 브라우저에서 직접 호출합니다.
// 키는 사용자의 브라우저에서 각 제공사로만 전송됩니다. (선택: 서버 경유 모드)
import { LlmError, classify, RETRY_PLAN, explainKind } from './errors';

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    note: '무료 사용량이 있습니다.',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza...',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (추천·무료)', group: 'Flash' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (무료)', group: 'Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (무료·빠름)', group: 'Flash-Lite' },
      { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (무료)', group: 'Flash-Lite' },
      { id: 'gemini-4-argon', label: 'Gemini 4 Argon (유료·최고 성능)', group: 'Pro (유료)' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro 미리보기 (유료)', group: 'Pro (유료)' },
    ],
    defaultModel: 'gemini-3.8-flash',
    nativeBoxes: true,
    imageWidth: 1400,
  },
  anthropic: {
    label: 'Anthropic Claude',
    note: '유료(사용한 만큼 과금)입니다.',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyHint: 'sk-ant-...',
    models: [
      { id: 'claude-opus-5-5', label: 'Opus 5.5 (최고 품질)', group: 'Opus' },
      { id: 'claude-opus-5', label: 'Opus 5', group: 'Opus' },
      { id: 'claude-opus-4-8', label: 'Opus 4.8', group: 'Opus' },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (추천)', group: 'Sonnet' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5', group: 'Sonnet' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', group: 'Sonnet' },
      { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (빠르고 저렴)', group: 'Haiku' },
      { id: 'claude-fable-5-1', label: 'Fable 5.1', group: 'Fable' },
      { id: 'claude-fable-5', label: 'Fable 5', group: 'Fable' },
    ],
    defaultModel: 'claude-sonnet-5-5',
    imageWidth: 1150,
  },
  openai: {
    label: 'OpenAI',
    note: '유료(사용한 만큼 과금)입니다.',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-...',
    models: [
      { id: 'gpt-6-astra', label: 'GPT-6 Astra (최고 성능)', group: 'GPT-6' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol (추천)', group: 'GPT-6' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra (빠름)', group: 'GPT-6' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna (저렴)', group: 'GPT-6' },
    ],
    defaultModel: 'gpt-6.1-sol',
    imageWidth: 1300,
  },
  compat: {
    label: 'OpenAI 호환 (OpenRouter 등)',
    note: '주소와 모델 이름을 직접 입력합니다. 이미지 입력을 지원하는 모델이어야 합니다.',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-...',
    models: [],
    defaultModel: '',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    imageWidth: 1200,
  },
};


export { LlmError };

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        },
        { once: true }
      );
  });

// 응답이 이만큼 오지 않으면 끊고 다시 시도
const FIRST_IDLE_MS = 300_000;
const NEXT_IDLE_MS = 150_000;

// SSE 버퍼에서 완결된 이벤트(data 줄)들을 꺼냄
export function parseSse(buffer) {
  const events = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop();
  for (const block of blocks) {
    let ev = '';
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) continue;
    const payload = data.join('\n');
    if (payload === '[DONE]') {
      events.push({ event: ev, done: true });
      continue;
    }
    try {
      events.push({ event: ev, json: JSON.parse(payload) });
    } catch {
      /* 깨진 조각 무시 */
    }
  }
  return { events, rest };
}

// 오류 원문에서 재시도 대기 시간·한도 이름을 읽음 (Gemini의 RetryInfo/QuotaFailure)
function errorExtras(raw) {
  const s = String(raw || '');
  const out = { retryAfter: 0, quota: '' };
  const m = s.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (m) out.retryAfter = Math.ceil(parseFloat(m[1]) * 1000);
  const q = s.match(/"quotaId"\s*:\s*"([^"]+)"/);
  const v = s.match(/"quotaValue"\s*:\s*"?(\d+)/);
  if (q) out.quota = `${q[1]}${v ? ` = ${v[1]}` : ''}`;
  return out;
}

function makeError(provider, model, status, message, raw) {
  const kind = classify(status, `${message} ${raw || ''}`);
  const ex = errorExtras(raw);
  return new LlmError(kind, { status, raw: raw || message, model, provider, retryAfter: ex.retryAfter, quota: ex.quota });
}

// ----- 제공사별 요청 만들기 -----
const GEMINI_RES = { low: 'media_resolution_low', medium: 'media_resolution_medium', high: 'media_resolution_high' };

function buildRequest(o) {
  const { provider, model, apiKey, system, parts, json, maxTokens, baseUrl, opts } = o;
  const thinking = opts.thinking || 'medium';
  if (provider === 'gemini') {
    const contents = [
      {
        role: 'user',
        parts: parts.map((p) => {
          if (p.type !== 'image') return { text: p.text };
          const part = { inlineData: { mimeType: p.mime, data: p.data } };
          if (p.res && !opts.noMediaRes) part.mediaResolution = { level: GEMINI_RES[p.res] || GEMINI_RES.high };
          return part;
        }),
      },
    ];
    const generationConfig = { maxOutputTokens: opts.maxTokens ?? maxTokens };
    if (json && !opts.noJsonMode) generationConfig.responseMimeType = 'application/json';
    if (!opts.noThinking) generationConfig.thinkingConfig = { thinkingLevel: thinking };
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig },
    };
  }
  if (provider === 'anthropic') {
    const content = parts.map((p) =>
      p.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } } : { type: 'text', text: p.text }
    );
    const body = { model, max_tokens: opts.maxTokens ?? maxTokens, system, messages: [{ role: 'user', content }], stream: true };
    if (!opts.noThinking) {
      body.thinking = { type: 'adaptive' };
      body.output_config = { effort: thinking };
    }
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body,
    };
  }
  // openai / compat (Chat Completions)
  const content = parts.map((p) =>
    p.type === 'image'
      ? { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}`, detail: p.res === 'low' ? 'low' : 'high' } }
      : { type: 'text', text: p.text }
  );
  const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content }], stream: true };
  const isOpenAI = provider === 'openai';
  if (isOpenAI && !opts.legacyMax) body.max_completion_tokens = opts.maxTokens ?? maxTokens;
  else body.max_tokens = opts.maxTokens ?? maxTokens;
  if (json && !opts.noJsonMode) body.response_format = { type: 'json_object' };
  if (isOpenAI && !opts.noThinking) body.reasoning_effort = thinking;
  if (!opts.noUsage) body.stream_options = { include_usage: true };
  const base = (baseUrl || PROVIDERS.compat.defaultBaseUrl).replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  if (!isOpenAI && /openrouter\.ai/.test(base)) {
    headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://localhost';
    headers['X-Title'] = 'Worksheet Generator';
  }
  return { url: isOpenAI ? 'https://api.openai.com/v1/chat/completions' : `${base}/chat/completions`, headers, body };
}

// 이벤트 하나에서 글자/종료 사유/사용량 추출
function readEvent(provider, ev, state) {
  const j = ev.json;
  if (!j) return;
  if (j.proxyError) throw makeError(provider, state.model, j.proxyError.status || 500, j.proxyError.message || '', JSON.stringify(j.proxyError));
  if (provider === 'gemini') {
    if (j.error) throw makeError(provider, state.model, j.error.code || 500, j.error.message || '', JSON.stringify(j.error));
    const cand = j.candidates?.[0];
    const piece = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    if (piece) state.text += piece;
    if (cand?.finishReason) state.finish = cand.finishReason;
    if (j.promptFeedback?.blockReason) state.block = j.promptFeedback.blockReason;
    const u = j.usageMetadata;
    if (u) state.usage = { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), thinking: u.thoughtsTokenCount || 0 };
    return;
  }
  if (provider === 'anthropic') {
    if (j.type === 'error') {
      const t = j.error?.type || '';
      const status = t === 'overloaded_error' ? 529 : t === 'rate_limit_error' ? 429 : t === 'authentication_error' ? 401 : t === 'invalid_request_error' ? 400 : 500;
      throw makeError(provider, state.model, status, j.error?.message || '', JSON.stringify(j.error));
    }
    if (j.type === 'message_start' && j.message?.usage) {
      const u = j.message.usage;
      state.usage.input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    }
    if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') state.text += j.delta.text || '';
    if (j.type === 'message_delta') {
      if (j.delta?.stop_reason) state.finish = j.delta.stop_reason === 'max_tokens' ? 'MAX_TOKENS' : j.delta.stop_reason === 'refusal' ? 'SAFETY' : j.delta.stop_reason;
      if (j.usage?.output_tokens) state.usage.output = j.usage.output_tokens;
    }
    return;
  }
  if (j.error) throw makeError(provider, state.model, Number(j.error.code) || 500, j.error.message || '', JSON.stringify(j.error));
  if (j.usage) state.usage = { input: j.usage.prompt_tokens || 0, output: j.usage.completion_tokens || 0, thinking: j.usage.completion_tokens_details?.reasoning_tokens || 0 };
  const ch = j.choices?.[0];
  const piece = ch?.delta?.content;
  if (typeof piece === 'string') state.text += piece;
  else if (Array.isArray(piece)) state.text += piece.map((p) => p.text || '').join('');
  if (ch?.finish_reason) state.finish = ch.finish_reason === 'length' ? 'MAX_TOKENS' : ch.finish_reason === 'content_filter' ? 'SAFETY' : ch.finish_reason;
}

const FINISH_KIND = {
  RECITATION: 'recitation',
  SAFETY: 'safety',
  PROHIBITED_CONTENT: 'safety',
  BLOCKLIST: 'safety',
  SPII: 'safety',
  IMAGE_SAFETY: 'safety',
  LANGUAGE: 'safety',
  OTHER: 'safety',
};

async function streamOnce(o) {
  const { provider, model, onText, signal, useProxy } = o;
  const req = buildRequest(o);
  // 사용자의 중단 + 응답 멈춤 감시를 함께 처리
  const inner = new AbortController();
  const onAbort = () => inner.abort();
  if (signal) {
    if (signal.aborted) inner.abort();
    signal.addEventListener('abort', onAbort, { once: true });
  }
  let idleTimer = null;
  let idleFired = 0;
  const arm = (ms) => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleFired = ms;
      inner.abort();
    }, ms);
  };
  const cleanup = () => {
    clearTimeout(idleTimer);
    if (signal) signal.removeEventListener('abort', onAbort);
  };
  const idleError = () => {
    const e = new LlmError('timeout-idle', { model, provider });
    e.seconds = Math.round(idleFired / 1000);
    return e;
  };
  const state = { text: '', finish: '', block: '', model, usage: { input: 0, output: 0, thinking: 0 } };
  try {
    arm(FIRST_IDLE_MS);
    let res;
    try {
      const url = useProxy ? `/api/proxy?target=${encodeURIComponent(req.url)}` : req.url;
      res = await fetch(url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: inner.signal });
    } catch (e) {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (idleFired) throw idleError();
      throw new LlmError('network', { model, provider, raw: String(e?.message || e) });
    }
    if (!res.ok) {
      let msg = '';
      let raw = '';
      try {
        raw = await res.text();
        try {
          const j = JSON.parse(raw);
          const err = Array.isArray(j) ? j[0]?.error : j?.error;
          msg = err?.message || j?.message || raw;
        } catch {
          msg = raw;
        }
      } catch {}
      throw makeError(provider, model, res.status, String(msg).slice(0, 600), raw);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      arm(state.text ? NEXT_IDLE_MS : FIRST_IDLE_MS);
      let chunk;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (idleFired) throw idleError();
        throw new LlmError('stream-cut', { model, provider, raw: String(e?.message || e), partial: state.text });
      }
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      const { events, rest } = parseSse(buf);
      buf = rest;
      const before = state.text.length;
      for (const ev of events) readEvent(provider, ev, state);
      if (onText && state.text.length !== before) onText(state.text);
    }
    if (buf.trim()) {
      const { events } = parseSse(`${buf}\n\n`);
      for (const ev of events) readEvent(provider, ev, state);
      if (onText) onText(state.text);
    }
  } finally {
    cleanup();
  }
  if (state.block) throw new LlmError('blocked-input', { model, provider, raw: `blockReason: ${state.block}` });
  const fk = FINISH_KIND[state.finish];
  if (fk) throw new LlmError(fk, { model, provider, raw: `finishReason: ${state.finish}`, partial: state.text });
  if (!state.text.trim()) throw new LlmError('empty', { model, provider, raw: state.finish ? `finishReason: ${state.finish}` : '' });
  // Gemini·Claude는 정상 종료 때 종료 사유를 꼭 보냄. 없으면 중간에 끊긴 것
  if (!state.finish && (provider === 'gemini' || provider === 'anthropic')) throw new LlmError('stream-cut', { model, provider, partial: state.text, raw: '종료 신호 없이 연결이 닫힘' });
  return { text: state.text, finish: state.finish, model, usage: state.usage };
}

// 400 오류일 때 선택 옵션을 하나씩 끄고 재시도
function relaxOptions(provider, err, opts) {
  const raw = `${err.raw || ''} ${err.message}`.toLowerCase();
  if (!opts.noMediaRes && /media_?resolution/.test(raw)) return { ...opts, noMediaRes: true };
  if (!opts.noThinking && /thinking|output_config|effort|reasoning/.test(raw)) return { ...opts, noThinking: true };
  if (!opts.noUsage && /stream_options|include_usage/.test(raw)) return { ...opts, noUsage: true };
  if ((provider === 'openai' || provider === 'compat') && !opts.legacyMax && /max_completion_tokens/.test(raw)) return { ...opts, legacyMax: true };
  if (!opts.noJsonMode && /response_format|json|mime/.test(raw)) return { ...opts, noJsonMode: true };
  if (/max_?tokens|maxoutputtokens|max_completion_tokens|too large|exceeds/.test(raw) && (opts.maxTokens ?? 0) !== 16000) return { ...opts, maxTokens: 16000 };
  if (!opts.noMediaRes && provider === 'gemini') return { ...opts, noMediaRes: true };
  if (!opts.noThinking) return { ...opts, noThinking: true };
  if (!opts.noUsage && provider !== 'gemini' && provider !== 'anthropic') return { ...opts, noUsage: true };
  return null;
}

/**
 * parts: [{type:'text', text} | {type:'image', mime, data(base64), res?:'low'|'medium'|'high'}]
 * thinking: 'low' | 'medium' | 'high'
 * fallback: true면 서버가 계속 바쁠 때 같은 회사의 다른 모델로 바꿔 이어 감
 * onStatus(message, info) : 재시도·대기·모델 전환 알림
 */
export async function generate({ provider, model, apiKey, baseUrl, system, parts, json = true, maxTokens = 40000, onText, onStatus, signal, useProxy = false, thinking = 'medium', fallback = false }) {
  if (!apiKey) throw new LlmError('no-key', { provider });
  if (!model) throw new LlmError('model', { provider, raw: '모델 이름이 비어 있습니다.' });
  let opts = { thinking };
  const models = [model];
  if (fallback) {
    // 같은 계열(예: Opus) 먼저, 그다음 다른 계열. 무료 모델에서 유료 전용 모델로는 넘어가지 않음
    const list = PROVIDERS[provider]?.models || [];
    const me = list.find((m) => m.id === model);
    const paid = (m) => /유료/.test(m.group || '');
    const ok = list.filter((m) => m.id !== model && (!paid(m) || (me && paid(me))));
    [...ok.filter((m) => me && m.group === me.group), ...ok.filter((m) => !me || m.group !== me.group)].forEach((m) => !models.includes(m.id) && models.push(m.id));
  }
  let mi = 0;
  let relaxCount = 0;
  const tries = {};
  for (;;) {
    const m = models[mi];
    try {
      return await streamOnce({ provider, model: m, apiKey, baseUrl, system, parts, json, maxTokens, onText, signal, useProxy, opts });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (!(e instanceof LlmError)) throw e;
      if (e.kind === 'bad-request' && relaxCount < 6) {
        const next = relaxOptions(provider, e, opts);
        if (next) {
          relaxCount++;
          opts = next;
          continue;
        }
      }
      const plan = RETRY_PLAN[e.kind];
      const n = tries[e.kind] || 0;
      if (plan && n < plan.length) {
        tries[e.kind] = n + 1;
        let wait = plan[n] * 1000;
        if (e.kind === 'quota-minute' && e.retryAfter) wait = Math.min(120_000, e.retryAfter + 2000);
        const ex = explainKind(e.kind, { status: e.status, seconds: e.seconds });
        if (onStatus) onStatus(`${ex.title}: ${Math.round(wait / 1000)}초 뒤 다시 시도합니다 (${n + 1}/${plan.length}).`, { kind: e.kind, wait, error: e });
        await sleep(wait, signal);
        continue;
      }
      // 계속 바쁘거나 모델을 못 찾으면 다른 모델로
      if (fallback && ['overloaded', 'model', 'server', 'quota-day', 'quota-minute'].includes(e.kind) && mi < models.length - 1) {
        mi++;
        Object.keys(tries).forEach((k) => delete tries[k]);
        if (onStatus) onStatus(`${explainKind(e.kind, { status: e.status }).title} → 모델을 ${models[mi]}(으)로 바꿔 계속합니다.`, { kind: 'fallback', model: models[mi], error: e });
        continue;
      }
      throw e;
    }
  }
}
