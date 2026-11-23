/**
 * Cloudflare Pages Function —— /api/* 反向代理
 *
 * 页面和 API 同域（都在 xxx.pages.dev），所以：
 *   1. 没有 CORS 问题
 *   2. 国内能访问（pages.dev 未被阻断）
 *
 * 这个文件路径是 functions/api/[[path]].js
 * 匹配所有 /api/* 请求（包括 /api/security-info、/api/login 等）
 */

const TARGET = 'https://platform.bluebeecloud.com/api';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // CORS 预检（同域其实用不到，保险起见）
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, token, token-id, Authorization',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  // /api/xxx  →  https://platform.bluebeecloud.com/api/xxx
  const sub = url.pathname.replace(/^\/api/, '');
  const targetUrl = TARGET + sub + url.search;

  // 只转发必要请求头（不要设 Host）
  const headers = new Headers();
  const pass = ['content-type', 'accept', 'accept-language',
                'token', 'token-id', 'authorization', 'user-agent'];
  for (const [k, v] of request.headers) {
    if (pass.indexOf(k.toLowerCase()) >= 0) headers.set(k, v);
  }

  let body;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 0) body = buf;
  }

  let resp;
  try {
    resp = await fetch(targetUrl, {
      method: request.method,
      headers,
      body
    });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'upstream_failed',
      message: String((e && e.message) || e),
      target: targetUrl
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  const out = new Headers();
  const ct = resp.headers.get('Content-Type');
  out.set('Content-Type', ct || 'application/json; charset=utf-8');
  out.set('Access-Control-Allow-Origin', '*');
  out.set('Cache-Control', 'no-store');

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: out
  });
}
