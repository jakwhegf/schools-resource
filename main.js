// URL gợi ý (mode=html mặc định lấy H5 từ R2/CDN; game trong repo thì thêm storage=github):
//   R2 H5:     ?item=among-us-online_v2&mode=html
//   GitHub H5: ?item=my-folder&mode=html&storage=github  → repo: my-folder/index.html
//   SWF:       ?item=myflash&mode=flash&file=myflash.swf
//
// HTML5: cùng cấu trúc thư mục trong repo (vd. among-us-online_v2/index.html)
// Muốn qua CDN Worker: đổi thành "https://cdn.ubgx.me" (path vẫn /{item}/index.html)
const H5_PAGES_BASE = "https://jakwhegf.github.io/schools-resource";

// SWF: R2 qua CDN (Worker /ubgx/*). Nếu dùng endpoint S3 API, điền R2_BUCKET.
const R2_DOMAIN = "https://cdn.ubgx.me";
const R2_BUCKET = "";

const R2_SWF_PREFIX = "ubgx/swf";
const R2_H5_PREFIX = "ubgx/h5";

/** Mặc định "r2" vì H5 thường nằm bucket; đổi "github" nếu toàn bộ game chỉ trên Pages. */
const H5_DEFAULT_STORAGE = "r2";

/** r2 | github — nguồn iframe H5 (chỉ Pages: ?storage=github) */
function resolveH5IframeSrc(resourceId, urlParams) {
  const raw = (urlParams.get("storage") || urlParams.get("from") || H5_DEFAULT_STORAGE)
    .trim()
    .toLowerCase();
  if (raw === "github" || raw === "pages" || raw === "gh") {
    return h5IndexUrl(resourceId);
  }
  const prefix = R2_H5_PREFIX.replace(/^\/+|\/+$/g, "");
  return r2PublicUrl(`${prefix}/${resourceId}/index.html`);
const RUFFLE_SCRIPT = "https://unpkg.com/@ruffle-rs/ruffle";

/** Google Sites đôi khi làm mất ?query trên URL iframe; hỗ trợ #item=...&mode=html */
function bootstrapUrlParams() {
  const search = new URLSearchParams(window.location.search);
  if ([...search.keys()].length > 0) return search;
  const hash = window.location.hash.replace(/^#/, "").trim();
  if (hash.includes("=")) {
    try {
      return new URLSearchParams(hash);
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

/** Trả về "h5" | "swf" từ mode/type mới hoặc cũ. */
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

/** Ưu tiên item → slug → id (tương thích link cũ). */
function resolveResourceId(urlParams) {
  const v =
    urlParams.get("item") ||
    urlParams.get("slug") ||
    urlParams.get("id");
  return (v && String(v).trim()) || "";
}

function swfFilenameFromParams(urlParams, resourceId) {
  const fallback = `${String(resourceId).replace(/[/\\]/g, "")}.swf`;
  const raw = (urlParams.get("file") || fallback).trim();
  const base = raw.replace(/^.*[/\\]/, "");
  if (!base || base.includes("..")) return fallback;
  return /\.swf$/i.test(base) ? base : `${base}.swf`;
}

function loadRuffleScript() {
  return new Promise((resolve, reject) => {
    if (typeof window.RufflePlayer?.newest === "function") {
      resolve();
      return;
    }
    window.RufflePlayer = window.RufflePlayer || {};
    window.RufflePlayer.config = {
      autoplay: "on",
      letterbox: "on",
      unmuteOverlay: "hidden",
    };
    const s = document.createElement("script");
    s.src = RUFFLE_SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Không tải được Ruffle (cần để phát SWF)."));
    document.head.appendChild(s);
  });
}

async function ensureRuffleReady() {
  await loadRuffleScript();
  for (let i = 0; i < 80; i++) {
    if (typeof window.RufflePlayer?.newest === "function") return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Ruffle không khởi tạo được.");
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

async function mountSwfEmbed(container, resourceId, urlParams) {
  const prefix = R2_SWF_PREFIX.replace(/^\/+|\/+$/g, "");
  const swfName = swfFilenameFromParams(urlParams, resourceId);
  const swfUrl = r2PublicUrl(`${prefix}/${resourceId}/${swfName}`);

  await ensureRuffleReady();
  const ruffle = window.RufflePlayer.newest();
  const player = ruffle.createPlayer();
  player.className = "schools-embed-ruffle";
  container.appendChild(player);
  await player.load({
    url: swfUrl,
    autoplay: "on",
    letterbox: "on",
  });
}

// 1. KHÓA BẢO MẬT: Kiểm tra xem có nằm trong Iframe của Google Sites không?
if (window.self === window.top) {
  document.body.innerHTML =
    '<h2 class="error-msg">Truy cập bị từ chối. Vui lòng vào trang web chính thức!</h2>';
  window.stop();
} else {
  const urlParams = bootstrapUrlParams();
  const resourceId = resolveResourceId(urlParams);
  const kind = resolvePlaybackKind(urlParams);
  const container = document.getElementById("schools-resource-container");

  if (!resourceId) {
    showError(
      container,
      "Lỗi: Thiếu định danh. Ví dụ: ?item=ten-game&mode=html (R2) hoặc &storage=github nếu game trong repo."
    );
  } else if (kind === "swf") {
    mountSwfEmbed(container, resourceId, urlParams).catch((err) => {
      console.error(err);
      container.replaceChildren();
      showError(container, err.message || "Không mở được nội dung SWF.");
    });
  } else {
    mountHtml5Embed(container, resourceId, urlParams);
  }
}
