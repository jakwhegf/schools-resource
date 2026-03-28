// URL gợi ý: ?item=slope&mode=html  |  ?item=myflash&mode=flash&file=myflash.swf
// mode: html (mặc định) = H5, flash = SWF qua Ruffle. Alias cũ: ?id= &type=
//
// R2 qua CDN (Worker phục vụ prefix /ubgx/* trên cùng host). Fallback: endpoint .r2.cloudflarestorage.com + R2_BUCKET.
const R2_DOMAIN = "https://cdn.ubgx.me";

// Chỉ dùng khi R2_DOMAIN là S3 API (…r2.cloudflarestorage.com): điền tên bucket. Với cdn.ubgx.me để trống.
const R2_BUCKET = "";

// Tiền tố thư mục nội dung trên bucket (ubgx/h5 = HTML, ubgx/swf = SWF)
const R2_RESOURCE_PREFIXES = {
  h5: "ubgx/h5",
  swf: "ubgx/swf",
};

const RUFFLE_SCRIPT = "https://unpkg.com/@ruffle-rs/ruffle";

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

function mountHtml5Embed(container, resourceId) {
  const prefix = R2_RESOURCE_PREFIXES.h5.replace(/^\/+|\/+$/g, "");
  const url = r2PublicUrl(`${prefix}/${resourceId}/index.html`);
  const iframe = document.createElement("iframe");
  iframe.className = "schools-embed-frame";
  iframe.src = url;
  iframe.setAttribute("allowfullscreen", "true");
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("title", "Schools resource");
  container.appendChild(iframe);
}

async function mountSwfEmbed(container, resourceId, urlParams) {
  const prefix = R2_RESOURCE_PREFIXES.swf.replace(/^\/+|\/+$/g, "");
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
  const urlParams = new URLSearchParams(window.location.search);
  const resourceId = resolveResourceId(urlParams);
  const kind = resolvePlaybackKind(urlParams);
  const container = document.getElementById("schools-resource-container");

  if (!resourceId) {
    showError(
      container,
      "Lỗi: Thiếu định danh. Ví dụ: ?item=slope&mode=html hoặc ?slug=slope&mode=flash"
    );
  } else if (kind === "swf") {
    mountSwfEmbed(container, resourceId, urlParams).catch((err) => {
      console.error(err);
      container.replaceChildren();
      showError(container, err.message || "Không mở được nội dung SWF.");
    });
  } else {
    mountHtml5Embed(container, resourceId);
  }
}
