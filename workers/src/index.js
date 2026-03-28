/**
 * cdn.ubgx.me — proxy GitHub Pages + object R2 (prefix /ubgx/) + webhook.
 *
 * GET/HEAD /ubgx/*     → bucket R2 (binding SCHOOLS_R2), key = path bỏ dấu / đầu
 * GET/HEAD /* khác    → jakwhegf.github.io + GITHUB_PAGES_PREFIX
 * POST /github/webhook → đồng bộ (purge cache tuỳ chọn)
 */

const WEBHOOK_PATH = "/github/webhook";
const R2_URL_PREFIX = "/ubgx/";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === WEBHOOK_PATH && request.method === "POST") {
      return handleSync(request, env);
    }

    /** R2: cho phép preflight nếu bucket CORS chưa đủ */
    if (url.pathname.startsWith(R2_URL_PREFIX) && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: r2CorsHeaders(request) });
    }

    if (url.pathname.startsWith(R2_URL_PREFIX) && (request.method === "GET" || request.method === "HEAD")) {
      return serveFromR2(request, env, url);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    return proxyGitHubPages(request, env, url);
  },
};

/** R2 chỉ có object key: /ubgx/h5/foo/ hoặc .../foo → thử thêm /index.html */
function buildR2KeyCandidates(pathname) {
  const key = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!key) return [];
  const last = key.split("/").pop() || "";
  const looksLikeFile = last.includes(".");

  const out = [key];
  if (!looksLikeFile) out.push(`${key}/index.html`);
  return [...new Set(out)];
}

/**
 * Khi upload R2 lệch tiền tố (vd. chỉ h5/... hoặc chỉ ten-game/... ở root bucket),
 * thử bỏ dần ubgx/ hoặc ubgx/h5|swf/
 */
function expandR2KeyCandidates(pathname) {
  const primary = buildR2KeyCandidates(pathname);
  const alt = [];
  for (const k of primary) {
    if (k.startsWith("ubgx/h5/") || k.startsWith("ubgx/swf/")) {
      alt.push(k.slice("ubgx/".length));
    }
    if (k.startsWith("ubgx/h5/")) {
      alt.push(k.slice("ubgx/h5/".length));
    }
    if (k.startsWith("ubgx/swf/")) {
      alt.push(k.slice("ubgx/swf/".length));
    }
  }
  const all = [...primary, ...alt];
  return [...new Set(all)];
}

/**
 * Construct / export HTML hay dùng tên file có dấu cách; upload R2 đôi khi đổi thành _ hoặc key chứa %20 literal.
 */
function r2KeySpaceVariants(key) {
  const out = new Set([key]);
  const parts = key.split("/");
  const last = parts[parts.length - 1];
  if (!last) return [...out];
  const dir = parts.slice(0, -1).join("/");
  const pfx = dir ? `${dir}/` : "";

  if (last.includes(" ")) {
    out.add(pfx + last.replace(/ /g, "_"));
    out.add(pfx + last.replace(/ /g, "%20"));
    out.add(pfx + last.replace(/ /g, "+"));
  }
  const audioExt = /\.(ogg|mp3|wav|m4a|opus|weba|aac)$/i;
  if (audioExt.test(last) && last.includes("_")) {
    out.add(pfx + last.replace(/_/g, " "));
  }

  return [...out];
}

async function serveFromR2(request, env, url) {
  if (!env.SCHOOLS_R2) {
    return new Response("R2 binding SCHOOLS_R2 chưa cấu hình trong Worker.", { status: 503 });
  }

  const candidates = expandR2KeyCandidates(url.pathname);
  if (!candidates.length) {
    return new Response("Not Found", { status: 404, headers: r2CorsHeaders(request) });
  }

  for (const r2Key of candidates) {
    for (const variant of r2KeySpaceVariants(r2Key)) {
      if (request.method === "HEAD") {
        const head = await env.SCHOOLS_R2.head(variant);
        if (head) {
          return new Response(null, { status: 200, headers: r2ObjectHeaders(head, variant, request) });
        }
      } else {
        const obj = await env.SCHOOLS_R2.get(variant);
        if (obj) {
          const headers = r2ObjectHeaders(obj, variant, request);
          headers.set("Cache-Control", "public, max-age=86400");
          return new Response(obj.body, { status: 200, headers });
        }
      }
    }
  }

  return new Response("Not Found", { status: 404, headers: r2CorsHeaders(request) });
}

function r2ObjectHeaders(obj, key, request) {
  const headers = new Headers();
  const fromMeta = (obj.httpMetadata?.contentType || "").trim();
  const guessed = guessContentType(key);
  let ct = fromMeta || guessed;

  /** R2 hay để octet-stream / text/plain → module script & import bị chặn theo HTML spec */
  const metaUntrusted =
    !fromMeta ||
    fromMeta === "binary/octet-stream" ||
    fromMeta === "application/octet-stream" ||
    /\boctet-stream\b/i.test(fromMeta) ||
    (fromMeta === "text/plain" && guessed !== "application/octet-stream");

  if (metaUntrusted && guessed !== "application/octet-stream") {
    ct = guessed;
  }

  if (ct) headers.set("Content-Type", ct);
  if (obj.size != null) headers.set("Content-Length", String(obj.size));
  if (obj.etag) headers.set("ETag", obj.etag);
  /** Cho phép nhúng game H5 trong iframe (Google Sites / domain khác) */
  if ((ct || "").toLowerCase().includes("text/html")) {
    headers.set("Content-Security-Policy", "frame-ancestors *");
  }
  r2CorsHeaders(request).forEach((value, name) => headers.set(name, value));
  return headers;
}

