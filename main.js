// Public R2 (S3 endpoint — thường cần kèm tên bucket trong path, xem R2_BUCKET)
const R2_DOMAIN = "https://367d8bec50c5512df7e40222efd63eb9.r2.cloudflarestorage.com";

// Để trống nếu custom domain trỏ thẳng vào bucket; nếu dùng endpoint trên thì điền tên bucket
const R2_BUCKET = "";

// Tiền tố thư mục game trong bucket (không có / ở đầu/cuối)
const R2_GAME_PREFIXES = {
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

function normalizeGameType(raw) {
  const t = (raw || "h5").toLowerCase();
  if (t === "swf" || t === "flash") return "swf";
  if (t === "h5" || t === "html" || t === "html5") return "h5";
  return "h5";
}

function swfFilenameFromParams(urlParams, gameId) {
  const fallback = `${String(gameId).replace(/[/\\]/g, "")}.swf`;
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
    s.onerror = () => reject(new Error("Không tải được Ruffle (SWF cần Ruffle trên trình duyệt)."));
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

function mountHtml5Game(container, gameId) {
  const prefix = R2_GAME_PREFIXES.h5.replace(/^\/+|\/+$/g, "");
  const url = r2PublicUrl(`${prefix}/${gameId}/index.html`);
  const iframe = document.createElement("iframe");
  iframe.className = "game-frame";
  iframe.src = url;
  iframe.setAttribute("allowfullscreen", "true");
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("title", "Game");
  container.appendChild(iframe);
}

async function mountSwfGame(container, gameId, urlParams) {
  const prefix = R2_GAME_PREFIXES.swf.replace(/^\/+|\/+$/g, "");
  const swfName = swfFilenameFromParams(urlParams, gameId);
  const swfUrl = r2PublicUrl(`${prefix}/${gameId}/${swfName}`);

  await ensureRuffleReady();
  const ruffle = window.RufflePlayer.newest();
  const player = ruffle.createPlayer();
  player.className = "game-ruffle";
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
  const gameId = urlParams.get("id");
  const type = normalizeGameType(urlParams.get("type"));
  const container = document.getElementById("game-container");

  if (!gameId) {
    showError(container, "Lỗi: Không tìm thấy dữ liệu game (thiếu ?id=).");
  } else if (type === "swf") {
    mountSwfGame(container, gameId, urlParams).catch((err) => {
      console.error(err);
      container.replaceChildren();
      showError(container, err.message || "Không mở được game SWF.");
    });
  } else {
    mountHtml5Game(container, gameId);
  }
}
