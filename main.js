// GitHub Pages chỉ host shell (index.html + main.js): truyền ?item= / ?mode= / ?file=.
// Game H5 + SWF thực tế luôn lấy từ R2 qua CDN (mặc định):
//   H5: ?item=folder&mode=html → https://cdn.ubgx.me/ubgx/h5/{item}/index.html
//   Worker chèn <base href="…/ubgx/h5/{item}/"> vào index.html để đường dẫn tương đối (data/, assets/) đúng.
//   Nếu game vẫn lỗi: kiểm tra chỗ dùng đường dẫn tuyệt đối kiểu "/file.json" (sẽ gọi nhầm gốc host, phải đổi thành tương đối hoặc full URL trong /ubgx/h5/...).
//   SWF: ?mode=flash&file=game.swf → …/ubgx/…/game.swf
// Tùy chọn ?storage=github chỉ khi test file H5 tạm trên repo (không dùng cho production).
const H5_PAGES_BASE = "https://jakwhegf.github.io/schools-resource";

// SWF: R2 qua CDN (Worker /ubgx/*). Nếu dùng endpoint S3 API, điền R2_BUCKET.
const R2_DOMAIN = "https://cdn.ubgx.me";
const R2_BUCKET = "";

/** .swf cùng cấp URL /ubgx/ với /ubgx/h5/… — key R2 chỉ là tên file .swf */
const R2_SWF_PREFIX = "ubgx";
const R2_H5_PREFIX = "ubgx/h5";

/** Mặc định H5 từ R2/CDN (shell có thể là GitHub Pages hoặc cdn.ubgx.me). */
const H5_DEFAULT_STORAGE = "r2";

/** r2 | github — iframe H5 */
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

const RUFFLE_SCRIPT = "https://unpkg.com/@ruffle-rs/ruffle";

function parseFlexibleQuery(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/^#+/u, "")
    .replace(/^\?+/u, "");
  return new URLSearchParams(s);
}

/** Google Sites: ?query bị đôi hoặc mất → dùng hash */
function bootstrapUrlParams() {
  const search = parseFlexibleQuery(window.location.search);
  if ([...search.keys()].length > 0) return search;
  const hash = window.location.hash.replace(/^#+/u, "").trim();
  if (hash.includes("=")) {
    try {
      return parseFlexibleQuery(hash);
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

/** item → slug → id; với SWF có thể chỉ truyền file=ten.swf (suy stem làm item). */
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
    /* giữ nguyên */
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
  const swfUrl = r2PublicUrl(`${prefix}/${swfName}`);

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

// Chặn mở trang shell trống (không có game). Có ?item= / ?file=.swf thì cho chạy cả trong tab và iframe.
const urlParams = bootstrapUrlParams();
const resourceId = resolveResourceId(urlParams);
const kind = resolvePlaybackKind(urlParams);
const container = document.getElementById("schools-resource-container");

if (window.self === window.top && !resourceId) {
  document.body.innerHTML =
    '<h2 class="error-msg">Truy cập bị từ chối. Mở qua liên kết game (có ?item=…) hoặc nhúng iframe.</h2>';
  window.stop?.();
} else if (!resourceId) {
  showError(
    container,
    "Lỗi: Thiếu định danh. Ví dụ: ?item=ten-game&mode=html hoặc ?mode=flash&file=game.swf"
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
