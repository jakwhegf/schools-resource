// Shell only (index.html + main.js): pass ?item= / ?mode= / ?file= params.
// H5 + SWF assets always loaded from R2 via CDN (default):
//   H5:  ?item=folder&mode=html  → .../ubgx/h5/{item}/index.html
//   SWF: ?mode=flash&file=game.swf → .../ubgx/swf/game.swf
//   Also accepts broken links like ?mode=flash&game.swf (file name only as param).
// Optional ?storage=github for testing H5 files from the repo (not for production).
const H5_PAGES_BASE = "https://jakwhegf.github.io/schools-resource";

// SWF: R2 via CDN (Worker /ubgx/*). Set R2_BUCKET if using S3 API endpoint.
const R2_DOMAIN = "https://ubgx.me";
const R2_BUCKET = "";

/** SWF keys under ubgx/swf/… on R2/CDN; H5 at ubgx/h5/… */
const R2_SWF_PREFIX = "ubgx/swf";
const R2_H5_PREFIX = "ubgx/h5";

/** Default H5 from R2/CDN (shell can be GitHub Pages or cdn.ubgx.me). */
const H5_DEFAULT_STORAGE = "r2";

/** r2 | github — H5 iframe source */
function resolveH5IframeSrc(resourceId, urlParams) {
  const raw = (urlParams.get("storage") || urlParams.get("from") || H5_DEFAULT_STORAGE)
    .trim()
    .toLowerCase();
  if (raw === "github" || raw === "pages" || raw === "gh") {
    return h5IndexUrl(resourceId);
  }
  const prefix = R2_H5_PREFIX.replace(/^\/+|\/+$/g, "");
  return r2PublicUrl(`${prefix}/${resourceId}/index.html`);
}

function parseFlexibleQuery(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/^#+/u, "")
    .replace(/^\?+/u, "");
  return new URLSearchParams(s);
}

/**
 * Fix URLs like ?mode=flash&10-is-again.swf (missing file=) — browser treats
 * "10-is-again.swf" as a param name, not the file value.
 */
function normalizeBareSwfFilenameParams(params) {
  const fileVal = (params.get("file") || "").trim();
  if (fileVal && !fileVal.includes("..")) return params;
  let bareKey = null;
  for (const key of params.keys()) {
    if (!/\.swf$/i.test(key)) continue;
    if (key.includes("..") || key.includes("/") || key.includes("\\")) continue;
    const v = (params.get(key) || "").trim();
    if (v !== "" && v !== "1" && v !== "true") continue;
    bareKey = key;
    break;
  }
  if (!bareKey) return params;
  const next = new URLSearchParams(params);
  next.set("file", bareKey);
  next.delete(bareKey);
  if (!(next.get("mode") || "").trim() && !(next.get("type") || "").trim()) {
    next.set("mode", "flash");
  }
  return next;
}

