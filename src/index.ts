import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Env, file, HttpError, idOf, isDemo, json } from './common';
import { createFolder, deleteEntry, download, editEntry, listEntries } from './entries';
import { createShare, listShares, publicShare, revokeShare } from './shares';
import { beginUpload, cleanup, uploadRoute } from './uploads';
import { summary } from './scheduler';

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function requireAdmin(env: Env, request: Request) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new HttpError(401, '请先登录 Cloudflare Access');
  const domain = env.ACCESS_TEAM_DOMAIN;
  if (!domain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !env.ACCESS_AUD || !env.ADMIN_EMAIL) {
    throw new HttpError(503, '管理员登录尚未配置');
  }
  const issuer = `https://${domain}`;
  let keys = jwks.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer));
    jwks.set(issuer, keys);
  }
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'email'],
    });
    if (typeof payload.email === 'string' && payload.email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase()) return;
  } catch { /* Access JWTs that fail verification have no admin permissions. */ }
  throw new HttpError(403, '当前账户没有网盘管理权限');
}

function lockHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body, { status: response.status, headers });
}

function asset(env: Env, request: Request, path: string) {
  return env.ASSETS.fetch(new Request(new URL(path, request.url), request));
}

async function handle(env: Env, request: Request) {
  const url = new URL(request.url);
  const { hostname, pathname } = url;
  const method = request.method;
  const read = method === 'GET' || method === 'HEAD';
  const local = isDemo(env) && localHosts.has(hostname);
  if (isDemo(env) && !local) throw new HttpError(404, '页面不存在');
  const isAdminHost = local || hostname === env.ADMIN_HOST;
  const isShareHost = local || (hostname === env.SHARE_HOST && hostname !== env.ADMIN_HOST);
  const origin = request.headers.get('origin');
  if (!read && origin && origin !== url.origin) throw new HttpError(403, '跨站请求被拒绝');

  if (isShareHost) {
    const share = /^\/s\/([a-zA-Z0-9_-]{43})(?:\/(info|unlock|download))?$/.exec(pathname);
    if (share) {
      if (read && !share[2]) return asset(env, request, '/share.html');
      return publicShare(env, request, share[1], share[2]);
    }
    if (read && ['/style.css', '/share.js'].includes(pathname)) return asset(env, request, pathname);
  }

  if (!isAdminHost) throw new HttpError(404, '页面不存在');
  if (!local) await requireAdmin(env, request);
  if (read && ['/', '/drive.js', '/style.css'].includes(pathname)) {
    return asset(env, request, pathname === '/' ? '/index.html' : pathname);
  }
  if (method === 'GET' && pathname === '/api/storage') return json({ demo: local, ...await summary(env) });
  if (method === 'GET' && pathname === '/api/entries') return listEntries(env, url);
  if (method === 'POST' && pathname === '/api/folders') return createFolder(env, request);
  if (method === 'POST' && pathname === '/api/uploads') return beginUpload(env, request);
  if (pathname === '/api/shares') {
    if (method === 'GET') return listShares(env, request, url);
    if (method === 'POST') return createShare(env, request);
  }
  const upload = /^\/api\/uploads\/([a-f0-9-]{36})(?:\/(?:(part)\/(\d+)|(object|complete)))?$/.exec(pathname);
  if (upload) return uploadRoute(env, request, idOf(upload[1]), upload[2] ?? upload[4], upload[3]);
  const item = /^\/api\/entries\/([a-f0-9-]{36})(\/download)?$/.exec(pathname);
  if (item) {
    const id = idOf(item[1]);
    if (!item[2] && method === 'PATCH') return editEntry(env, request, id);
    if (!item[2] && method === 'DELETE') return deleteEntry(env, id);
    if (item[2] && read) {
      const entry = await file(env.DB, id);
      if (!entry) throw new HttpError(404, '文件不存在');
      return download(env, request, entry);
    }
  }
  const shareId = /^\/api\/shares\/([a-f0-9-]{36})$/.exec(pathname);
  if (shareId && method === 'DELETE') return revokeShare(env, idOf(shareId[1]));
  throw new HttpError(404, '页面或接口不存在');
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      return lockHeaders(await handle(env, request));
    } catch (error) {
      if (error instanceof HttpError) return lockHeaders(json({ error: error.message }, error.status));
      console.error('drive request failed', error instanceof Error ? error.name : typeof error);
      return lockHeaders(json({ error: '网盘暂时无法处理此请求，请稍后重试' }, 500));
    }
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    await cleanup(env);
  },
} satisfies ExportedHandler<Env>;
