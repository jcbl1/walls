const $app = document.getElementById("app");
const lightbox = document.getElementById("lightbox");
const lbMedia = document.getElementById("lb-media");
const lbCaption = document.getElementById("lb-caption");

const state = { manifest: null, statsLoaded: false };
const lbContext = { items: [], index: -1 };

async function ensureManifest() {
  if (!state.manifest) {
    const res = await fetch("./manifest.json");
    if (!res.ok) throw new Error(`manifest.json HTTP ${res.status}`);
    state.manifest = await res.json();
  }
  return state.manifest;
}

async function ensureStats() {
  if (state.statsLoaded || !state.manifest) return;
  state.statsLoaded = true;
  try {
    const res = await fetch("./stats.json");
    if (!res.ok) return;
    const stats = await res.json();
    for (const category of state.manifest.categories)
      for (const file of category.files)
        if (file.views == null) file.views = stats[file.path] ?? null;
  } catch {
    void 0;
  }
}

function allFiles() {
  return state.manifest.categories.flatMap((category) => category.files);
}

function hasViews() {
  return state.manifest.categories.some((category) =>
    category.files.some((file) => file.views != null)
  );
}

function fileURL(file) {
  return encodeURI(`${state.manifest.base_url}/${file.path}`);
}

function thumbURL(file) {
  if (!state.manifest.thumbs_base) return null;
  return encodeURI(`${state.manifest.thumbs_base}/${file.path}.webp`);
}

function categoryURL(name) {
  return `#/c/${encodeURIComponent(name)}`;
}

function categoryOf(file) {
  return file.path.split("/")[0];
}

function fileNameOf(file) {
  return file.path.split("/").pop();
}

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, seed) {
  const out = items.slice();
  const rand = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function dailySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

function mediaNode(file, lazy = true) {
  const url = fileURL(file);
  const thumb = thumbURL(file);
  if (file.kind === "video") {
    return el("video", { src: url, poster: thumb, muted: "", loop: "", playsinline: "", preload: "none" });
  }
  const image = el("img", {
    src: thumb ?? url,
    alt: file.stem,
    loading: lazy ? "lazy" : "eager",
    decoding: "async",
    onerror: () => {
      image.onerror = null;
      image.src = url;
    },
  });
  return image;
}

function grid(files) {
  const wrap = el("div", { class: "masonry" });
  files.forEach((file, index) => {
    wrap.append(
      el(
        "button",
        { class: "card", type: "button", "aria-label": file.stem, onclick: () => openLightbox(files, index) },
        mediaNode(file)
      )
    );
  });
  return wrap;
}

function openLightbox(items, index) {
  lbContext.items = items;
  lbContext.index = index;
  lightbox.hidden = false;
  document.body.classList.add("no-scroll");
  showLightbox();
}

function closeLightbox() {
  lightbox.hidden = true;
  document.body.classList.remove("no-scroll");
  lbMedia.replaceChildren();
}

function stepLightbox(delta) {
  const total = lbContext.items.length;
  if (!total) return;
  lbContext.index = (lbContext.index + delta + total) % total;
  showLightbox();
}

function showLightbox() {
  const file = lbContext.items[lbContext.index];
  if (!file) return closeLightbox();
  const url = fileURL(file);
  lbMedia.replaceChildren(
    file.kind === "video"
      ? el("video", { src: url, controls: "", autoplay: "", loop: "", playsinline: "" })
      : el("img", { src: url, alt: file.stem, decoding: "async" })
  );
  lbCaption.replaceChildren(
    el("span", { class: "lb-title" }, file.stem),
    el("a", { class: "chip", href: categoryURL(categoryOf(file)) }, categoryOf(file)),
    el("button", { class: "btn", type: "button", onclick: () => downloadFile(file) }, "Download")
  );
}

async function downloadFile(file) {
  const url = fileURL(file);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const blob = await res.blob();
    const a = el("a", { href: URL.createObjectURL(blob), download: fileNameOf(file) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

lightbox.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "close") closeLightbox();
  else if (action === "prev") stepLightbox(-1);
  else if (action === "next") stepLightbox(1);
});

document.addEventListener("keydown", (e) => {
  if (lightbox.hidden) return;
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowLeft") stepLightbox(-1);
  else if (e.key === "ArrowRight") stepLightbox(1);
});

function parseRoute() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query] = raw.split("?");
  const params = new URLSearchParams(query || "");
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return { name: "home", params };
  if (parts[0] === "c" && parts[1]) return { name: "category", category: decodeURIComponent(parts[1]), params };
  if (parts[0] === "random") return { name: "random", params };
  if (parts[0] === "popular") return { name: "popular", params };
  return { name: "home", params };
}

function setActiveNav(name) {
  document.querySelectorAll(".nav [data-nav]").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === name);
  });
}

function emptyState() {
  return el(
    "section",
    { class: "panel placeholder" },
    el("p", null, "The manifest is empty."),
    el("p", { class: "muted" }, "Add categories with wallpapers, then regenerate the manifest.")
  );
}

