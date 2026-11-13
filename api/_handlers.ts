import express, { Request, Response } from 'express';
import { Readable } from 'stream';
import * as cheerio from 'cheerio';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function getBrowserHeaders(referer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_USER_AGENT,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1',
  };
  if (referer) {
    headers['Referer'] = referer;
  }
  return headers;
}

function getProxyOrigin(req: Request): string {
  const forwardedProto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim();
  const refererProto = (() => {
    try {
      return req.headers.referer ? new URL(req.headers.referer).protocol.replace(':', '') : '';
    } catch {
      return '';
    }
  })();
  const forwardedHost = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim();
  const host = forwardedHost || req.get('host') || 'localhost:3000';
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const proto = forwardedProto || refererProto || (isLocal ? 'http' : 'https');
  return `${proto}://${host}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function pipeWebBodyToResponse(upstream: globalThis.Response, res: Response): Promise<void> {
  if (!upstream.body) {
    res.end();
    return;
  }
  try {
    const nodeStream = Readable.fromWeb(upstream.body as any);
    await new Promise<void>((resolve, reject) => {
      nodeStream.on('error', (err) => reject(err));
      res.on('close', () => {
        try {
          nodeStream.destroy();
        } catch {
          // ignore
        }
        resolve();
      });
      res.on('finish', () => resolve());
      nodeStream.pipe(res);
    });
  } catch {
    if (!res.headersSent) {
      res.status(502);
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
}

function unwrapRedirectUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();

    if (host.includes('duckduckgo.com') && parsed.pathname.startsWith('/l/')) {
      const uddg = parsed.searchParams.get('uddg');
      if (uddg && (uddg.startsWith('http://') || uddg.startsWith('https://'))) {
        return uddg;
      }
    }

    if (host.includes('google.') && parsed.pathname === '/url') {
      const target = parsed.searchParams.get('q') || parsed.searchParams.get('url');
      if (target && (target.startsWith('http://') || target.startsWith('https://'))) {
        return target;
      }
    }

    if (host.includes('bing.com') && parsed.pathname.startsWith('/ck/a')) {
      const u = parsed.searchParams.get('u');
      if (u && u.startsWith('a1')) {
        const b64 = u.slice(2).replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          return decoded;
        }
      }
    }

    if (host.includes('youtube.com') && parsed.pathname === '/redirect') {
      const q = parsed.searchParams.get('q');
      if (q && (q.startsWith('http://') || q.startsWith('https://'))) {
        return q;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return rawUrl;
}

function isKnownEmbedFrame(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const h = u.hostname.toLowerCase();
    const p = u.pathname.toLowerCase();
    return (
      ((h.includes('youtube.com') || h.includes('youtube-nocookie.com')) && p.startsWith('/embed/')) ||
      (h === 'player.vimeo.com' && p.startsWith('/video/')) ||
      (h.includes('dailymotion.com') && p.startsWith('/embed/')) ||
      h === 'player.twitch.tv' ||
      (h === 'open.spotify.com' && p.startsWith('/embed/')) ||
      h === 'w.soundcloud.com' ||
      h === 'codepen.io'
    );
  } catch {
    return false;
  }
}

function isBotChallengePage(status: number, html: string): boolean {
  if (![202, 403, 429, 503].includes(status)) return false;
  const lower = html.toLowerCase();
  return (
    lower.includes('just a moment...') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('challenge-platform') ||
    lower.includes('awswafintegration') ||
    lower.includes('px-captcha') ||
    lower.includes('enable javascript and cookies to continue') ||
    (status === 403 && html.length < 4000 && lower.includes('blocked'))
  );
}

function rewriteCssUrls(cssText: string, cssUrl: string, proxyOrigin: string): string {
  const makeAssetUrl = (ref: string) => {
    const unquoted = ref.trim().replace(/^['"]|['"]$/g, '');
    if (
      !unquoted ||
      unquoted.startsWith('data:') ||
      unquoted.startsWith('blob:') ||
      unquoted.startsWith('#') ||
      unquoted.startsWith(proxyOrigin)
    ) {
      return null;
    }
    try {
      const abs = new URL(unquoted, cssUrl).href;
      return `${proxyOrigin}/api/asset?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(cssUrl)}`;
    } catch {
      return null;
    }
  };

  let out = cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, quote, inner) => {
    const rewritten = makeAssetUrl(inner);
    if (!rewritten) return full;
    return `url(${quote || '"'}${rewritten}${quote || '"'})`;
  });

  out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (full, _q, impUrl) => {
    const rewritten = makeAssetUrl(impUrl);
    if (!rewritten) return full;
    return `@import "${rewritten}"`;
  });

  return out;
}

interface YtVideoItem {
  id: string;
  title: string;
  channel: string;
  duration: string;
  views: string;
  thumb: string;
}

function extractYtVideosFromData(data: any, limit = 24): YtVideoItem[] {
  const results: YtVideoItem[] = [];
  const seen = new Set<string>();

  function walk(node: any) {
    if (!node || typeof node !== 'object' || results.length >= limit) return;

    const renderer = node.videoRenderer || node.compactVideoRenderer || node.gridVideoRenderer;
    if (renderer && renderer.videoId && !seen.has(renderer.videoId)) {
      const id = String(renderer.videoId);
      const title =
        renderer.title?.runs?.[0]?.text ||
        renderer.title?.simpleText ||
        'Untitled Video';
      const channel =
        renderer.ownerText?.runs?.[0]?.text ||
        renderer.shortBylineText?.runs?.[0]?.text ||
        renderer.longBylineText?.runs?.[0]?.text ||
        'YouTube';
      const duration = renderer.lengthText?.simpleText || '';
      const views =
        renderer.shortViewCountText?.simpleText ||
        renderer.viewCountText?.simpleText ||
        '';
      const thumbs = renderer.thumbnail?.thumbnails;
      const thumb =
        (Array.isArray(thumbs) && thumbs[thumbs.length - 1]?.url) ||
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

      seen.add(id);
      results.push({ id, title, channel, duration, views, thumb });
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else {
      for (const key of Object.keys(node)) {
        walk(node[key]);
      }
    }
  }

  walk(data);
  return results;
}

function extractJsonAfterMarker(html: string, markerRegex: RegExp): any | null {
  const m = markerRegex.exec(html);
  if (!m) return null;
  const startIdx = m.index + m[0].length - 1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < html.length; i++) {
    const ch = html[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(startIdx, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function parseYouTubeUrl(urlStr: string): {
  type: 'watch' | 'search' | 'browse';
  videoId?: string;
  query?: string;
} | null {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();

    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      if (id) return { type: 'watch', videoId: id };
      return { type: 'browse' };
    }

    if (
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtube-nocookie.com' ||
      host.endsWith('.youtube-nocookie.com')
    ) {
      if (u.pathname === '/watch') {
        const v = u.searchParams.get('v');
        if (v) return { type: 'watch', videoId: v };
      }
      const shortsMatch = u.pathname.match(/^\/(shorts|live|embed)\/([a-zA-Z0-9_-]+)/);
      if (shortsMatch) {
        return { type: 'watch', videoId: shortsMatch[2] };
      }
      if (u.pathname === '/results') {
        return { type: 'search', query: u.searchParams.get('search_query') || '' };
      }
      return { type: 'browse' };
    }
  } catch {
    return null;
  }
  return null;
}

function parseOtherVideoPlatform(
  urlStr: string,
  reqHost: string
): { platform: string; embedUrl: string; title: string } | null {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();

    if (host === 'vimeo.com' || host === 'www.vimeo.com') {
      const m = u.pathname.match(/^\/(\d+)/);
      if (m) {
        return {
          platform: 'Vimeo',
          embedUrl: `https://player.vimeo.com/video/${m[1]}?autoplay=1`,
          title: `Vimeo Video #${m[1]}`,
        };
      }
    }

    if (host.includes('dailymotion.com')) {
      const m = u.pathname.match(/\/video\/([a-zA-Z0-9]+)/);
      if (m) {
        return {
          platform: 'Dailymotion',
          embedUrl: `https://www.dailymotion.com/embed/video/${m[1]}?autoplay=1`,
          title: 'Dailymotion Video',
        };
      }
    }
    if (host === 'dai.ly') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      if (id) {
        return {
          platform: 'Dailymotion',
          embedUrl: `https://www.dailymotion.com/embed/video/${id}?autoplay=1`,
          title: 'Dailymotion Video',
        };
      }
    }

    if (host === 'www.twitch.tv' || host === 'twitch.tv') {
      const parentHost = reqHost.split(':')[0] || 'localhost';
      const videoMatch = u.pathname.match(/^\/videos\/(\d+)/);
      if (videoMatch) {
        return {
          platform: 'Twitch',
          embedUrl: `https://player.twitch.tv/?video=${videoMatch[1]}&parent=${encodeURIComponent(parentHost)}&autoplay=true`,
          title: 'Twitch VOD',
        };
      }
      const channel = u.pathname.replace(/^\//, '').split('/')[0];
      if (channel && !['directory', 'downloads', 'jobs', 'p', 'settings'].includes(channel)) {
        return {
          platform: 'Twitch',
          embedUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(parentHost)}&autoplay=true`,
          title: `Twitch - ${channel}`,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function buildHelperScript(finalUrl: string, fallbackHost: string, proxyOrigin: string): string {
  const safeFinalUrl = JSON.stringify(finalUrl);
  const safeHost = JSON.stringify(fallbackHost);
  const safeProxyOrigin = JSON.stringify(proxyOrigin);

  return `
    <script id="ghost-browser-helper">
      (function() {
        var BASE_URL = ${safeFinalUrl};
        var PROXY_ORIGIN = ${safeProxyOrigin};
        try {
          if (window.location && window.location.origin && window.location.origin !== 'null') {
            PROXY_ORIGIN = window.location.origin;
          }
        } catch(e) {}

        function resolveAbsolute(href) {
          try {
            return new URL(href, BASE_URL).href;
          } catch(e) {
            return href;
          }
        }

        function unwrapRedirectUrl(rawUrl) {
          try {
            var u = new URL(rawUrl);
            var h = u.hostname.toLowerCase();
            if (h.indexOf('duckduckgo.com') !== -1 && u.pathname.indexOf('/l/') === 0) {
              var uddg = u.searchParams.get('uddg');
              if (uddg && /^https?:\\/\\//i.test(uddg)) return uddg;
            }
            if (h.indexOf('google.') !== -1 && u.pathname === '/url') {
              var q = u.searchParams.get('q') || u.searchParams.get('url');
              if (q && /^https?:\\/\\//i.test(q)) return q;
            }
            if (h.indexOf('bing.com') !== -1 && u.pathname.indexOf('/ck/a') === 0) {
              var bu = u.searchParams.get('u');
              if (bu && bu.indexOf('a1') === 0) {
                var b64 = bu.slice(2).replace(/-/g, '+').replace(/_/g, '/');
                var dec = atob(b64);
                if (/^https?:\\/\\//i.test(dec)) return dec;
              }
            }
            if (h.indexOf('youtube.com') !== -1 && u.pathname === '/redirect') {
              var yq = u.searchParams.get('q');
              if (yq && /^https?:\\/\\//i.test(yq)) return yq;
            }
          } catch(e) {}
          return rawUrl;
        }

        function toProxyAssetUrl(rawUrl) {
          if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
          if (/^(data:|blob:|about:|javascript:)/i.test(rawUrl)) return rawUrl;
          if (rawUrl.indexOf(PROXY_ORIGIN) === 0 || rawUrl.indexOf('/api/') === 0) {
            return rawUrl;
          }
          var abs = resolveAbsolute(rawUrl);
          if (abs.indexOf(PROXY_ORIGIN) === 0) return abs;
          return PROXY_ORIGIN + '/api/asset?url=' + encodeURIComponent(abs) + '&referer=' + encodeURIComponent(BASE_URL);
        }

        function navigateInBrowser(targetUrl) {
          if (!targetUrl || typeof targetUrl !== 'string') return;
          if (/^(javascript:|mailto:|tel:|data:|blob:)/i.test(targetUrl)) return;
          var abs = unwrapRedirectUrl(resolveAbsolute(targetUrl));
          window.parent.postMessage({ type: 'BROWSER_NAVIGATE', url: abs }, '*');
        }

        try {
          var origPush = history.pushState.bind(history);
          var origReplace = history.replaceState.bind(history);
          function wrapHistory(origFn) {
            return function(state, title, url) {
              if (url && typeof url === 'string') {
                var abs = resolveAbsolute(url);
                var proxied = PROXY_ORIGIN + '/api/proxy?url=' + encodeURIComponent(abs);
                try { origFn(state, title, proxied); } catch(e) {}
                BASE_URL = abs;
                window.parent.postMessage({
                  type: 'BROWSER_PAGE_INFO',
                  title: document.title || ${safeHost},
                  url: abs
                }, '*');
                return;
              }
              try { return origFn(state, title, url); } catch(e) {}
            };
          }
          history.pushState = wrapHistory(origPush);
          history.replaceState = wrapHistory(origReplace);
        } catch(e) {}

        try {
          window.open = function(url) {
            if (url) navigateInBrowser(url);
            return {
              closed: false,
              focus: function() {},
              blur: function() {},
              close: function() {},
              postMessage: function() {},
              location: { href: url || '' }
            };
          };
        } catch(e) {}

        try {
          if (navigator.serviceWorker && navigator.serviceWorker.register) {
            navigator.serviceWorker.register = function() {
              return Promise.reject(new Error('ServiceWorker disabled in ephemeral proxy'));
            };
          }
        } catch(e) {}

        try {
          var nativeFetch = window.fetch.bind(window);
          window.fetch = function(input, init) {
            var urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');
            if (!urlStr || /^(data:|blob:|about:)/i.test(urlStr) || urlStr.indexOf(PROXY_ORIGIN) === 0 || urlStr.indexOf('/api/') === 0) {
              return nativeFetch(input, init);
            }
            return nativeFetch(input, init).catch(function(err) {
              var proxied = toProxyAssetUrl(urlStr);
              if (proxied && proxied !== urlStr) {
                return nativeFetch(proxied, init);
              }
              throw err;
            });
          };
        } catch(e) {}

        document.addEventListener('click', function(e) {
          var el = e.target;
          while (el && el.tagName !== 'A' && el.tagName !== 'AREA') {
            el = el.parentElement;
          }
          if (!el) return;
          if (el.hasAttribute('download')) return;

          var rawHref = el.getAttribute('href');
          if (!rawHref) return;
          var trimmed = rawHref.trim();
          if (
            !trimmed ||
            trimmed === '#' ||
            trimmed.charAt(0) === '#' ||
            /^javascript:/i.test(trimmed) ||
            /^mailto:/i.test(trimmed) ||
            /^tel:/i.test(trimmed)
          ) {
            return;
          }

          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
          navigateInBrowser(trimmed);
        }, true);

        document.addEventListener('submit', function(e) {
          var form = e.target;
          if (!form || form.tagName !== 'FORM') return;
          form.removeAttribute('target');
          var method = (form.getAttribute('method') || 'GET').toUpperCase();
          var action = form.getAttribute('action') || '';
          var absAction = resolveAbsolute(action);

          if (method === 'GET') {
            e.preventDefault();
            e.stopPropagation();
            var formData = new FormData(form);
            var params = new URLSearchParams();
            formData.forEach(function(val, key) {
              if (typeof val === 'string') params.append(key, val);
            });
            var queryStr = params.toString();
            var baseAction = absAction.split('#')[0];
            var targetFull = queryStr
              ? baseAction + (baseAction.indexOf('?') !== -1 ? '&' : '?') + queryStr
              : baseAction;
            navigateInBrowser(targetFull);
          } else {
            form.setAttribute('target', '_self');
            form.setAttribute('action', PROXY_ORIGIN + '/api/proxy?url=' + encodeURIComponent(absAction));
          }
        }, true);

        function notifyInfo() {
          var pageTitle = document.title || ${safeHost};
          window.parent.postMessage({
            type: 'BROWSER_PAGE_INFO',
            title: pageTitle,
            url: BASE_URL
          }, '*');
        }

        if (document.readyState === 'complete' || document.readyState === 'interactive') {
          notifyInfo();
        } else {
          window.addEventListener('DOMContentLoaded', notifyInfo);
        }
        window.addEventListener('load', notifyInfo);
      })();
    </script>
  `;
}

function renderYouTubeShell(opts: {
  mode: 'watch' | 'browse';
  videoId?: string;
  title?: string;
  author?: string;
  searchQuery?: string;
  videos: YtVideoItem[];
  currentUrl: string;
  proxyOrigin: string;
}): string {
  const { mode, videoId, title, author, searchQuery, videos, currentUrl, proxyOrigin } = opts;

  const cardsHtml = videos
    .map(
      (v) => `
      <a href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}" class="yt-card">
        <div class="yt-thumb-wrap">
          <img src="${escapeHtml(v.thumb)}" alt="${escapeHtml(v.title)}" loading="lazy" referrerpolicy="no-referrer" />
          ${v.duration ? `<span class="yt-duration">${escapeHtml(v.duration)}</span>` : ''}
        </div>
        <div class="yt-meta">
          <div class="yt-title">${escapeHtml(v.title)}</div>
          <div class="yt-sub">${escapeHtml(v.channel)}${v.views ? ` · ${escapeHtml(v.views)}` : ''}</div>
        </div>
      </a>
    `
    )
    .join('');

  const playerSection =
    mode === 'watch' && videoId
      ? `
      <div class="player-wrap">
        <div class="player-aspect">
          <iframe
            id="yt-player-frame"
            src="https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope; web-share"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
          ></iframe>
        </div>
        <div class="watch-header">
          <div>
            <h1>${escapeHtml(title || 'YouTube Video')}</h1>
            <div class="watch-channel">${escapeHtml(author || 'YouTube')}</div>
          </div>
          <button type="button" class="alt-player-btn" onclick="switchAltEmbed()">
            Switch Player Source
          </button>
        </div>
      </div>
      <script>
        var usingNoCookie = false;
        function switchAltEmbed() {
          var f = document.getElementById('yt-player-frame');
          usingNoCookie = !usingNoCookie;
          var domain = usingNoCookie ? 'www.youtube-nocookie.com' : 'www.youtube.com';
          f.src = 'https://' + domain + '/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0';
        }
      </script>
    `
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title ? `${title} - YouTube` : 'YouTube - GhostBrowser')}</title>
  ${buildHelperScript(currentUrl, 'youtube.com', proxyOrigin)}
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #0b0f19;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 20px;
      background: rgba(11, 15, 25, 0.95);
      border-bottom: 1px solid #1e293b;
      backdrop-filter: blur(8px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #ffffff;
      text-decoration: none;
      font-weight: 700;
      font-size: 16px;
      white-space: nowrap;
    }
    .brand-mark {
      background: #ef4444;
      color: white;
      font-size: 11px;
      padding: 3px 7px;
      border-radius: 6px;
      font-weight: 700;
    }
    .search-form {
      flex: 1;
      max-width: 560px;
      display: flex;
      gap: 8px;
    }
    .search-input {
      flex: 1;
      height: 36px;
      padding: 0 14px;
      border-radius: 8px;
      border: 1px solid #334155;
      background: #111827;
      color: #f8fafc;
      font-size: 13px;
      outline: none;
    }
    .search-input:focus { border-color: #3b82f6; }
    .search-btn {
      height: 36px;
      padding: 0 16px;
      border-radius: 8px;
      border: none;
      background: #2563eb;
      color: white;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
    .search-btn:hover { background: #1d4ed8; }
    .container {
      max-width: 1280px;
      margin: 0 auto;
      padding: 20px;
    }
    .player-wrap { margin-bottom: 28px; }
    .player-aspect {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      max-height: 74vh;
      background: #000;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #1e293b;
    }
    .player-aspect iframe {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border: none;
    }
    .watch-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-top: 14px;
    }
    .watch-header h1 {
      margin: 0 0 4px 0;
      font-size: 18px;
      font-weight: 600;
      color: #f8fafc;
    }
    .watch-channel {
      font-size: 13px;
      color: #94a3b8;
    }
    .alt-player-btn {
      background: #1e293b;
      color: #cbd5e1;
      border: 1px solid #334155;
      padding: 7px 12px;
      border-radius: 8px;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .alt-player-btn:hover { background: #334155; color: #fff; }
    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #cbd5e1;
      margin: 0 0 14px 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 18px;
    }
    .yt-card {
      display: flex;
      flex-direction: column;
      text-decoration: none;
      color: inherit;
      background: #111827;
      border: 1px solid #1e293b;
      border-radius: 10px;
      overflow: hidden;
      transition: border-color 0.15s, transform 0.15s;
    }
    .yt-card:hover {
      border-color: #475569;
      transform: translateY(-2px);
    }
    .yt-thumb-wrap {
      position: relative;
      aspect-ratio: 16 / 9;
      background: #020617;
      overflow: hidden;
    }
    .yt-thumb-wrap img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .yt-duration {
      position: absolute;
      bottom: 6px;
      right: 6px;
      background: rgba(0, 0, 0, 0.82);
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
    }
    .yt-meta { padding: 10px 12px; }
    .yt-title {
      font-size: 13px;
      font-weight: 600;
      color: #f1f5f9;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .yt-sub {
      font-size: 12px;
      color: #94a3b8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty {
      padding: 40px 20px;
      text-align: center;
      color: #94a3b8;
      font-size: 14px;
      border: 1px dashed #334155;
      border-radius: 12px;
    }
  </style>
</head>
<body>
  <header class="topbar">
    <a href="https://www.youtube.com/" class="brand">
      <span class="brand-mark">PLAY</span>
      <span>YouTube</span>
    </a>
    <form class="search-form" action="https://www.youtube.com/results" method="GET">
      <input
        class="search-input"
        type="text"
        name="search_query"
        value="${escapeHtml(searchQuery || '')}"
        placeholder="Search YouTube videos inside browser..."
      />
      <button class="search-btn" type="submit">Search</button>
    </form>
  </header>
  <main class="container">
    ${playerSection}
    ${
      videos.length > 0
        ? `<h2 class="section-title">${
            mode === 'watch'
              ? 'Up Next & Related Videos'
              : searchQuery
              ? `Search results for "${escapeHtml(searchQuery)}"`
              : 'Recommended Videos'
          }</h2>
           <div class="grid">${cardsHtml}</div>`
        : mode === 'browse'
        ? '<div class="empty">Enter a topic in the YouTube search bar above to browse and play videos directly inside GhostBrowser.</div>'
        : ''
    }
  </main>
</body>
</html>`;
}

function renderEmbedVideoShell(opts: {
  platform: string;
  embedUrl: string;
  title: string;
  currentUrl: string;
  proxyOrigin: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(opts.title)}</title>
  ${buildHelperScript(opts.currentUrl, opts.platform, opts.proxyOrigin)}
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #020617;
      display: flex;
      flex-direction: column;
    }
    iframe {
      flex: 1;
      width: 100%;
      height: 100%;
      border: none;
    }
  </style>
</head>
<body>
  <iframe
    src="${escapeHtml(opts.embedUrl)}"
    allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope; web-share"
    allowfullscreen
  ></iframe>
</body>
</html>`;
}

function renderDirectMediaPlayer(mediaUrl: string, contentType: string, proxyOrigin: string): string {
  const isAudio = contentType.startsWith('audio/');
  const proxiedSrc = `${proxyOrigin}/api/media?url=${encodeURIComponent(mediaUrl)}`;
  const fileName = (() => {
    try {
      const p = new URL(mediaUrl).pathname.split('/').pop();
      return p || 'Media Stream';
    } catch {
      return 'Media Stream';
    }
  })();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(fileName)}</title>
  ${buildHelperScript(mediaUrl, fileName, proxyOrigin)}
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      background: #020617;
      color: #f1f5f9;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .player-box {
      width: 100%;
      max-width: 960px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    video {
      width: 100%;
      max-height: 82vh;
      border-radius: 10px;
      background: #000;
      box-shadow: 0 20px 50px rgba(0,0,0,0.6);
    }
    audio {
      width: 100%;
      max-width: 560px;
    }
    .label {
      font-size: 13px;
      color: #94a3b8;
      word-break: break-all;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="player-box">
    ${
      isAudio
        ? `<audio controls autoplay src="${escapeHtml(proxiedSrc)}"></audio>`
        : `<video controls autoplay playsinline src="${escapeHtml(proxiedSrc)}"></video>`
    }
    <div class="label">${escapeHtml(fileName)}</div>
  </div>
</body>
</html>`;
}

function renderBotBlockRecoveryPage(targetUrl: string, hostname: string, proxyOrigin: string): string {
  const ddgSearchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(hostname)}`;
  const archiveUrl = `https://web.archive.org/web/*/${targetUrl}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(hostname)} - Protection Notice</title>
  ${buildHelperScript(targetUrl, hostname, proxyOrigin)}
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0b0f19;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 24px;
      box-sizing: border-box;
    }
    .card {
      max-width: 520px;
      width: 100%;
      background: #111827;
      border: 1px solid #1e293b;
      border-radius: 14px;
      padding: 32px;
      text-align: center;
      box-shadow: 0 20px 45px rgba(0,0,0,0.5);
    }
    h1 { font-size: 19px; font-weight: 600; margin: 0 0 10px 0; color: #f8fafc; }
    p { font-size: 14px; line-height: 1.6; color: #94a3b8; margin: 0 0 20px 0; }
    .url-tag {
      display: inline-block;
      background: #020617;
      border: 1px solid #1e293b;
      padding: 6px 12px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      color: #38bdf8;
      word-break: break-all;
      margin-bottom: 18px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      justify-content: center;
    }
    button, a.btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 500;
      border-radius: 8px;
      border: 1px solid #334155;
      background: #1e293b;
      color: #f8fafc;
      cursor: pointer;
      text-decoration: none;
    }
    button:hover, a.btn:hover { background: #334155; }
    .primary {
      background: #2563eb;
      border-color: #2563eb;
    }
    .primary:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Automated Bot Protection Detected</h1>
    <div class="url-tag">${escapeHtml(targetUrl)}</div>
    <p>
      <strong>${escapeHtml(hostname)}</strong> presented a bot-verification challenge (Cloudflare / WAF) that blocks server-side proxy fetching. Try one of these options inside GhostBrowser:
    </p>
    <div class="actions">
      <button type="button" class="primary" onclick="window.parent.postMessage({ type: 'BROWSER_SWITCH_DIRECT' }, '*')">
        Try Direct Embed
      </button>
      <button type="button" onclick="window.parent.postMessage({ type: 'BROWSER_OPEN_READER' }, '*')">
        Try Reader Mode
      </button>
      <a class="btn" href="${escapeHtml(ddgSearchUrl)}">Search on DuckDuckGo</a>
      <a class="btn" href="${escapeHtml(archiveUrl)}">Archived Snapshot</a>
    </div>
  </div>
</body>
</html>`;
}

async function renderGoogleFallbackSearch(
  query: string,
  originalUrl: string,
  proxyOrigin: string
): Promise<string> {
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const ddgRes = await fetch(ddgUrl, {
    headers: getBrowserHeaders('https://html.duckduckgo.com/'),
    signal: AbortSignal.timeout(8000),
  });
  const ddgHtml = await ddgRes.text();
  const $ = cheerio.load(ddgHtml);

  const results: Array<{ title: string; url: string; displayUrl: string; snippet: string }> = [];
  $('.result').each((_, el) => {
    const link = $(el).find('a.result__a').first();
    const rawHref = link.attr('href') || '';
    let resolvedHref = rawHref;
    try {
      resolvedHref = unwrapRedirectUrl(new URL(rawHref, ddgUrl).href);
    } catch {
      // ignore
    }
    const title = link.text().trim();
    const snippet = $(el).find('.result__snippet').text().trim();
    const displayUrl = $(el).find('.result__url').text().trim() || resolvedHref;
    if (title && resolvedHref && !resolvedHref.includes('duckduckgo.com/y.js')) {
      results.push({ title, url: resolvedHref, displayUrl, snippet });
    }
  });

  const itemsHtml = results
    .map(
      (r) => `
      <div class="result-item">
        <div class="result-url">${escapeHtml(r.displayUrl)}</div>
        <a class="result-title" href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a>
        <p class="result-snippet">${escapeHtml(r.snippet)}</p>
      </div>
    `
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(query)} - Web Search</title>
  ${buildHelperScript(originalUrl, 'www.google.com', proxyOrigin)}
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #0b0f19;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .header {
      position: sticky;
      top: 0;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
      padding: 14px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .logo { font-weight: 700; font-size: 16px; color: #f8fafc; white-space: nowrap; }
    .search-box {
      flex: 1;
      max-width: 600px;
      display: flex;
      gap: 8px;
    }
    .search-box input {
      flex: 1;
      height: 36px;
      padding: 0 14px;
      border-radius: 8px;
      border: 1px solid #334155;
      background: #020617;
      color: #f8fafc;
      font-size: 13px;
      outline: none;
    }
    .search-box button {
      height: 36px;
      padding: 0 16px;
      border-radius: 8px;
      border: none;
      background: #2563eb;
      color: #fff;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
    .main {
      max-width: 740px;
      padding: 24px;
      margin: 0 auto;
    }
    .result-item { margin-bottom: 24px; }
    .result-url {
      font-size: 12px;
      color: #94a3b8;
      margin-bottom: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .result-title {
      display: inline-block;
      font-size: 18px;
      font-weight: 500;
      color: #60a5fa;
      text-decoration: none;
      margin-bottom: 4px;
    }
    .result-title:hover { text-decoration: underline; }
    .result-snippet {
      margin: 0;
      font-size: 14px;
      line-height: 1.55;
      color: #cbd5e1;
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="logo">Web Search</div>
    <form class="search-box" action="https://www.google.com/search" method="GET">
      <input type="text" name="q" value="${escapeHtml(query)}" placeholder="Search the web..." />
      <button type="submit">Search</button>
    </form>
  </header>
  <main class="main">
    ${itemsHtml || '<p>No results found. Try a different query.</p>'}
  </main>
</body>
</html>`;
}

export async function handleSuggest(req: Request, res: Response) {
  const q = req.query.q as string;
  if (!q || q.trim().length === 0) {
    return res.json({ suggestions: [] });
  }

  try {
    const ddgUrl = `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`;
    const response = await fetch(ddgUrl, {
      headers: { 'User-Agent': BROWSER_USER_AGENT },
      signal: AbortSignal.timeout(3000),
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && Array.isArray(data[1])) {
        return res.json({ suggestions: data[1].slice(0, 7) });
      }
    }
  } catch {
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=6&namespace=0&format=json`;
      const response = await fetch(wikiUrl, {
        headers: { 'User-Agent': 'GhostBrowser/1.0' },
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && Array.isArray(data[1])) {
          return res.json({ suggestions: data[1] });
        }
      }
    } catch {
      // Return empty on error
    }
  }

  return res.json({ suggestions: [] });
}

export async function handleReadability(req: Request, res: Response) {
  let targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  try {
    const response = await fetch(targetUrl, {
      headers: getBrowserHeaders(),
      signal: AbortSignal.timeout(8000),
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    $('script, style, noscript, iframe, svg, nav, footer, header, form, .ad, .ads, .sidebar, [role="banner"], [role="navigation"]').remove();

    const title = $('h1').first().text().trim() || $('title').text().trim() || 'Untitled Article';

    let contentEl = $('article, main, [role="main"], .post-content, .article-body, .entry-content, #content, .content').first();
    if (!contentEl.length) {
      contentEl = $('body');
    }

    const contentHtml = contentEl.html() || '';
    const textOnly = contentEl.text().replace(/\s+/g, ' ').trim();
    const wordCount = textOnly.split(/\s+/).length;
    const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    return res.json({
      title,
      url: targetUrl,
      wordCount,
      readTimeMinutes,
      content: contentHtml,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to extract article content' });
  }
}

export async function handleAsset(req: Request, res: Response) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    return res.status(204).end();
  }

  const rawUrl = req.query.url as string;
  const referer = (req.query.referer as string) || '';
  if (!rawUrl) {
    return res.status(400).send('Missing asset URL');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return res.status(400).send('Invalid asset URL');
  }

  const proxyOrigin = getProxyOrigin(req);
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 8500);
  res.on('close', () => {
    clearTimeout(timeoutId);
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  try {
    const headers: Record<string, string> = {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: req.headers.accept || '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: referer || parsedUrl.origin + '/',
    };
    if (req.headers['content-type']) {
      headers['Content-Type'] = req.headers['content-type'];
    }

    const fetchInit: RequestInit = {
      method: req.method,
      headers,
      redirect: 'follow',
      signal: controller.signal,
    };

    if (!['GET', 'HEAD'].includes(req.method) && req.body !== undefined) {
      if (typeof req.body === 'string') {
        fetchInit.body = req.body;
      } else if (headers['Content-Type']?.includes('application/x-www-form-urlencoded')) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(req.body)) {
          if (typeof v === 'string') p.append(k, v);
        }
        fetchInit.body = p.toString();
      } else if (Object.keys(req.body).length > 0) {
        fetchInit.body = JSON.stringify(req.body);
      }
    }

    const upstream = await fetch(rawUrl, fetchInit);
    clearTimeout(timeoutId);
    const finalAssetUrl = upstream.url || rawUrl;
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';

    res.status(upstream.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Type', contentType);

    const cacheControl = upstream.headers.get('cache-control');
    if (cacheControl) {
      res.setHeader('Cache-Control', cacheControl);
    }

    if (contentType.toLowerCase().includes('text/css')) {
      const cssText = await upstream.text();
      return res.send(rewriteCssUrls(cssText, finalAssetUrl, proxyOrigin));
    }

    if (req.method === 'HEAD' || !upstream.body) {
      return res.end();
    }

    return await pipeWebBodyToResponse(upstream, res);
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError' && !timedOut) {
      if (!res.writableEnded) res.end();
      return;
    }
    if (!res.headersSent) {
      return res.status(timedOut ? 504 : 502).send(timedOut ? 'Asset request timed out' : 'Asset fetch failed');
    }
  }
}

export async function handleMedia(req: Request, res: Response) {
  const rawUrl = req.query.url as string;
  const referer = (req.query.referer as string) || '';
  if (!rawUrl) {
    return res.status(400).send('Missing media URL');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return res.status(400).send('Invalid media URL');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 8500);
  res.on('close', () => {
    clearTimeout(timeoutId);
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  try {
    const headers: Record<string, string> = {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: req.headers.accept || '*/*',
    };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }
    if (referer) {
      headers['Referer'] = referer;
      try {
        headers['Origin'] = new URL(referer).origin;
      } catch {
        // ignore
      }
    } else {
      headers['Referer'] = parsedUrl.origin + '/';
    }

    const upstream = await fetch(rawUrl, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    res.status(upstream.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    const forwardHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
    ];
    for (const h of forwardHeaders) {
      const val = upstream.headers.get(h);
      if (val) res.setHeader(h, val);
    }
    if (!upstream.headers.get('accept-ranges')) {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    if (req.method === 'HEAD' || !upstream.body) {
      return res.end();
    }

    return await pipeWebBodyToResponse(upstream, res);
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError' && !timedOut) {
      if (!res.writableEnded) res.end();
      return;
    }
    if (!res.headersSent) {
      return res.status(timedOut ? 504 : 502).send(timedOut ? 'Media request timed out' : 'Media stream failed');
    }
  }
}

export async function handleProxy(req: Request, res: Response) {
  let targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).send('Missing target URL');
  }

  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  targetUrl = unwrapRedirectUrl(targetUrl);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return res.status(400).send(`Invalid URL format: ${targetUrl}`);
  }

  const proxyOrigin = getProxyOrigin(req);

  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Content-Security-Policy-Report-Only');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const yt = parseYouTubeUrl(targetUrl);
  if (yt) {
    try {
      if (yt.type === 'watch' && yt.videoId) {
        let title = 'YouTube Video';
        let author = 'YouTube';
        let related: YtVideoItem[] = [];

        const [oembedRes, watchRes] = await Promise.allSettled([
          fetch(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${yt.videoId}`)}&format=json`,
            { headers: { 'User-Agent': BROWSER_USER_AGENT }, signal: AbortSignal.timeout(4000) }
          ),
          fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(yt.videoId)}`, {
            headers: getBrowserHeaders(),
            signal: AbortSignal.timeout(6000),
          }),
        ]);

        if (oembedRes.status === 'fulfilled' && oembedRes.value.ok) {
          const meta = await oembedRes.value.json();
          if (meta?.title) title = meta.title;
          if (meta?.author_name) author = meta.author_name;
        }

        if (watchRes.status === 'fulfilled' && watchRes.value.ok) {
          const watchHtml = await watchRes.value.text();
          const ytData = extractJsonAfterMarker(watchHtml, /var\s+ytInitialData\s*=\s*\{/);
          if (ytData) {
            related = extractYtVideosFromData(ytData, 16).filter((v) => v.id !== yt.videoId);
          }
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(
          renderYouTubeShell({
            mode: 'watch',
            videoId: yt.videoId,
            title,
            author,
            videos: related,
            currentUrl: targetUrl,
            proxyOrigin,
          })
        );
      }

      const fetchUrl =
        yt.type === 'search' && yt.query
          ? `https://www.youtube.com/results?search_query=${encodeURIComponent(yt.query)}`
          : 'https://www.youtube.com/results?search_query=trending+videos';

      const ytRes = await fetch(fetchUrl, {
        headers: getBrowserHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      const ytHtml = await ytRes.text();
      const ytData = extractJsonAfterMarker(ytHtml, /var\s+ytInitialData\s*=\s*\{/);
      const videos = ytData ? extractYtVideosFromData(ytData, 24) : [];

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(
        renderYouTubeShell({
          mode: 'browse',
          searchQuery: yt.query || '',
          videos,
          currentUrl: targetUrl,
          proxyOrigin,
        })
      );
    } catch {
      if (yt.type === 'watch' && yt.videoId) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(
          renderYouTubeShell({
            mode: 'watch',
            videoId: yt.videoId,
            title: 'YouTube Video',
            videos: [],
            currentUrl: targetUrl,
            proxyOrigin,
          })
        );
      }
    }
  }

  const otherVideo = parseOtherVideoPlatform(targetUrl, req.headers.host || 'localhost');
  if (otherVideo) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(
      renderEmbedVideoShell({
        platform: otherVideo.platform,
        embedUrl: otherVideo.embedUrl,
        title: otherVideo.title,
        currentUrl: targetUrl,
        proxyOrigin,
      })
    );
  }

  try {
    const fetchHeaders = getBrowserHeaders(parsedUrl.origin + '/');
    const fetchOptions: RequestInit = {
      method: req.method === 'POST' ? 'POST' : 'GET',
      headers: fetchHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    };

    if (req.method === 'POST' && req.body && typeof req.body === 'object') {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(req.body)) {
        if (typeof v === 'string') params.append(k, v);
        else if (Array.isArray(v)) v.forEach((item) => params.append(k, String(item)));
      }
      fetchHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchOptions.body = params.toString();
    }

    const response = await fetch(targetUrl, fetchOptions);
    const finalUrl = unwrapRedirectUrl(response.url || targetUrl);
    const finalParsed = new URL(finalUrl);
    const contentType = (response.headers.get('content-type') || 'text/html').toLowerCase();

    if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(renderDirectMediaPlayer(finalUrl, contentType, proxyOrigin));
    }

    if (contentType.includes('application/pdf') && response.body) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      return await pipeWebBodyToResponse(response, res);
    }

    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
      const rawHtml = await response.text();

      if (
        finalParsed.hostname.includes('google.') &&
        finalParsed.pathname === '/search' &&
        rawHtml.includes('/httpservice/retry/enablejs') &&
        !rawHtml.includes('<h3')
      ) {
        const q = finalParsed.searchParams.get('q') || '';
        if (q) {
          const fallbackHtml = await renderGoogleFallbackSearch(q, finalUrl, proxyOrigin);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.send(fallbackHtml);
        }
      }

      if (isBotChallengePage(response.status, rawHtml)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(
          renderBotBlockRecoveryPage(finalUrl, finalParsed.hostname, proxyOrigin)
        );
      }

      const $ = cheerio.load(rawHtml);

      $('meta[http-equiv="Content-Security-Policy" i]').remove();
      $('meta[http-equiv="X-Frame-Options" i]').remove();

      let metaRefreshTarget: string | null = null;
      $('meta[http-equiv="refresh" i]').each((_, el) => {
        if ($(el).closest('noscript').length > 0) return;
        const content = $(el).attr('content') || '';
        const match = content.match(/url\s*=\s*['"]?([^'";]+)['"]?/i);
        if (match && match[1]) {
          try {
            metaRefreshTarget = unwrapRedirectUrl(new URL(match[1].trim(), finalUrl).href);
          } catch {
            // ignore
          }
        }
        $(el).remove();
      });

      if (!$('head').length) {
        $('html').prepend('<head></head>');
      }

      $('a[target], form[target], area[target], base[target]').removeAttr('target');
      $('script[integrity], link[integrity]').removeAttr('integrity');
      $('script[crossorigin], link[crossorigin]').removeAttr('crossorigin');

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
        try {
          const abs = new URL(href, finalUrl).href;
          const unwrapped = unwrapRedirectUrl(abs);
          if (unwrapped !== abs) {
            $(el).attr('href', unwrapped);
          }
        } catch {
          // ignore
        }
      });

      $('video[src], audio[src], source[src]').each((_, el) => {
        const src = $(el).attr('src');
        if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;
        try {
          const abs = new URL(src, finalUrl).href;
          $(el).attr(
            'src',
            `${proxyOrigin}/api/media?url=${encodeURIComponent(abs)}&referer=${encodeURIComponent(finalUrl)}`
          );
        } catch {
          // ignore
        }
      });
      $('video').attr('playsinline', '');

      $('iframe[src]').each((_, el) => {
        const src = $(el).attr('src');
        if (!src || src.startsWith('data:') || src.startsWith('about:')) return;
        try {
          const abs = new URL(src, finalUrl).href;
          $(el).attr(
            'allow',
            'autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope; web-share'
          );
          $(el).attr('allowfullscreen', 'true');
          if (isKnownEmbedFrame(abs)) {
            $(el).attr('src', abs);
          } else {
            $(el).attr('src', `${proxyOrigin}/api/proxy?url=${encodeURIComponent(abs)}`);
          }
        } catch {
          // ignore
        }
      });

      $('head base').remove();
      const helperScript = buildHelperScript(finalUrl, finalParsed.hostname, proxyOrigin);
      const metaRedirectScript = metaRefreshTarget
        ? `<script>window.parent.postMessage({ type: 'BROWSER_NAVIGATE', url: ${JSON.stringify(metaRefreshTarget)} }, '*');</script>`
        : '';

      $('head').prepend(`<base href="${escapeHtml(finalUrl)}">${helperScript}${metaRedirectScript}`);

      $('script').each((_, el) => {
        if ($(el).attr('id') === 'ghost-browser-helper') return;
        const content = $(el).html() || '';
        if (
          content.includes('top.location') ||
          content.includes('window.top') ||
          content.includes('parent.location')
        ) {
          const neutralized = content
            .replace(/top\.location(\.[a-zA-Z]+)?\s*=/g, 'void 0;')
            .replace(/parent\.location(\.[a-zA-Z]+)?\s*=/g, 'void 0;')
            .replace(/window\.top\s*!==\s*window\.self/g, 'false')
            .replace(/top\s*!==\s*self/g, 'false');
          $(el).html(neutralized);
        }
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send($.html());
    } else {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (response.body) {
        return await pipeWebBodyToResponse(response, res);
      }
      const arrayBuffer = await response.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    }
  } catch (err: any) {
    console.error('Proxy fetch error for', targetUrl, err);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Navigation Error</title>
        ${buildHelperScript(targetUrl, parsedUrl.hostname, proxyOrigin)}
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #0f172a;
            color: #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 24px;
            box-sizing: border-box;
          }
          .card {
            max-width: 480px;
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 12px;
            padding: 32px;
            text-align: center;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.4);
          }
          h1 { font-size: 20px; font-weight: 600; margin: 0 0 12px 0; color: #f8fafc; }
          p { font-size: 14px; line-height: 1.6; color: #94a3b8; margin: 0 0 20px 0; }
          .url-tag {
            display: inline-block;
            background: #0f172a;
            padding: 6px 12px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 12px;
            color: #38bdf8;
            word-break: break-all;
            margin-bottom: 20px;
          }
          .actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
          button {
            background: #2563eb;
            color: white;
            border: none;
            padding: 10px 18px;
            font-size: 13px;
            font-weight: 500;
            border-radius: 8px;
            cursor: pointer;
          }
          button.secondary { background: #334155; }
          button:hover { opacity: 0.9; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Unable to load website</h1>
          <div class="url-tag">${escapeHtml(targetUrl)}</div>
          <p>${escapeHtml(err.message || 'The server could not connect to the remote host. The site may be down or blocking proxy connections.')}</p>
          <div class="actions">
            <button onclick="window.location.reload()">Retry Connection</button>
            <button class="secondary" onclick="window.parent.postMessage({ type: 'BROWSER_SWITCH_DIRECT' }, '*')">Try Direct Embed</button>
          </div>
        </div>
      </body>
      </html>
    `);
  }
}

export function createVercelRouteApp(handler: (req: Request, res: Response) => Promise<any>) {
  const app = express();
  app.set('trust proxy', true);
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.body !== undefined || !req.readable) {
      return next();
    }
    express.json()(req, res, (err) => {
      if (err) return next(err);
      if (req.body !== undefined || !req.readable) return next();
      express.urlencoded({ extended: true })(req, res, next);
    });
  });
  app.all('*', (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  });
  app.use((err: any, _req: Request, res: Response, _next: any) => {
    console.error('Unhandled route error:', err);
    if (!res.headersSent) {
      res.status(500).send(err?.message || 'Internal Server Error');
    } else if (!res.writableEnded) {
      res.end();
    }
  });
  return app;
}
