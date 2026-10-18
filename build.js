#!/usr/bin/env node
// ModSheet static site builder. No dependencies.
// Reads site.json + content/builds/*.json, writes the finished site to dist/.
// Build status: "live" publishes, "soon" shows a teaser card, "draft" is skipped (approval gate).

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUT = path.join(ROOT, "dist");
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "site.json"), "utf8"));

// ---------- helpers ----------
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (typeof n === "number" ? "$" + n.toLocaleString("en-US") : "");
const pad = (n) => String(n).padStart(3, "0");
const two = (n) => String(n).padStart(2, "0");
const wordmark = () => `${esc(site.wordmark[0])}<span>/</span>${esc(site.wordmark[1])}`;
const now = new Date();
const issueDate = `${now.getFullYear()}.${two(now.getMonth() + 1)}`;
const write = (rel, html) => {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
};

// ---------- image rights ----------
// owned:      our own photo or render. Needs nothing else.
// licensed:   open license (CC BY, CC BY-SA, CC0, Unsplash, Pexels). Needs license name, license link, credit.
// permission: owner said yes in writing. Needs source.permission "granted", source.owner, credit.
// Instagram embeds are only allowed with permission.
const RIGHTS = ["owned", "licensed", "permission"];
const rightsErrors = (b) => {
  const p = b.photo || {};
  const src = b.source || {};
  if (!p.image && !p.instagram) return [];
  const e = [];
  if (!RIGHTS.includes(p.rights)) {
    e.push(`photo.rights must be one of ${RIGHTS.join(", ")} before this can go live`);
    return e;
  }
  if (p.instagram && p.rights !== "permission") e.push("Instagram embeds need photo.rights \"permission\"");
  if (p.rights === "licensed") {
    if (!p.license) e.push("licensed photo needs photo.license (e.g. CC BY-SA 4.0)");
    if (!p.licenseUrl) e.push("licensed photo needs photo.licenseUrl");
    if (!p.credit) e.push("licensed photo needs photo.credit (the author)");
  }
  if (p.rights === "permission") {
    if (src.permission !== "granted") e.push("permission photo needs source.permission \"granted\"");
    if (!src.owner) e.push("permission photo needs source.owner");
    if (!p.credit) e.push("permission photo needs photo.credit");
  }
  return e;
};

// ---------- studios ----------
// Design studios whose concepts appear on build sheets (credited, with an about block).
const sdir = path.join(ROOT, "content", "studios");
const studios = Object.fromEntries((fs.existsSync(sdir) ? fs.readdirSync(sdir) : [])
  .filter((f) => f.endsWith(".json"))
  .map((f) => { const st = JSON.parse(fs.readFileSync(path.join(sdir, f), "utf8")); return [st.slug, st]; }));

// ---------- load + validate ----------
const dir = path.join(ROOT, "content", "builds");
const errors = [];
const builds = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => {
    let b;
    try {
      b = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch (e) {
      errors.push(`${f}: invalid JSON (${e.message})`);
      return null;
    }
    b._file = f;
    const need = ["status", "number", "slug", "chassis", "title", "summary"];
    if (b.status === "live") need.push("thesis", "specs", "parts");
    need.forEach((k) => { if (b[k] === undefined || b[k] === "") errors.push(`${f}: missing "${k}"`); });
    if (!["live", "soon", "draft"].includes(b.status)) errors.push(`${f}: status must be live, soon or draft`);
    if (b.slug && !/^[a-z0-9-]+$/.test(b.slug)) errors.push(`${f}: slug must be lowercase letters, numbers, hyphens`);
    if (b.status === "live" && b.bundle) {
      const refs = new Set((b.parts || []).map((p) => p.ref));
      (b.bundle.refs || []).forEach((r) => { if (!refs.has(r)) errors.push(`${f}: bundle ref ${r} not in parts`); });
    }
    if (b.studio && !studios[b.studio]) errors.push(`${f}: studio "${b.studio}" not found in content/studios`);
    // Image rights guardrail: a live sheet cannot publish a photo unless its rights are documented.
    if (b.status === "live") {
      rightsErrors(b).forEach((e) => errors.push(`${f}: ${e}`));
      (b.gallery || []).forEach((g, i) => rightsErrors({ photo: g, source: b.source }).forEach((e) => errors.push(`${f}: gallery ${i + 1}: ${e}`)));
    }
    return b;
  })
  .filter(Boolean);