function viewHome() {
  const files = allFiles();
  if (!files.length) return emptyState();
  const picks = shuffled(files, dailySeed()).slice(0, 6);
  const categories = state.manifest.categories.map((category) => {
    const preview = shuffled(category.files, fnv(category.name))[0];
    return el(
      "a",
      { class: "cat-card", href: categoryURL(category.name) },
      el("div", { class: "cat-thumb" }, preview ? mediaNode(preview) : null),
      el(
        "div",
        { class: "cat-meta" },
        el("span", { class: "cat-name" }, category.name),
        el("span", { class: "cat-count" }, `${category.files.length} items`)
      )
    );
  });
  return el(
    "div",
    null,
    el(
      "section",
      { class: "hero" },
      el("h1", null, "Walls"),
      el("p", { class: "muted" }, "Browse the wallpaper collection by category, or roll the dice."),
      el(
        "div",
        { class: "hero-actions" },
        el("a", { class: "btn primary", href: "#/random" }, "Surprise me"),
        el(
          "button",
          { class: "btn", type: "button", onclick: () => document.getElementById("categories").scrollIntoView({ behavior: "smooth" }) },
          "Browse categories"
        )
      )
    ),
    el("section", null, el("h2", null, "Today's picks"), grid(picks)),
    el("section", { id: "categories" }, el("h2", null, "Categories"), el("div", { class: "cat-grid" }, categories))
  );
}

function viewCategory(name) {
  const category = state.manifest.categories.find((c) => c.name === name);
  if (!category) {
    return el(
      "section",
      { class: "panel placeholder" },
      el("p", null, `Category "${name}" not found.`),
      el("p", null, el("a", { href: "#/" }, "Back to home"))
    );
  }
  let filterText = "";
  let sortBy = "name";
  let randomSeed = fnv(name);
  const gridHost = el("div");

  const apply = () => {
    let files = category.files.filter((f) => f.stem.toLowerCase().includes(filterText));
    if (sortBy === "views")
      files = files.slice().sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || a.stem.localeCompare(b.stem));
    else if (sortBy === "random") files = shuffled(files, randomSeed);
    else files = files.slice().sort((a, b) => a.stem.localeCompare(b.stem));
    return files;
  };
  const rerender = () => gridHost.replaceChildren(grid(apply()));

  const search = el("input", {
    class: "input",
    type: "search",
    placeholder: `Filter ${category.files.length} items by name`,
    oninput: (e) => {
      filterText = e.target.value.trim().toLowerCase();
      rerender();
    },
  });
  const reroll = el("button", {
    class: "btn",
    type: "button",
    hidden: "hidden",
    onclick: () => {
      randomSeed = (Math.random() * 2 ** 31) | 0;
      rerender();
    },
  }, "Shuffle");
  const sortSelect = el(
    "select",
    {
      class: "input",
      onchange: (e) => {
        sortBy = e.target.value;
        reroll.hidden = sortBy !== "random";
        if (sortBy === "random") randomSeed = (Math.random() * 2 ** 31) | 0;
        rerender();
      },
    },
    el("option", { value: "name" }, "Name"),
    el("option", { value: "views" }, "Views"),
    el("option", { value: "random" }, "Random")
  );

  rerender();
  return el(
    "section",
    null,
    el(
      "div",
      { class: "page-head" },
      el("a", { class: "btn ghost", href: "#/" }, "\u2190 All categories"),
      el("h2", { class: "page-title" }, name),
      el("span", { class: "muted" }, `${category.files.length} items`)
    ),
    el("div", { class: "toolbar" }, search, sortSelect, reroll),
    gridHost
  );
}

function viewRandom(params) {
  const files = allFiles();
  if (!files.length) return emptyState();
  const n = Math.min(Math.max(parseInt(params.get("n") || "6", 10) || 6, 1), 24);
  const host = el("div");
  const draw = () => host.replaceChildren(grid(shuffled(files, (Math.random() * 2 ** 31) | 0).slice(0, n)));
  draw();
  return el(
    "section",
    null,
    el(
      "div",
      { class: "page-head" },
      el("h2", { class: "page-title" }, "Random"),
      el("span", { class: "muted" }, `${n} items`),
      el("button", { class: "btn primary", type: "button", onclick: draw }, "Reroll")
    ),
    host
  );
}

function viewPopular() {
  if (!hasViews()) {
    return el(
      "section",
      null,
      el("div", { class: "page-head" }, el("h2", { class: "page-title" }, "Popular")),
      el(
        "div",
        { class: "panel placeholder" },
        el("p", null, "No view data yet."),
        el("p", { class: "muted" }, "Popularity tracking is not wired up yet. Once a stats source is connected, the most viewed wallpapers will be ranked here.")
      )
    );
  }
  const ranked = allFiles()
    .filter((file) => file.views != null)
    .sort((a, b) => b.views - a.views)
    .slice(0, 60);
  return el(
    "section",
    null,
    el(
      "div",
      { class: "page-head" },
      el("h2", { class: "page-title" }, "Popular"),
      el("span", { class: "muted" }, "top 60")
    ),
    grid(ranked)
  );
}

async function render() {
  const route = parseRoute();
  setActiveNav(route.name);
  try {
    await ensureManifest();
    await ensureStats();
  } catch (err) {
    $app.replaceChildren(el("section", { class: "panel error" }, `Failed to load manifest: ${err.message}`));
    return;
  }
  const view =
    route.name === "category"
      ? viewCategory(route.category)
      : route.name === "random"
        ? viewRandom(route.params)
        : route.name === "popular"
          ? viewPopular()
          : viewHome();
  $app.replaceChildren(view);
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", render);
render();
