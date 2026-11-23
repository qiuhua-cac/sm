/**
 * Cloudflare Worker —— bluebee API 中转
 *
 * 作用：
 *   浏览器直连 platform.bluebeecloud.com 会被 CORS 拦截，
 *   这里做一层反向代理，并补上 CORS 头。
 *
 * 用法：
 *   页面里把服务器地址改成 https://<你的worker>.workers.dev
 *   Worker 会把所有请求转发到 TARGET
 */

const TARGET = 'https://platform.bluebeecloud.com/api';

// 允许的来源。生产建议改成你的具体域名，例如：
//   const ALLOW_ORIGIN = 'https://qiuhua-cac.github.io';
const ALLOW_ORIGIN = '*';

const CORS = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, token, token-id, Authorization',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': '*'
};

export default {
  async fetch(request) {
    // 预检直接返回
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    // 只转发 /api/* 路径，避免被当成开放代理
    if (!url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({
        ok: false,
        message: '请把服务器地址设为 https://' + url.host + '/api'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }

    // 拼目标地址：/api/xxx → https://platform.bluebeecloud.com/api/xxx
    const targetUrl = TARGET + url.pathname.slice(4) + url.search;

    // 复制请求头，去掉会干扰的
    const headers = new Headers();
    for (const [k, v] of request.headers) {
      const lk = k.toLowerCase();
      if (lk === 'host' || lk === 'origin' || lk === 'referer' ||
          lk === 'cf-connecting-ip' || lk === 'cf-ray' || lk.startsWith('cf-') ||
          lk === 'x-forwarded-for' || lk === 'x-real-ip') {
        continue;
      }
      headers.set(k, v);
    }
    headers.set('Host', 'platform.bluebeecloud.com');

    let body;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.arrayBuffer();
    }

    let resp;
    try {
      resp = await fetch(targetUrl, {
        method: request.method,
        headers,
        body,
        redirect: 'follow'
      });
    } catch (e) {
      return new Response(JSON.stringify({
        ok: false,
        message: '上游请求失败：' + (e && e.message ? e.message : e)
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
      });
    }

    // 返回给浏览器，补 CORS
    const outHeaders = new Headers();
    for (const [k, v] of resp.headers) {
      const lk = k.toLowerCase();
      if (lk === 'content-encoding' || lk === 'content-length' ||
          lk === 'transfer-encoding' || lk === 'connection') {
        continue;
      }
      outHeaders.set(k, v);
    }
    for (const [k, v] of Object.entries(CORS)) {
      outHeaders.set(k, v);
    }
    if (!outHeaders.has('Content-Type')) {
      outHeaders.set('Content-Type', 'application/json; charset=utf-8');
    }

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: outHeaders
    });
  }
};