const slugs = builds.map((b) => b.slug);
slugs.forEach((s, i) => { if (slugs.indexOf(s) !== i) errors.push(`duplicate slug: ${s}`); });

// ---------- merch ----------
const mdir = path.join(ROOT, "content", "merch");
const merch = (fs.existsSync(mdir) ? fs.readdirSync(mdir) : [])
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => {
    let m;
    try {
      m = JSON.parse(fs.readFileSync(path.join(mdir, f), "utf8"));
    } catch (e) {
      errors.push(`merch/${f}: invalid JSON (${e.message})`);
      return null;
    }
    ["status", "number", "slug", "name", "type", "price", "summary"].forEach((k) => {
      if (m[k] === undefined || m[k] === "") errors.push(`merch/${f}: missing "${k}"`);
    });
    if (!["live", "soon", "draft"].includes(m.status)) errors.push(`merch/${f}: status must be live, soon or draft`);
    if (m.status === "live" && !m.url) errors.push(`merch/${f}: a live product needs a store url`);
    if (m.status !== "draft") rightsErrors(m).forEach((e) => errors.push(`merch/${f}: ${e}`));
    return m;
  })
  .filter(Boolean)
  .filter((m) => m.status !== "draft")
  .sort((a, b) => a.number - b.number);

if (errors.length) {
  console.error("Build failed:\n  " + errors.join("\n  "));
  process.exit(1);
}

const rank = (b) => (b.status === "live" ? 0 : 1);
const published = builds.filter((b) => b.status !== "draft").sort((a, b) => rank(a) - rank(b) || (a.status === "live" ? b.number - a.number : a.number - b.number)); // newest live first, then next up
const live = published.filter((b) => b.status === "live");

// ---------- design helpers ----------
// Monospace label style: UPPERCASE_WITH_UNDERSCORES
const L = (s = "") => esc(String(s).toUpperCase().replace(/ /g, "_"));
const crossFrame = (cls, inner = "") =>
  `<div class="${cls} crop o">${inner || `<div class="cross"><i></i></div>`}</div>`;
const kitTotal = (b) =>
  b.bundle ? b.parts.filter((p) => b.bundle.refs.includes(p.ref)).reduce((s, p) => s + (p.price || 0), 0) : 0;
// Local SVG art is inlined so it uses the site fonts; other images get a path relative to the page.
const media = (p = {}, up, fallbackAlt = "") => {
  if (!p.image) return "";
  const local = !/^(https?:)?\/\//.test(p.image) && !p.image.startsWith("/");
  if (local && p.image.endsWith(".svg")) {
    return fs.readFileSync(path.join(ROOT, p.image), "utf8").replace(/<\?xml[^>]*>/, "");
  }
  const src = local ? up + p.image : p.image;
  return `<img src="${esc(src)}" alt="${esc(p.alt || fallbackAlt)}" loading="lazy">`;
};
// Tap to enlarge: wraps raster images in a link to the full file. Works without JS; the lightbox enhances it.
const zoomable = (p = {}, up, alt) => {
  if (!p.image || p.image.endsWith(".svg")) return media(p, up, alt);
  const local = !/^(https?:)?\/\//.test(p.image) && !p.image.startsWith("/");
  const href = local ? up + p.image : p.image;
  return `<a class="zoom" href="${esc(href)}" aria-label="View full size: ${esc(p.alt || alt)}">${media(p, up, alt)}<span class="zoom-hint lab" aria-hidden="true">Enlarge &#8599;</span></a>`;
};
const mailto = (subject) => `mailto:${esc(site.email)}?subject=${encodeURIComponent(subject)}`;