/** Google Sites: ?query may be duplicated or lost → fallback to hash */
function bootstrapUrlParams() {
  const search = normalizeBareSwfFilenameParams(parseFlexibleQuery(window.location.search));
  if ([...search.keys()].length > 0) return search;
  const hash = window.location.hash.replace(/^#+/u, "").trim();
  if (hash.includes("=")) {
    try {
      return normalizeBareSwfFilenameParams(parseFlexibleQuery(hash));
    } catch {
      /* ignore */
    }
  }
  return search;
}

function r2PublicUrl(relativeKey) {
  const key = String(relativeKey).replace(/^\/+/, "").replace(/\/+$/, "");
  const base = R2_DOMAIN.replace(/\/+$/, "");
  const bucket = R2_BUCKET.replace(/^\/+|\/+$/g, "");
  const bucketSeg = bucket ? `${bucket}/` : "";
  const encodedPath = key.split("/").map((seg) => encodeURIComponent(seg)).join("/");
  return `${base}/${bucketSeg}${encodedPath}`;
}

/** Returns "h5" | "swf" from mode/type param. */
function resolvePlaybackKind(urlParams) {
  const raw = (
    urlParams.get("mode") ||
    urlParams.get("type") ||
    "html"
  )
    .trim()
    .toLowerCase();
  if (raw === "flash" || raw === "swf") return "swf";
  if (raw === "html" || raw === "page" || raw === "web" || raw === "h5" || raw === "html5") return "h5";
  return "h5";
}

/** item → slug → id; for SWF can also pass file=name.swf (stem becomes item). */
function resolveResourceId(urlParams) {
  let v =
    urlParams.get("item") ||
    urlParams.get("slug") ||
    urlParams.get("id");
  if (!v || !String(v).trim()) {
    const rawFile = (urlParams.get("file") || "").trim();
    const mode = (urlParams.get("mode") || urlParams.get("type") || "").toLowerCase();
    const swfMode = mode === "flash" || mode === "swf";
    if (swfMode && /\.swf$/i.test(rawFile) && !rawFile.includes("..")) {
      const base = rawFile.replace(/^.*[/\\]/, "").replace(/\.swf$/i, "");
      if (base) v = base;
    }
  }
  if (!v) return "";
  v = String(v).trim();
  try {
    if (/%[0-9A-Fa-f]{2}/.test(v)) {
      v = decodeURIComponent(v.replace(/\+/g, " "));
    }
  } catch {
    /* keep as-is */
  }
  return v;
}

function swfFilenameFromParams(urlParams, resourceId) {
  const fallback = `${String(resourceId).replace(/[/\\]/g, "")}.swf`;
  const raw = (urlParams.get("file") || fallback).trim();
  const base = raw.replace(/^.*[/\\]/, "");
  if (!base || base.includes("..")) return fallback;
  return /\.swf$/i.test(base) ? base : `${base}.swf`;
}

function showError(container, message) {
  container.innerHTML = `<h2 class="error-msg">${message}</h2>`;
}

function h5IndexUrl(resourceId) {
  const base = H5_PAGES_BASE.replace(/\/+$/, "");
  const segs = String(resourceId)
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(encodeURIComponent);
  if (!segs.length) return `${base}/`;
  return `${base}/${segs.join("/")}/index.html`;
}

function mountHtml5Embed(container, resourceId, urlParams) {
  const url = resolveH5IframeSrc(resourceId, urlParams);
  const iframe = document.createElement("iframe");
  iframe.className = "schools-embed-frame";
  iframe.src = url;
  iframe.setAttribute("allowfullscreen", "true");
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
  iframe.setAttribute("title", "Schools resource");
  iframe.setAttribute("loading", "lazy");
  container.appendChild(iframe);
}

/** Iframe to /e/swf on the SWF origin: same document origin as the file helps SWFs with site-lock / domain checks. */
function mountSwfEmbed(container, resourceId, urlParams) {
  const prefix = R2_SWF_PREFIX.replace(/^\/+|\/+$/g, "");
  const swfName = swfFilenameFromParams(urlParams, resourceId);
  const swfUrl = r2PublicUrl(`${prefix}/${swfName}`);
  let origin;
  try {
    origin = new URL(swfUrl).origin;
  } catch {
    origin = R2_DOMAIN.replace(/\/+$/, "");
  }
  const pathOnly = `${prefix}/${swfName}`.replace(/^\/+/, "");
  const iframe = document.createElement("iframe");
  iframe.className = "schools-embed-frame";
  iframe.src = `${origin}/e/swf?p=${encodeURIComponent(pathOnly)}`;
  iframe.setAttribute("allowfullscreen", "true");
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
  iframe.setAttribute("title", "Schools resource");
  iframe.setAttribute("loading", "lazy");
  container.appendChild(iframe);
}

// Block empty shell (no resource). Allow with ?item= / ?file=.swf in both tab and iframe.
const urlParams = bootstrapUrlParams();
const resourceId = resolveResourceId(urlParams);
const kind = resolvePlaybackKind(urlParams);
const container = document.getElementById("schools-resource-container");

if (window.self === window.top && !resourceId) {
  document.body.innerHTML =
    '<h2 class="error-msg">Access denied. Open via a resource link (?item=…) or embed in an iframe.</h2>';
  window.stop?.();
} else if (!resourceId) {
  showError(
    container,
    "Error: Missing resource ID. Example: ?item=resource-name&mode=html or ?mode=flash&file=resource.swf"
  );
} else if (kind === "swf") {
  mountSwfEmbed(container, resourceId, urlParams);
} else {
  mountHtml5Embed(container, resourceId, urlParams);
}
