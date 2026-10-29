// 선택 기능: 브라우저에서 AI 회사로 직접 연결이 막힐 때만 쓰는 중계 서버.
// 허용된 AI 주소로만 전달하며, API 키를 저장하거나 기록하지 않습니다.
export const runtime = 'edge';

const ALLOWED_HOSTS = new Set([
  'generativelanguage.googleapis.com',
  'api.anthropic.com',
  'api.openai.com',
  'openrouter.ai',
]);
const PASS_HEADERS = ['content-type', 'x-goog-api-key', 'x-api-key', 'authorization', 'anthropic-version', 'anthropic-beta', 'http-referer', 'x-title'];

export async function POST(req) {
  const target = new URL(req.url).searchParams.get('target') || '';
  let url;
  try {
    url = new URL(target);
  } catch {
    return new Response('잘못된 주소', { status: 400 });
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    return new Response('허용되지 않은 주소입니다.', { status: 403 });
  }
  const headers = {};
  for (const h of PASS_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  const body = await req.text();
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // 응답을 바로 시작해 두고(시간 제한 대비), AI 응답이 오면 이어서 흘려보냄
  (async () => {
    const keepAlive = setInterval(() => writer.write(enc.encode(': keep-alive\n\n')).catch(() => {}), 10000);
    try {
      await writer.write(enc.encode(': proxy\n\n'));
      const upstream = await fetch(url.toString(), { method: 'POST', headers, body });
      clearInterval(keepAlive);
      if (!upstream.ok) {
        const text = await upstream.text();
        let message = text;
        try {
          message = JSON.parse(text)?.error?.message || text;
        } catch {}
        await writer.write(enc.encode(`data: ${JSON.stringify({ proxyError: { status: upstream.status, message: String(message).slice(0, 500), raw: text.slice(0, 3000) } })}\n\n`));
      } else {
        const reader = upstream.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
      }
    } catch (e) {
      clearInterval(keepAlive);
      await writer.write(enc.encode(`data: ${JSON.stringify({ proxyError: { status: 502, message: String(e?.message || e) } })}\n\n`)).catch(() => {});
    } finally {
      clearInterval(keepAlive);
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
