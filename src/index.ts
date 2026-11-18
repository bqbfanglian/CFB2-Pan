import { cleanAdminAuth, isAdmin, login, logout } from './auth';
import { Env, file, HttpError, idOf, isDemo, json, now } from './common';
import { createFolder, deleteEntry, download, editEntry, listEntries } from './entries';
import { createShare, listShares, publicShare, revokeShare } from './shares';
import { beginUpload, cleanup, uploadRoute } from './uploads';
import { summary } from './scheduler';

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

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
  const adminHost = env.ADMIN_HOST?.trim().toLowerCase();
  const shareHost = env.SHARE_HOST?.trim().toLowerCase();
  const isAdminHost = local || !adminHost || hostname === adminHost;
  const isShareHost = local || (shareHost ? hostname === shareHost : isAdminHost);
  const origin = request.headers.get('origin');
  if (!read && origin && origin !== url.origin) throw new HttpError(403, '跨站请求被拒绝');
  if (read && pathname === '/style.css' && (isAdminHost || isShareHost)) return asset(env, request, pathname);

  if (isShareHost) {
    const share = /^\/s\/([a-zA-Z0-9_-]{43})(?:\/(info|unlock|download))?$/.exec(pathname);
    if (share) {
      if (read && !share[2]) return asset(env, request, '/share.html');
      return publicShare(env, request, share[1], share[2]);
    }
    if (read && pathname === '/share.js') return asset(env, request, pathname);
  }

  if (!isAdminHost) throw new HttpError(404, '页面不存在');
  if (read && pathname === '/login.js') return asset(env, request, pathname);
  if (read && pathname === '/login') {
    if (await isAdmin(env, request)) return new Response(null, { status: 303, headers: { Location: '/' } });
    return asset(env, request, '/login.html');
  }
  if (method === 'POST' && pathname === '/api/admin/login') return login(env, request);
  if (method === 'POST' && pathname === '/api/admin/logout') return logout(env, request);
  if (!await isAdmin(env, request)) {
    if (read && pathname === '/') return new Response(null, { status: 303, headers: { Location: '/login' } });
    throw new HttpError(401, '请先登录网盘管理');
  }
  if (read && pathname === '/') return asset(env, request, '/index.html');
  if (read && pathname === '/drive.js') return asset(env, request, pathname);
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
    await Promise.all([cleanup(env), cleanAdminAuth(env.DB, now())]);
  },
} satisfies ExportedHandler<Env>;