function r2CorsHeaders(request) {
  const origin = request.headers.get("Origin");
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", origin || "*");
  h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  h.set("Access-Control-Allow-Headers", "*");
  h.set("Access-Control-Max-Age", "86400");
  if (origin) h.append("Vary", "Origin");
  return h;
}

function guessContentType(key) {
  const lower = key.toLowerCase();
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "application/javascript; charset=utf-8";
  }
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".swf")) return "application/x-shockwave-flash";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".wasm")) return "application/wasm";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".weba")) return "audio/webm";
  if (lower.endsWith(".aac")) return "audio/aac";
  return "application/octet-stream";
}

async function proxyGitHubPages(request, env, url) {
  const host = env.GITHUB_PAGES_HOST || "jakwhegf.github.io";
  const prefix = normalizePrefix(env.GITHUB_PAGES_PREFIX || "/schools-resource");
  const pathname = url.pathname || "/";
  const pathPart = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const ghPath = prefix ? `${prefix}${pathPart}` : pathPart;
  const ghUrl = `https://${host}${ghPath}${url.search}`;

  const ghRes = await fetch(ghUrl, {
    method: request.method,
    headers: scrubRequestHeaders(request.headers),
    cf: { cacheEverything: true },
  });

  return new Response(ghRes.body, {
    status: ghRes.status,
    statusText: ghRes.statusText,
    headers: scrubResponseHeaders(ghRes.headers, env),
  });
}

function normalizePrefix(p) {
  const s = String(p ?? "").trim().replace(/\/+$/, "");
  if (!s) return "";
  return s.startsWith("/") ? s : `/${s}`;
}

function scrubRequestHeaders(h) {
  const out = new Headers();
  const hop = ["host", "connection", "content-length", "transfer-encoding", "cf-connecting-ip"];
  for (const [k, v] of h) {
    if (!hop.includes(k.toLowerCase())) out.set(k, v);
  }
  return out;
}

function scrubResponseHeaders(h, env) {
  const out = new Headers(h);
  const base = (env.PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  if (base) {
    const loc = out.get("Location");
    if (loc && loc.includes("github.io")) {
      try {
        const u = new URL(loc);
        const prefix = normalizePrefix(env.GITHUB_PAGES_PREFIX || "/schools-resource");
        const host = env.GITHUB_PAGES_HOST || "jakwhegf.github.io";
        if (u.hostname === host && (!prefix || u.pathname.startsWith(prefix))) {
          const rest = prefix ? u.pathname.slice(prefix.length) || "/" : u.pathname || "/";
          out.set("Location", `${base}${rest}${u.search}`);
        }
      } catch {
        /* giữ nguyên */
      }
    }
  }
  out.delete("set-cookie");
  return out;
}

async function handleSync(request, env) {
  const okSecret = await verifySyncAuth(request, env);
  if (!okSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let purge = { ok: false, skipped: true, detail: "" };
  if (env.CF_ZONE_ID && env.CF_API_TOKEN) {
    purge = await purgeZoneCache(env);
  } else {
    purge = { ok: true, skipped: true, detail: "Chưa cấu hình CF_ZONE_ID/CF_API_TOKEN" };
  }

  return Response.json({
    ok: true,
    at: new Date().toISOString(),
    purge,
    hint: "Sau purge, cdn.ubgx.me sẽ lấy bản mới từ GitHub Pages / edge.",
  });
}

async function verifySyncAuth(request, env) {
  const syncToken = env.SYNC_TOKEN;
  const webhookSecret = env.WEBHOOK_SECRET;

  if (syncToken) {
    const auth = request.headers.get("Authorization");
    const bearer = auth && auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const headerTok = request.headers.get("X-Sync-Token");
    if (bearer === syncToken || headerTok === syncToken) return true;
  }

  if (webhookSecret) {
    const sig = request.headers.get("X-Hub-Signature-256");
    if (sig) {
      const body = await request.clone().arrayBuffer();
      const expected = await githubHmacHex(body, webhookSecret);
      if (timingSafeEqualStr(sig, `sha256=${expected}`)) return true;
    }
  }

  return false;
}

async function githubHmacHex(body, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, body);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function purgeZoneCache(env) {
  const zoneId = env.CF_ZONE_ID;
  const token = env.CF_API_TOKEN;
  const publicBase = (env.PUBLIC_SITE_URL || "https://cdn.ubgx.me").replace(/\/+$/, "");

  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      files: [
        `${publicBase}/`,
        `${publicBase}/index.html`,
        `${publicBase}/main.js`,
        `${publicBase}/stylist.css`,
      ],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, skipped: false, status: res.status, detail: data };
  }
  return { ok: true, skipped: false, detail: data.result || data };
}