const LIGHTBOX = `<dialog class="lightbox" aria-label="Full size image">
  <button class="lb-close lab" type="button" aria-label="Close full size image">Close &times;</button>
  <button class="lb-nav lb-prev" type="button" aria-label="Previous image">&larr;</button>
  <img alt="">
  <button class="lb-nav lb-next" type="button" aria-label="Next image">&rarr;</button>
  <div class="lb-count lab" aria-live="polite"></div>
</dialog>
<script>
(function(){
  var d=document.querySelector(".lightbox"); if(!d||!d.showModal) return;
  var im=d.querySelector("img"), cnt=d.querySelector(".lb-count"), list=[], i=0;
  function items(){ var seen={}, out=[];
    document.querySelectorAll("a.zoom").forEach(function(a){ if(!seen[a.href]){ seen[a.href]=1; out.push(a); } });
    return out; }
  function show(n){ i=(n+list.length)%list.length; var a=list[i], s=a.querySelector("img");
    im.src=a.href; im.alt=s?s.alt:""; cnt.textContent=(i+1)+" / "+list.length; }
  document.addEventListener("click",function(e){
    var a=e.target.closest&&e.target.closest("a.zoom"); if(!a) return;
    e.preventDefault(); list=items();
    var k=list.findIndex(function(x){return x.href===a.href;});
    d.classList.toggle("single", list.length<2); show(k<0?0:k); d.showModal();
  });
  d.querySelector(".lb-prev").addEventListener("click",function(e){ e.stopPropagation(); show(i-1); });
  d.querySelector(".lb-next").addEventListener("click",function(e){ e.stopPropagation(); show(i+1); });
  d.addEventListener("keydown",function(e){
    if(e.key==="ArrowRight"){ e.preventDefault(); show(i+1); }
    if(e.key==="ArrowLeft"){ e.preventDefault(); show(i-1); }
  });
  var x0=null;
  d.addEventListener("touchstart",function(e){ x0=e.touches.length===1?e.touches[0].clientX:null; },{passive:true});
  d.addEventListener("touchend",function(e){ if(x0===null||list.length<2) return;
    var dx=e.changedTouches[0].clientX-x0; x0=null;
    if(Math.abs(dx)>50){ d.dataset.swiped="1"; show(dx<0?i+1:i-1); } });
  d.addEventListener("click",function(e){
    if(d.dataset.swiped){ delete d.dataset.swiped; return; }
    if(e.target===d||e.target===im||e.target.closest(".lb-close")) d.close(); });
  d.addEventListener("close",function(){ im.removeAttribute("src"); });
})();
</script>`;
// ---------- layout ----------
const layout = ({ title, description, body, depth = 0, canonical = "", current = "" }) => {
  const up = depth < 0 ? "/" : depth ? "../".repeat(depth) : "";
  const home = up || "./";
  const s = site.social;
  const socials = [["Instagram", s.instagram], ["TikTok", s.tiktok], ["YouTube", s.youtube]]
    .filter(([, url]) => url)
    .map(([n, url]) => `<li><a href="${esc(url)}" rel="noopener" target="_blank">${n}</a></li>`)
    .join("");
  const nav = [
    ["builds", "Builds", `${up}#builds`],
    ["shop", "Shop", `${up}shop/`],
    ["how", "How it works", `${up}#how`],
    ["submit", "Submit", `${up}#submit`],
  ].map(([k, label, href]) => `<a href="${href}"${current === k ? ' aria-current="page"' : ""}>${L(label)}</a>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${canonical ? `<link rel="canonical" href="${esc(site.domain + canonical)}">` : ""}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta name="theme-color" content="#D6D5D0">
<link rel="preload" href="${up}assets/fonts/archivo.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${up}assets/styles.css">
</head>
<body>
<a class="skip lab" href="#main">Skip to content</a>
<div class="wrap">
  <div class="topline"><span class="chip">${L(site.name)} ${issueDate} // Curated Euro build manifest</span></div>
  <header class="mast">
    <a class="logo h" href="${home}" aria-label="${esc(site.name)} home">${wordmark()}</a>
    <nav class="nav lab" aria-label="Main">${nav}</nav>
  </header>
</div>
<main id="main">
${body}
</main>
${body.includes('class="zoom"') ? LIGHTBOX : ""}
<footer><div class="wrap">
  <div class="foot-grid">
    <div>
      <a class="logo h" href="${home}">${wordmark()}</a>
      <p class="foot-tag">${esc(site.tagline)}</p>
    </div>
    <nav aria-label="Explore"><div class="lab">Explore</div><ul>
      <li><a href="${up}#builds">Build sheets</a></li>
      <li><a href="${up}shop/">Shop</a></li>
      <li><a href="${up}#how">How it works</a></li>
    </ul></nav>
    <nav aria-label="Contribute"><div class="lab">Contribute</div><ul>
      <li><a href="${mailto("My build")}">Submit a build</a></li>
      <li><a href="mailto:${esc(site.email)}">Contact</a></li>
      ${socials}
    </ul></nav>
  </div>
  <p class="disclosure lab">${esc(site.disclosure)}</p>
  <p class="disclosure lab">Rights holder? Email <a href="${mailto("Image removal")}">${esc(site.email)}</a> and we will credit or remove it within 48 hours.</p>
</div></footer>
</body>
</html>`;
};

// ---------- shared blocks ----------
const card = (b, up = "") => {
  const isLive = b.status === "live";
  const inner = `
    <div class="top">
      <div class="chassis big" aria-hidden="true">${esc(b.chassis)}</div>
      <div class="lab">Build_gate<br><b>No. ${pad(b.number)}</b></div>
    </div>
    <div class="band">
      <h3 class="h">${esc(b.title)}</h3>
      <p>${esc(b.summary)}</p>
      <div class="kv">
        <div><div class="lab">No.</div><div class="v">${pad(b.number)}</div></div>
        <div><div class="lab">Parts</div><div class="v">${isLive ? b.parts.length : "TBD"}</div></div>
        <div><div class="lab">Status</div><div class="v">${isLive ? "LIVE" : "QUEUED"}</div></div>
      </div>
    </div>`;
  return isLive
    ? `<a class="card shadow" href="${up}builds/${esc(b.slug)}/">${inner}</a>`
    : `<div class="card off shadow">${inner}</div>`;
};

const product = (m, up) => {
  const isLive = m.status === "live";
  const cta = isLive
    ? `<a class="btn k" href="${esc(m.url)}" rel="noopener" target="_blank">Buy ${esc(m.name)}</a>`
    : `<a class="btn w" href="${up}shop/?item=${esc(m.slug)}#notify">Notify me</a>`;
  return `
  <article class="item shadow">
    <div class="art crop">${zoomable(m.photo, up, m.name)}</div>
    <div class="item-body">
      <div class="lab">Item_${two(m.number)} // ${L(m.type)}</div>
      <h3 class="h">${esc(m.name)}</h3>
      <p>${esc(m.summary)}</p>
      ${m.details ? `<ul class="lab details">${m.details.map((d) => `<li>${L(d)}</li>`).join("")}</ul>` : ""}
      <div class="kv">
        <div><div class="lab">Price</div><div class="v">${money(m.price)}</div></div>
        <div><div class="lab">Status</div><div class="v">${isLive ? "AVAILABLE" : "DROP 01"}</div></div>
      </div>
      ${cta}
    </div>
  </article>`;
};

// Drop list signup: Netlify Forms captures it, no third party account needed.
const notifyBlock = (source) => `
<section id="notify" style="padding-top:0"><div class="wrap">
  <div class="panel p-white notify shadow">
    <div>
      <div class="lab">Drop_list // Open</div>
      <h2 class="h">Get Drop 01 first.</h2>
      <p>One email when the shirts go live. No spam, unsubscribe any time.</p>
    </div>
    <form class="nform" name="drop-list" method="POST" action="/thanks/" data-netlify="true" netlify-honeypot="bot-field">
      <input type="hidden" name="form-name" value="drop-list">
      <input type="hidden" name="source" value="${esc(source)}">
      <p class="hp" aria-hidden="true"><label>Leave empty <input name="bot-field" tabindex="-1" autocomplete="off"></label></p>
      <label class="lab" for="nf-email-${esc(source)}">Email</label>
      <input id="nf-email-${esc(source)}" type="email" name="email" required autocomplete="email" inputmode="email" placeholder="you@example.com">
      <label class="lab" for="nf-item-${esc(source)}">Interested in</label>
      <select id="nf-item-${esc(source)}" name="item">
        <option value="all">All of Drop 01</option>
        ${merch.map((m) => `<option value="${esc(m.slug)}">${esc(m.name)}</option>`).join("")}
      </select>
      <button class="btn o" type="submit">Join the drop list</button>
    </form>
  </div>
</div></section>
<script>
(function(){var i=new URLSearchParams(location.search).get("item");if(!i)return;
document.querySelectorAll('select[name="item"]').forEach(function(s){if(s.querySelector('option[value="'+i+'"]'))s.value=i;});})();
</script>`;

const submitBlock = (copy) => `
<section id="submit"><div class="wrap">
  <div class="panel p-black submit shadow">
    <div>
      <div class="lab">Reader_submissions // Open</div>
      <h2 class="h" style="margin-top:14px">Built something?<br>Get featured.</h2>
      <p>${esc(copy)}</p>
    </div>
    <a class="btn o" href="${mailto("My build")}">Submit your build</a>
  </div>
</div></section>`;

// ---------- home ----------
const lead = live[0];
const leadTicket = lead ? `
  <div class="panel p-black ticket shadow">
    ${lead.photo && lead.photo.image ? `<a class="frame-link" href="builds/${esc(lead.slug)}/" aria-label="Open the ${esc(lead.title)} build">${crossFrame("frame", media(lead.photo, "", lead.title))}</a>` : crossFrame("frame", "")}
    <div class="meta-row">
      <div class="code big" aria-hidden="true">${esc(lead.chassis)}</div>
      <div class="lab" style="text-align:right">Featured_build<br><b>No. ${pad(lead.number)}</b><br>${L(lead.title)}</div>
    </div>
    <div class="grid">
      <div><div class="lab">Parts</div><div class="v">${lead.parts.length}</div></div>
      <div><div class="lab">Kit</div><div class="v">${money(kitTotal(lead))}</div></div>
      <div><div class="lab">Status</div><div class="v">LIVE</div></div>
    </div>
    <div class="go"><a class="btn o" href="builds/${esc(lead.slug)}/">Open the ${esc(lead.chassis)} build</a></div>
  </div>` : "";

const shopTeaser = merch.length ? `
<section id="shop"><div class="wrap">
  <div class="sec-head"><h2 class="h">Garage goods</h2><a class="lab more" href="shop/">View_all ${merch.length}_items &rarr;</a></div>
  <div class="items">${merch.slice(0, 3).map((m) => product(m, "")).join("")}</div>
</div></section>` : "";

const homeHtml = layout({
  title: `${site.name}: ${site.tagline}`,
  description: site.description,
  canonical: "/",
  body: `
<div class="wrap"><div class="hero">
  <div class="panel p-orange shadow">
    <div class="vert lab" aria-hidden="true">Curated_build_manifest // Vol_01</div>
    <div>
      <h1 class="h">See the car.<br>Shop the build.</h1>
      <p class="lede">${esc(site.description)}</p>
    </div>
    <div>
      <div class="stack">
        <div><div class="h">Curated builds</div><div class="lab">Euro_chassis_only<br>Owner_credited<br>No_stock_photos</div></div>
        <div><div class="h">Shoppable parts</div><div class="lab">Every_mod_listed<br>Linked_to_retailer<br>Price_indicated</div></div>
        <div><div class="h">Install order</div><div class="lab">Starter_kit_first<br>First_timer_safe<br>Detail_pass_included</div></div>
      </div>
      <div class="cta">
        <a class="btn k" href="#builds">Browse build sheets</a>
        <a class="btn w" href="shop/">Shop merch</a>
      </div>
    </div>
  </div>
  ${leadTicket}
</div></div>

<section id="builds"><div class="wrap">
  <div class="sec-head"><h2 class="h">Build sheets</h2><span class="lab">${published.length}_entries // ${live.length}_live</span></div>
  <div class="cards">${published.map((b) => card(b)).join("")}</div>
</div></section>

<section id="how" style="padding-top:0"><div class="wrap">
  <div class="sec-head"><h2 class="h">How it works</h2><span class="lab">Sequence // 3_steps</span></div>
  <div class="how">
    <div class="panel p-white shadow"><div class="n big" aria-hidden="true">01</div><h3 class="h">Find the car</h3><p>Standout Euro builds from the owners who made them. Always credited.</p><div class="lab">Input: owner_build</div></div>
    <div class="panel p-white shadow"><div class="n big" aria-hidden="true">02</div><h3 class="h">Shop the parts</h3><p>Every mod on the car, listed in install order with a link to buy it.</p><div class="lab">Output: parts_manifest</div></div>
    <div class="panel p-white shadow"><div class="n big" aria-hidden="true">03</div><h3 class="h">Build your own</h3><p>Start with the starter kit and follow the order. Built for first timers.</p><div class="lab">Result: your_build</div></div>
  </div>
</div></section>
${shopTeaser}
${merch.length ? notifyBlock("home") : ""}
${submitBlock(`${site.name} runs on real builds from real people. The best become the next build sheet, credited and linked to your handle.`)}`,
});
fs.rmSync(OUT, { recursive: true, force: true });
write("index.html", homeHtml);

// ---------- shop page ----------
if (merch.length) {
  write("shop/index.html", layout({
    title: `Shop · ${site.name}`,
    description: `${site.name} tees and stickers. Made to order, no inventory.`,
    depth: 1,
    canonical: "/shop/",
    current: "shop",
    body: `
<div class="wrap">
  <nav class="crumbs lab" aria-label="Breadcrumb"><a href="../">Home</a> / <span aria-current="page">Shop</span></nav>
  <div class="panel p-orange shop-hero shadow">
    <div class="vert lab" aria-hidden="true">Garage_goods // Drop_01</div>
    <div class="lab">Shop // ${merch.length}_items</div>
    <h1 class="h">Wear the manifest.</h1>
    <p class="lede">Tees and stickers in the ${esc(site.name)} style. Every piece is printed when you order it, so nothing sits in a warehouse.</p>
    <div class="stack">
      <div><div class="h">Made to order</div><div class="lab">Printed_on_purchase<br>No_dead_stock</div></div>
      <div><div class="h">Drop 01</div><div class="lab">Join_the_drop_list<br>First_run_soon</div></div>
      <div><div class="h">Supports the site</div><div class="lab">Keeps_build_sheets_free</div></div>
    </div>
  </div>
</div>
<section><div class="wrap">
  <div class="sec-head"><h2 class="h">Drop 01</h2><span class="lab">${merch.length}_items // ${merch.filter((m) => m.status === "live").length}_available</span></div>
  <div class="items">${merch.map((m) => product(m, "../")).join("")}</div>
</div></section>
${notifyBlock("shop")}`,
  }));
}

// ---------- build pages ----------
const studioBlock = (st, b) => `
<section class="studio-sec"><div class="wrap">
  <div class="studio shadow">
    <div class="panel p-black st-about">
      <div class="lab">Concept_by // Design_studio</div>
      <div class="st-name h">${esc(st.name)}</div>
      <p class="st-tag">${esc(st.tagline)}</p>
      <p>${esc(st.about)}</p>
      ${st.url ? `<a class="btn o" href="${esc(st.url)}" rel="noopener" target="_blank">Visit ${esc(st.name)}</a>` : ""}
    </div>
    ${b.designerNote ? `<figure class="panel p-white st-note">
      <div class="lab">Designer_note // Build_${pad(b.number)}</div>
      <blockquote>${esc(b.designerNote)}</blockquote>
      <figcaption class="lab">${esc(st.name)} studio</figcaption>
    </figure>` : ""}
  </div>
</div></section>`;

const photoBlock = (p = {}, b) => {
  if (p.instagram) {
    // Official Instagram embed: owner's post, owner's credit, owner's terms.
    return `<div class="embed"><blockquote class="instagram-media" data-instgrm-permalink="${esc(p.instagram)}" data-instgrm-version="14" style="max-width:540px;width:100%"></blockquote></div>
<script async src="https://www.instagram.com/embed.js"></script>`;
  }
  const who = p.credit
    ? p.creditUrl ? `<a href="${esc(p.creditUrl)}" rel="noopener" target="_blank">${esc(p.credit)}</a>` : esc(p.credit)
    : esc(site.name);
  const lic = p.rights === "licensed"
    ? `, <a href="${esc(p.licenseUrl)}" rel="noopener license" target="_blank">${esc(p.license)}</a>` : "";
  const credit = p.render ? `Concept render by ${who}` : p.image ? `Photo: ${who}${lic}` : "Photo: pending";
  const inner = p.image
    ? zoomable(p, "../../", b.title)
    : `<div class="cross"><i></i></div><div class="ph lab">Owner_photo<br>Pending</div>`;
  const thumbs = (b.gallery || []).length
    ? `<div class="thumbs">${b.gallery.map((g) => `<div class="thumb-sm">${zoomable(g, "../../", b.title)}</div>`).join("")}</div>`
    : "";
  return `${crossFrame("photo", inner)}${thumbs}
    <div class="caprow lab"><span>${credit}</span><span>Frame_${pad(b.number)}</span></div>`;
};

const shopBtn = (p) =>
  p.url
    ? `<a class="shop" href="${esc(p.url)}" rel="sponsored nofollow noopener" target="_blank" aria-label="Shop ${esc(p.name)}, ${money(p.price)}"><span class="price">${money(p.price)}</span><span class="lab">Shop_it</span></a>`
    : `<span class="shop pending"><span class="price">${money(p.price)}</span><span class="lab">Link_soon</span></span>`;

live.forEach((b) => {
  const parts = b.parts.map((p, i) => `
    <li class="part">
      <div class="idx big" aria-hidden="true">${two(i + 1)}</div>
      <div class="lab">${L(p.ref)}</div>
      <div>
        <h3 class="h"><span class="sr">Step ${i + 1}: </span>${esc(p.name)}</h3>
        <p>${esc(p.note)}</p>
        ${p.retailer ? `<div class="via lab">Via: ${L(p.retailer)}</div>` : ""}
      </div>
      ${shopBtn(p)}
    </li>`).join("");

  const kit = b.bundle ? `
<section style="padding-top:0"><div class="wrap">
  <div class="panel p-orange kit shadow">
    <div>
      <div class="lab">Starter_kit // ${b.bundle.refs.length}_items</div>
      <h2 class="h" style="margin-top:12px">${esc(b.bundle.name)}</h2>
      <p>${esc(b.bundle.pitch)}</p>
      <div class="refs lab"><b>${b.bundle.refs.map(L).join(" + ")}</b></div>
    </div>
    <div class="total"><div class="lab">Kit_total</div><div class="big">${money(kitTotal(b))}</div></div>
  </div>
</div></section>` : "";

  const shine = b.detailing && b.detailing.length ? `
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><h2 class="h">Make it shine</h2><span class="lab">Detail_pass // ${b.detailing.length}_steps</span></div>
  <div class="shine">${b.detailing.map((d, i) => `
    <div class="panel p-black shadow"><div class="n big" aria-hidden="true">${two(i + 1)}</div><h3 class="h">${esc(d.step)}</h3><p>${esc(d.note)}</p>
    ${d.url ? `<a class="lab" href="${esc(d.url)}" rel="sponsored nofollow noopener" target="_blank">${L(d.cta)} &rarr;</a>` : `<span class="na lab">Link_soon</span>`}</div>`).join("")}
  </div>
</div></section>` : "";

  const others = published.filter((o) => o.slug !== b.slug).slice(0, 3);
  const more = `
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><h2 class="h">More builds</h2><a class="lab more" href="../../#builds">All_build_sheets &rarr;</a></div>
  ${others.length ? `<div class="cards">${others.map((o) => card(o, "../../")).join("")}</div>` : ""}
</div></section>`;

  const specs = b.specs.map((s) => `<div><div class="lab">${L(s.label)}</div><div class="v">${esc(s.value)}</div></div>`).join("");

  write(`builds/${b.slug}/index.html`, layout({
    title: `Build ${pad(b.number)}: ${b.title} · ${site.name}`,
    description: b.thesis,
    depth: 2,
    canonical: `/builds/${b.slug}/`,
    current: "builds",
    body: `
<div class="wrap">
  <nav class="crumbs lab" aria-label="Breadcrumb"><a href="../../">Home</a> / <a href="../../#builds">Builds</a> / <span aria-current="page">${b.title.includes(b.chassis) ? esc(b.title) : esc(b.chassis) + " " + esc(b.title)}</span></nav>
  <div class="b-hero">
  <div class="panel p-orange shadow">
    <div class="vert lab" aria-hidden="true">Build_manifest // No_${pad(b.number)}</div>
    <div class="lab">Build ${pad(b.number)} // ${L(b.kicker || "Feature")}</div>
    <div class="chassis big" style="margin-top:18px" aria-hidden="true">${esc(b.chassis)}</div>
    <h1 class="h">${esc(b.title)}</h1>
    ${b.subtitle ? `<div class="sub">${L(b.subtitle)}</div>` : ""}
    <p class="thesis">${esc(b.thesis)}</p>
    <div class="cta"><a class="btn k" href="#parts">See all ${b.parts.length} parts</a></div>
    ${b.sample ? `<div class="sample"><span class="chip lab">Sample_entry // Format_demo</span></div>` : ""}
  </div>
  <div class="panel p-black shadow">
    ${photoBlock(b.photo, b)}
    <div class="specs">${specs}</div>
  </div>
</div></div>

${b.studio ? studioBlock(studios[b.studio], b) : ""}
<section id="parts"><div class="wrap">
  <div class="sec-head"><h2 class="h">The build</h2><span class="lab">Parts_manifest // ${b.parts.length}_items</span></div>
  <div class="manifest shadow">
    <div class="head lab" aria-hidden="true"><span>Idx</span><span>Ref</span><span>Item // install_order</span><span>Price</span></div>
    <ol class="plist">${parts}</ol>
  </div>
</div></section>
${kit}
${shine}
${more}
${submitBlock("Send us your car. The best become the next build sheet, credited and linked to your handle.")}`,
  }));
});

// ---------- assets, 404, sitemap, robots ----------
fs.cpSync(path.join(ROOT, "assets"), path.join(OUT, "assets"), { recursive: true });
write("thanks/index.html", layout({
  title: `You're on the list · ${site.name}`,
  description: site.description,
  depth: 1,
  body: `<div class="wrap"><div class="hero"><div class="panel p-orange shadow"><div class="vert lab" aria-hidden="true">Drop_list // Confirmed</div><div class="lab">Status // Confirmed</div><h1 class="h">You're on<br>the list.</h1><p class="lede">We'll email you once when Drop 01 goes live.</p><div class="cta"><a class="btn k" href="../#builds">Browse build sheets</a><a class="btn w" href="../shop/">Back to the shop</a></div></div></div></div>`,
}));
write("404.html", layout({
  title: `Not found · ${site.name}`,
  description: site.description,
  depth: -1,
  body: `<div class="wrap"><div class="hero"><div class="panel p-orange"><div class="vert lab" aria-hidden="true">Error // 404</div><h1 class="h">Wrong<br>turn.</h1><div class="cta"><a class="btn k" href="/">Back to the builds</a><a class="btn w" href="/shop/">Visit the shop</a></div></div></div></div>`,
}));
const urls = ["/", ...(merch.length ? ["/shop/"] : []), ...live.map((b) => `/builds/${b.slug}/`)];
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${site.domain}${u}</loc></url>`).join("\n")}
</urlset>`);
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${site.domain}/sitemap.xml\n`);

const drafts = builds.filter((b) => b.status === "draft").map((b) => b._file);
console.log(`Built ${live.length} live, ${published.length - live.length} coming soon, ${drafts.length} draft held${drafts.length ? ": " + drafts.join(", ") : ""}. Shop: ${merch.length} items.`);
