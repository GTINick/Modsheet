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
    // Links: every part, extra and detailing link must be a full https URL.
    [...(b.parts || []), ...(b.parts || []).flatMap((x) => [...(x.also || []), ...(x.shops || [])]), ...(b.detailing || [])].forEach((x) => {
      if (x.url && !/^https:\/\//.test(x.url)) errors.push(`${f}: link must start with https:// (${x.url})`);
    });
    if (b.studio && !studios[b.studio]) errors.push(`${f}: studio "${b.studio}" not found in content/studios`);
    // Concept guardrail: a concept must credit its studio and say its images are renders, so no one mistakes it for a real car.
    if (b.type !== undefined && !["build", "concept"].includes(b.type)) errors.push(`${f}: type must be build or concept`);
    if (b.type === "concept" && b.status === "live") {
      if (!b.studio) errors.push(`${f}: a concept needs a studio`);
      [b.photo, ...(b.gallery || [])].forEach((im, i) => {
        if (im && im.image && !im.render) errors.push(`${f}: concept image ${i + 1} needs "render": true`);
      });
    }
    // Image rights guardrail: a live sheet cannot publish a photo unless its rights are documented.
    if (b.status === "live") {
      rightsErrors(b).forEach((e) => errors.push(`${f}: ${e}`));
      (b.gallery || []).forEach((g, i) => rightsErrors({ photo: g, source: b.source }).forEach((e) => errors.push(`${f}: gallery ${i + 1}: ${e}`)));
    }
    return b;
  })
  .filter(Boolean);

// Disclosure guardrail: no affiliate link ships without the disclosure, and Amazon links need Amazon's own sentence.
const affLinks = builds
  .filter((b) => b.status !== "draft")
  .flatMap((b) => [...(b.parts || []), ...(b.parts || []).flatMap((x) => [...(x.also || []), ...(x.shops || [])]), ...(b.detailing || [])])
  .filter((x) => x.affiliate && x.url);
const hasAmazonAff = affLinks.some((x) => /^https:\/\/([a-z0-9-]+\.)*(amazon\.[a-z.]+|amzn\.to)\//i.test(x.url));
if (affLinks.length && !site.disclosure) errors.push(`site.json: affiliate links need "disclosure"`);
if (hasAmazonAff && !/As an Amazon Associate/i.test(site.amazonDisclosure || "")) errors.push(`site.json: Amazon affiliate links need "amazonDisclosure" with Amazon's required sentence`);

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

// ---------- concept label ----------
// Concepts are studio renders, not finished cars. They carry a visible tag everywhere they appear.
const isConcept = (b) => b.type === "concept";
const conceptTag = (b, extra = "") => (isConcept(b) ? `<span class="ctag lab">Concept${extra}</span>` : "");
const conceptNote = (b) => {
  const st = studios[b.studio] || {};
  return b.conceptNote || `This car is a ${st.name || "studio"} concept render, not a finished build. Every part below is a real, off the shelf part, listed in install order, so you can build the attainable version of this look yourself.`;
};

// ---------- design helpers ----------
// Monospace label style: UPPERCASE_WITH_UNDERSCORES
const L = (s = "") => esc(String(s).toUpperCase().replace(/ /g, "_"));
const crossFrame = (cls, inner = "", attrs = "") =>
  `<div class="${cls} crop o"${attrs}>${inner || `<div class="cross"><i></i></div>`}</div>`;
// Auto rotating slideshow: every 2 seconds, pauses on hover, focus, hidden tab, open lightbox, reduced motion.
const ROTATE_MS = 2000;
const slides = (items) => items.map((html, i) => `<div class="slide${i ? "" : " on"}"${i ? ' aria-hidden="true"' : ""}>${html}</div>`).join("");
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
const ROTATOR = `<script>
(function(){
  var reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("[data-rotate]").forEach(function(el){
    var s=el.querySelectorAll(".slide"); if(s.length<2) return;
    var ms=+el.dataset.rotate||2000, i=0, hold=false, t=null;
    var th=el.id?document.querySelectorAll('[data-for="'+el.id+'"] [data-go]'):[];
    function go(n){ s[i].classList.remove("on"); s[i].setAttribute("aria-hidden","true");
      i=(n+s.length)%s.length; s[i].classList.add("on"); s[i].removeAttribute("aria-hidden");
      th.forEach(function(b,k){ k===i?b.setAttribute("aria-current","true"):b.removeAttribute("aria-current"); }); }
    function tick(){ if(hold||document.hidden||document.querySelector(".lightbox[open]")) return; go(i+1); }
    function start(){ if(!reduce){ clearInterval(t); t=setInterval(tick,ms); } }
    th.forEach(function(b){ b.addEventListener("click",function(){ go(+b.dataset.go); start(); }); });
    var zone=[el].concat(Array.prototype.slice.call(th));
    zone.forEach(function(z){
      z.addEventListener("mouseenter",function(){hold=true;}); z.addEventListener("mouseleave",function(){hold=false;});
      z.addEventListener("focusin",function(){hold=true;}); z.addEventListener("focusout",function(){hold=false;});
    });
    start();
  });
})();
</script>`;
const ENGAGE = `<script>
(function(){
  var nav=document.querySelector("[data-secnav]"); if(!nav) return;
  var links=nav.querySelectorAll('a[href^="#"]'), map={};
  links.forEach(function(a){ var t=document.getElementById(a.getAttribute("href").slice(1)); if(t) map[t.id]=a; });
  if("IntersectionObserver" in window){
    var io=new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){
      links.forEach(function(a){a.removeAttribute("aria-current");}); var a=map[e.target.id]; if(a){a.setAttribute("aria-current","true");
      var ul=a.closest("ul"); if(ul) ul.scrollLeft=a.parentNode.offsetLeft-12;} } }); },{rootMargin:"-45% 0px -50% 0px"});
    Object.keys(map).forEach(function(id){ io.observe(document.getElementById(id)); });
    var bar=document.querySelector("[data-kitbar]"), hero=document.querySelector(".b-feature"), kit=document.getElementById("kit"), past=false, atKit=false;
    if(bar&&hero&&kit){
      bar.hidden=false;
      var upd=function(){ bar.classList.toggle("on", past&&!atKit); };
      new IntersectionObserver(function(es){ past=!es[0].isIntersecting; upd(); }).observe(hero);
      new IntersectionObserver(function(es){ atKit=es[0].isIntersecting; upd(); }).observe(kit);
    }
  }
  var sh=nav.querySelector("[data-share]");
  if(sh) sh.addEventListener("click",function(){
    var d={title:sh.dataset.title,url:location.href.split("#")[0]};
    if(navigator.share){ navigator.share(d).catch(function(){}); return; }
    var done=function(){ sh.textContent="Link copied"; setTimeout(function(){sh.textContent="Share";},1800); };
    if(navigator.clipboard) navigator.clipboard.writeText(d.url).then(done,function(){prompt("Copy this link",d.url);});
    else prompt("Copy this link",d.url);
  });
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
    ...(merch.length ? [["shop", "Shop", `${up}shop/`]] : []),
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
    <div class="brandblock">
      <a class="logo h" href="${home}" aria-label="${esc(site.name)} home">${wordmark()}</a>
      <div class="tagline">${esc(site.tagline)}</div>
    </div>
    <nav class="nav lab" aria-label="Main">${nav}</nav>
  </header>
</div>
<main id="main">
${body}
</main>
${body.includes('class="zoom"') ? LIGHTBOX : ""}
${body.includes("data-rotate") ? ROTATOR : ""}
${body.includes("data-secnav") ? ENGAGE : ""}
<footer><div class="wrap">
  <div class="foot-grid">
    <div>
      <a class="logo h" href="${home}">${wordmark()}</a>
      <p class="foot-tag">${esc(site.tagline)}</p>
    </div>
    <nav aria-label="Explore"><div class="lab">Explore</div><ul>
      <li><a href="${up}#builds">Build sheets</a></li>
      ${merch.length ? `<li><a href="${up}shop/">Shop</a></li>` : ""}
      <li><a href="${up}#how">How it works</a></li>
    </ul></nav>
    <nav aria-label="Contribute"><div class="lab">Contribute</div><ul>
      <li><a href="${mailto("My build")}">Submit a build</a></li>
      <li><a href="mailto:${esc(site.email)}">Contact</a></li>
      <li><a href="${up}privacy/">Privacy</a></li>
      ${socials}
    </ul></nav>
  </div>
  <p class="disclosure lab">${esc(site.disclosure)}</p>
  ${hasAmazonAff ? `<p class="disclosure lab">${esc(site.amazonDisclosure)}</p>` : ""}
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
      ${conceptTag(b)}
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
// Once anything is for sale, the copy talks about the next drop instead of the first one.
const anyLive = merch.some((m) => m.status === "live");
const notifyBlock = (source) => `
<section id="notify" style="padding-top:0"><div class="wrap">
  <div class="panel p-white notify shadow">
    <div>
      <div class="lab">Drop_list // Open</div>
      <h2 class="h">${anyLive ? "Get the next drop first." : "Get Drop 01 first."}</h2>
      <p>${anyLive ? "One email when the next shirt drops." : "One email when the shirts go live."} No spam, unsubscribe any time.</p>
    </div>
    <form class="nform" name="drop-list" method="POST" action="/thanks/" data-netlify="true" netlify-honeypot="bot-field">
      <input type="hidden" name="form-name" value="drop-list">
      <input type="hidden" name="source" value="${esc(source)}">
      <p class="hp" aria-hidden="true"><label>Leave empty <input name="bot-field" tabindex="-1" autocomplete="off"></label></p>
      <label class="lab" for="nf-email-${esc(source)}">Email</label>
      <input id="nf-email-${esc(source)}" type="email" name="email" required autocomplete="email" inputmode="email" placeholder="you@example.com">
      <label class="lab" for="nf-item-${esc(source)}">Interested in</label>
      <select id="nf-item-${esc(source)}" name="item">
        <option value="all">${anyLive ? "Every new drop" : "All of Drop 01"}</option>
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
    ${lead.photo && lead.photo.image ? `<a class="frame-link" href="builds/${esc(lead.slug)}/" aria-label="Open the ${esc(lead.title)} build">${crossFrame("frame", slides([lead.photo, ...(lead.gallery || [])].map((im) => media(im, "", lead.title))), (lead.gallery || []).length ? ` data-rotate="${ROTATE_MS}"` : "")}</a>` : crossFrame("frame", "")}
    <div class="meta-row">
      <div class="code big" aria-hidden="true">${esc(lead.chassis)}</div>
      <div class="lab" style="text-align:right">Featured_build<br><b>No. ${pad(lead.number)}</b><br>${L(lead.title)}</div>
    </div>
    <div class="grid">
      <div><div class="lab">Parts</div><div class="v">${lead.parts.length}</div></div>
      <div><div class="lab">Kit</div><div class="v">${lead.parts.some((p) => p.priceApprox && lead.bundle && lead.bundle.refs.includes(p.ref)) ? "~" : ""}${money(kitTotal(lead))}</div></div>
      <div><div class="lab">Status</div><div class="v">LIVE</div></div>
    </div>
    <div class="go"><a class="btn o" href="builds/${esc(lead.slug)}/">Open the ${esc(lead.chassis)} build</a></div>
  </div>` : "";

const shopTeaser = merch.length ? `
<section id="shop"><div class="wrap">
  <div class="sec-head"><h2 class="h">Garage goods</h2><a class="lab more" href="shop/">View_all ${merch.length}_items &rarr;</a></div>
  <div class="items">${merch.slice(0, 3).map((m) => product(m, "")).join("")}</div>
</div></section>` : "";

const featureHero = lead ? (() => {
  const imgs = [lead.photo, ...(lead.gallery || [])].filter((im) => im && im.image);
  const st = lead.studio && studios[lead.studio];
  const id = "rot-feature";
  return `
<section class="feature-sec"${published.length < 2 ? ` id="builds"` : ""}><div class="wrap">
  <div class="feature shadow">
    <a class="feature-media" href="builds/${esc(lead.slug)}/" aria-label="Open the ${esc(lead.title)} build"${imgs.length > 1 ? ` id="${id}" data-rotate="${ROTATE_MS}"` : ""}>
      ${imgs.length ? slides(imgs.map((im) => media(im, "", lead.title))) : `<div class="cross"><i></i></div>`}
    </a>
    <div class="fcrop crop o" aria-hidden="true"></div>
    <div class="feature-info">
      <div class="kicker-row"><span class="kick lab">Featured ${isConcept(lead) ? "concept" : "build"} // No. ${pad(lead.number)}</span>${conceptTag(lead)}${st ? `<span class="lab">${isConcept(lead) ? "Render" : "Concept"} by ${esc(st.name)}</span>` : ""}</div>
      <div class="f-chassis big" aria-hidden="true">${esc(lead.chassis)}</div>
      <h1 class="h f-title">${esc(lead.title)}${lead.subtitle ? `<span>${esc(lead.subtitle)}</span>` : ""}</h1>
      <p class="f-sum">${esc(lead.summary)}</p>
      <div class="f-row">
        <a class="btn o" href="builds/${esc(lead.slug)}/">Open the build</a>
        <div class="f-kv">
          <div><div class="lab">Parts</div><div class="v">${lead.parts.length}</div></div>
          <div><div class="lab">${lead.bundle ? esc(lead.bundle.name) : "Kit"}</div><div class="v">${lead.parts.some((p) => p.priceApprox && lead.bundle && lead.bundle.refs.includes(p.ref)) ? "~" : ""}${money(kitTotal(lead))}</div></div>
        </div>
      </div>
    </div>
    ${imgs.length > 1 ? `<div class="thumbs f-thumbs" data-for="${id}">${imgs.map((im, i) => `<button class="thumb-sm" type="button" data-go="${i}" aria-label="Show image ${i + 1} of ${imgs.length}"${i ? "" : ' aria-current="true"'}>${media(im, "", lead.title)}</button>`).join("")}</div>` : ""}
  </div>
</div></section>`;
})() : `
<section class="feature-sec"><div class="wrap"><div class="panel p-orange"><h1 class="h">${esc(site.tagline)}</h1><p class="lede">${esc(site.description)}</p></div></div></section>`;

const homeHtml = layout({
  title: `${site.name}: ${site.tagline}`,
  description: site.description,
  canonical: "/",
  body: `
${featureHero}

${published.length < 2 ? "" : `<section id="builds"><div class="wrap">
  <div class="sec-head"><h2 class="h">Build sheets</h2><span class="lab">${published.length}_${published.length === 1 ? "entry" : "entries"} // ${live.length}_live</span></div>
  <div class="cards${published.length % 3 === 1 && published.length % 2 === 0 ? " n4" : ""}">${published.map((b) => card(b)).join("")}</div>
</div></section>`}

<section id="how" style="padding-top:0"><div class="wrap">
  <div class="sec-head"><h2 class="h">How it works</h2><span class="lab">Sequence // 3_steps</span></div>
  <p class="sec-lede">${esc(site.description)}</p>
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
      <div><div class="h">Drop 01</div><div class="lab">${anyLive ? "Live_now<br>More_drops_coming" : "Join_the_drop_list<br>First_run_soon"}</div></div>
      <div><div class="h">Supports the site</div><div class="lab">Keeps_build_sheets_free</div></div>
    </div>
  </div>
</div>
<section><div class="wrap">
  <div class="sec-head"><h2 class="h">Drop 01</h2><span class="lab">${merch.length}_items // ${merch.filter((m) => m.status === "live").length}_available</span></div>
  <div class="items${merch.length === 4 ? " n4" : ""}">${merch.map((m) => product(m, "../")).join("")}</div>
</div></section>
${notifyBlock("shop")}`,
  }));
}

// ---------- build pages ----------
const studioBlock = (st, b, withNote = true) => `
<section class="studio-sec" id="studio"><div class="wrap">
  <div class="studio${withNote && b.designerNote ? "" : " solo"} shadow">
    <div class="panel p-black st-about">
      <div class="lab">Concept_by // Design_studio</div>
      <div class="st-name h">${esc(st.name)}</div>
      <p class="st-tag">${esc(st.tagline)}</p>
      <p>${esc(st.about)}</p>
      <div class="st-cta">
        ${st.commission ? `<a class="btn o" href="mailto:${esc(st.commission.email)}?subject=${encodeURIComponent(st.commission.subject || `${st.name} commission`)}">${esc(st.commission.label || "Commission a build")}</a>` : ""}
        ${st.url ? `<a class="btn w" href="${esc(st.url)}" rel="noopener" target="_blank">Visit ${esc(st.name)}</a>` : ""}
      </div>
    </div>
    ${withNote && b.designerNote ? `<figure class="panel p-white st-note">
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
  const all = p.image ? [p, ...(b.gallery || [])] : [];
  const id = `rot-${b.slug}`;
  const inner = all.length
    ? slides(all.map((im) => zoomable(im, "../../", b.title)))
    : `<div class="cross"><i></i></div><div class="ph lab">Owner_photo<br>Pending</div>`;
  const rot = all.length > 1 ? ` id="${id}" data-rotate="${ROTATE_MS}"` : "";
  const thumbs = all.length > 1
    ? `<div class="thumbs" data-for="${id}">${all.map((im, i) => `<button class="thumb-sm" type="button" data-go="${i}" aria-label="Show image ${i + 1} of ${all.length}"${i ? "" : ' aria-current="true"'}>${media(im, "../../", b.title)}</button>`).join("")}</div>`
    : "";
  return `${crossFrame("photo", inner, rot)}${thumbs}
    <div class="caprow lab"><span>${credit}</span><span>Frame_${pad(b.number)}</span></div>`;
};

const shopBtn = (p) =>
  p.url
    ? `<a class="shop" href="${esc(p.url)}" rel="sponsored nofollow noopener" target="_blank" aria-label="Shop ${esc(p.name)}, ${money(p.price)}"><span class="price">${money(p.price)}</span><span class="lab">Shop_it</span></a>`
    : `<span class="shop pending"><span class="price">${money(p.price)}</span><span class="lab">Link_soon</span></span>`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const ext = (url, affiliate) => `href="${esc(url)}" target="_blank" rel="${affiliate ? "sponsored nofollow noopener" : "noopener"}"`;
// A part with no fixed price (a shop service, say) reads "Quote" instead of a blank.
// Budget path: a part may carry "budget": {price, priceApprox, label}.  Parts without one cost the same either way.
const budgetPrice = (p) => (p.budget && typeof p.budget.price === "number" ? p.budget.price : p.price || 0);
const budgetApprox = (p) => (p.budget ? !!p.budget.priceApprox : !!p.priceApprox);
const priceTxt = (p) => (typeof p.price === "number" ? `${p.priceApprox ? "~" : ""}${money(p.price)}` : "Quote");

live.forEach((b) => {
  const st = b.studio && studios[b.studio];
  const up = "../../";
  const imgs = b.photo && b.photo.image ? [b.photo, ...(b.gallery || [])] : [];
  const gal = b.gallery || [];
  const total = kitTotal(b);
  const allIn = b.parts.reduce((s, p) => s + (p.price || 0), 0);
  const anyApprox = b.parts.some((p) => p.priceApprox);
  const hasBudget = b.parts.some((p) => p.budget);
  const budgetAll = b.parts.reduce((s, p) => s + budgetPrice(p), 0);
  const budgetAllApprox = b.parts.some(budgetApprox);
  const words = [b.deck, ...(b.article || []).flatMap((s) => s.body || []), b.designerNote].join(" ").split(/\s+/).length;
  const mins = Math.max(1, Math.round(words / 230));
  const credit = (im) => (im.render ? `Concept render: ${esc(im.credit || site.name)}` : `Photo: ${esc(im.credit || site.name)}`);

  const figure = (im, cap, cls = "") => `
    <figure class="art-fig${cls}">
      <div class="art-img">${zoomable(im, up, b.title)}</div>
      <figcaption><span>${esc(cap || "")}</span><span class="lab">${credit(im)}</span></figcaption>
    </figure>`;

  // ----- header -----
  const head = `
<header class="art-head"><div class="wrap">
  <nav class="crumbs lab" aria-label="Breadcrumb"><a href="${up}">Home</a> / <a href="${up}#builds">Builds</a> / <span aria-current="page">${esc(b.title)}</span></nav>
  <div class="art-kick"><span class="kick lab">Build ${pad(b.number)} // ${L(b.kicker || "Feature")}</span>${conceptTag(b)}</div>
  <h1 class="h art-title">${esc(b.title)}</h1>
  ${b.subtitle ? `<div class="art-sub lab">${L(b.subtitle)}</div>` : ""}
  <p class="art-deck">${esc(b.deck || b.thesis)}</p>
  <div class="byline lab">
    <span>Words <b>${esc(site.name)}</b></span>
    ${st ? `<span>Concept <a href="#studio"><b>${esc(st.name)}</b></a></span>` : ""}
    ${b.updated ? `<span>Updated <b><time datetime="${esc(b.updated)}">${fmtDate(b.updated)}</time></b></span>` : ""}
    <span><b>${mins} min</b> read</span>
  </div>
</div></header>`;

  const hero = imgs.length ? `
<div class="wrap art-hero">${figure(imgs[0], b.summary, " lead")}</div>` : "";

  const specs = `
<div class="wrap"><dl class="spec-strip">
  ${b.specs.map((x) => `<div><dt class="lab">${esc(x.label)}</dt><dd>${esc(x.value)}</dd></div>`).join("")}
  ${b.bundle ? `<div class="hl"><dt class="lab">${esc(b.bundle.name)}</dt><dd>${anyApprox ? "~" : ""}${money(total)}</dd></div>` : ""}
</dl></div>`;

  const notice = isConcept(b) ? `
<div class="wrap"><aside class="cnote" role="note">
  <div class="lab">Concept build</div>
  <p>${esc(conceptNote(b))}</p>
</aside></div>` : "";

  const secs = [["story", "Story"], ["parts", "Parts"], ...(b.bundle ? [["kit", "Kit"]] : []), ...(b.detailing && b.detailing.length ? [["care", "Care"]] : []), ...(st ? [["studio", "Studio"]] : [])];
  const secnav = `
<nav class="secnav" aria-label="On this page" data-secnav><div class="wrap">
  <span class="sn-title lab" aria-hidden="true">${esc(b.chassis)} // ${pad(b.number)}</span>
  <ul>${secs.map(([id, n]) => `<li><a class="lab" href="#${id}">${n}</a></li>`).join("")}</ul>
  <button class="sn-share lab" type="button" data-share data-title="${esc(b.title)} · ${esc(site.name)}">Share</button>
</div></nav>`;

  // ----- article body -----
  const body = (b.article || []).map((s, i) => `
  <section class="art-sec">
    <div class="art-label lab"><span class="n">${two(i + 1)}</span> ${esc(s.label)}</div>
    <div class="art-text">
      <h2 class="art-h">${esc(s.heading)}</h2>
      ${(s.body || []).map((t) => `<p>${esc(t)}</p>`).join("")}
    </div>
    ${s.quote && b.designerNote ? `
    <blockquote class="pull">
      <p>${esc(b.designerNote)}</p>
      <cite class="lab">Designer's note${st ? ` // ${esc(st.name)}` : ""}</cite>
    </blockquote>` : ""}
    ${Number.isInteger(s.image) && gal[s.image] ? figure(gal[s.image], s.caption, " wide") : ""}
  </section>`).join("");

  const story = `
<div class="wrap"><div id="story" class="art-body">${body || `<section class="art-sec"><div class="art-text"><p>${esc(b.thesis)}</p></div></section>`}
  <div class="art-end">
    <p>Built this look, or found a better part? <a href="${mailto(`${b.title} build sheet`)}">Tell us</a> and we will update the sheet.</p>
    <a class="btn k" href="#parts">The parts list</a>
  </div>
</div></div>`;

  // ----- parts -----
  // One black button per shop. A part can list several in "shops" (e.g. front and rear tires sold separately).
  const shopBtn = (p, url, aff, retailer, label) => `<a class="r-shop" ${ext(url, aff)} aria-label="${esc(label)} ${esc(retailer || "retailer")}: ${esc(p.name)} (opens in a new tab)"><span class="lab">${esc(label)}</span><b>${esc(retailer || "Retailer")}</b>${aff ? `<span class="aff lab">Affiliate</span>` : ""}</a>`;
  const parts = b.parts.map((p, i) => `
    <li class="row">
      <div class="r-idx big" aria-hidden="true">${two(i + 1)}</div>
      <div class="r-main">
        <div class="r-ref lab">${L(p.ref)}${p.retailer ? ` // ${L(p.retailer)}` : ""}</div>
        <h3 class="r-name"><span class="sr">Step ${i + 1}: </span>${esc(p.name)}</h3>
        <p>${esc(p.note)}</p>
        ${p.fitment ? `<details class="r-fit"><summary class="lab">Fitment notes</summary><p>${esc(p.fitment)}</p></details>` : ""}
        ${(p.also || []).length ? `<ul class="r-also">${p.also.map((a) => `<li><a class="lab" ${ext(a.url, a.affiliate)}>${esc(a.label)} &#8599;</a></li>`).join("")}</ul>` : ""}
      </div>
      <div class="r-price"><div class="v">${priceTxt(p)}</div>${p.priceNote ? `<div class="lab">${esc(p.priceNote)}</div>` : ""}${p.budget ? `<div class="r-budget lab">Budget ${p.budget.priceApprox ? "~" : ""}${money(p.budget.price)}${p.budget.label ? `<br>${esc(p.budget.label)}` : ""}</div>` : ""}</div>
      ${(p.shops || []).length
        ? `<div class="r-shops">${p.shops.map((sh) => shopBtn(p, sh.url, sh.affiliate, sh.retailer || p.retailer, sh.label)).join("")}</div>`
        : p.url
        ? shopBtn(p, p.url, p.affiliate, p.retailer, "Shop at")
        : `<span class="r-shop pending"><span class="lab">Link soon</span></span>`}
    </li>`).join("");

  const partsSec = `
<section id="parts" class="parts-sec"><div class="wrap">
  <div class="sec-head"><h2 class="h">${isConcept(b) ? "The attainable version" : "The parts"}</h2><span class="lab">${b.parts.length}_items // Install_order${b.updated ? ` // Prices_checked_${esc(b.updated.replace(/-/g, "."))}` : ""}</span></div>
  <div class="manifest2 shadow">
    <div class="m-head lab" aria-hidden="true"><span>No.</span><span>Part</span><span>Price</span><span>Where</span></div>
    <ol class="rows">${parts}</ol>
    <div class="m-total"><span class="lab">Everything on this sheet</span><span class="v">${anyApprox ? "~" : ""}${money(allIn)}</span></div>
    ${hasBudget ? `<div class="m-total m-budget"><span class="lab">Budget build, every budget path above</span><span class="v">${budgetAllApprox ? "~" : ""}${money(budgetAll)}</span></div>` : ""}
  </div>
  <p class="m-note">Links open the retailer's own page. Some earn ${esc(site.name)} a commission at no cost to you; we list the right part either way. Prices move, so check the retailer before you order.</p>
</div></section>`;

  const kitParts = b.bundle ? b.parts.filter((p) => b.bundle.refs.includes(p.ref)) : [];
  const kit = b.bundle ? `
<section id="kit" class="kit-sec"><div class="wrap">
  <div class="panel p-orange kit2 shadow">
    <div class="k-intro">
      <div class="lab">Starter kit // ${kitParts.length}_parts</div>
      <h2 class="h">${esc(b.bundle.name)}</h2>
      <p>${esc(b.bundle.pitch)}</p>
    </div>
    <ol class="k-list">${kitParts.map((p, i) => `
      <li><span class="lab">${two(i + 1)}</span><span class="k-name">${esc(p.name)}</span><span class="k-p">${priceTxt(p)}</span>${(p.shops || []).length ? `<span class="k-gos">${p.shops.map((sh) => `<a class="k-go lab" ${ext(sh.url, sh.affiliate)} aria-label="${esc(sh.label)}: ${esc(p.name)}">${esc(sh.short || "Shop")} &#8599;</a>`).join("")}</span>` : p.url ? `<a class="k-go lab" ${ext(p.url, p.affiliate)} aria-label="Shop ${esc(p.name)}">Shop &#8599;</a>` : `<span class="k-go lab">Soon</span>`}</li>`).join("")}
    </ol>
    <div class="k-total"><span class="lab">Kit total</span><span class="big">${kitParts.some((p) => p.priceApprox) ? "~" : ""}${money(total)}</span></div>
    ${kitParts.some((p) => p.budget) ? `<div class="k-budget"><span class="lab">Budget path // Start here on a first build</span><span class="v">${kitParts.some(budgetApprox) ? "~" : ""}${money(kitParts.reduce((s, p) => s + budgetPrice(p), 0))}</span></div>` : ""}
  </div>
</div></section>` : "";

  const care = b.detailing && b.detailing.length ? `
<section id="care" class="care-sec"><div class="wrap">
  <div class="sec-head"><h2 class="h">Keep it sharp</h2><span class="lab">Detail_pass // ${b.detailing.length}_steps</span></div>
  <ol class="care">${b.detailing.map((d, i) => `
    <li class="panel p-black shadow"><div class="n big" aria-hidden="true">${two(i + 1)}</div><h3 class="h">${esc(d.step)}</h3><p>${esc(d.note)}</p>
    ${d.url ? `<a class="c-go" ${ext(d.url, d.affiliate)}><span class="lab">Use</span><b>${esc(d.cta)}</b><span aria-hidden="true">&#8599;</span></a>` : `<span class="c-go na lab">Link soon</span>`}</li>`).join("")}
  </ol>
</div></section>` : "";

  const capture = `
<section id="next" class="next-sec"><div class="wrap">
  <div class="panel p-white notify next-cap shadow">
    <div>
      <div class="lab">${published.length > live.length ? `Build_${pad(b.number + 1)} // In_the_shop` : "Email_list // Open"}</div>
      <h2 class="h">Get the next build first.</h2>
      <p>One email when a new build sheet goes live. No spam, unsubscribe any time.</p>
    </div>
    <form class="nform" name="drop-list" method="POST" action="/thanks/" data-netlify="true" netlify-honeypot="bot-field">
      <input type="hidden" name="form-name" value="drop-list">
      <input type="hidden" name="source" value="build-${esc(b.slug)}">
      <input type="hidden" name="item" value="next-build">
      <p class="hp" aria-hidden="true"><label>Leave empty <input name="bot-field" tabindex="-1" autocomplete="off"></label></p>
      <label class="lab" for="nb-email">Email</label>
      <input id="nb-email" type="email" name="email" required autocomplete="email" inputmode="email" placeholder="you@example.com">
      <button class="btn o" type="submit">Send me the next build</button>
    </form>
  </div>
</div></section>`;

  const others = published.filter((o) => o.slug !== b.slug).slice(0, 3);
  const more = others.length ? `
<section class="more-sec"><div class="wrap">
  <div class="sec-head"><h2 class="h">More builds</h2><a class="lab more" href="${up}#builds">All_build_sheets &rarr;</a></div>
  <div class="cards">${others.map((o) => card(o, up)).join("")}</div>
</div></section>` : "";

  const ld = { "@context": "https://schema.org", "@type": "Article", headline: b.title, description: b.deck || b.summary, dateModified: b.updated, image: imgs.map((im) => `${site.domain}/${im.image}`), publisher: { "@type": "Organization", name: site.name } };

  write(`builds/${b.slug}/index.html`, layout({
    title: `${b.title}: the build sheet · ${site.name}`,
    description: `${b.summary} ${b.parts.length} real parts with links, in install order.`,
    depth: 2,
    canonical: `/builds/${b.slug}/`,
    current: "builds",
    body: `<article class="bsheet">
${head}
${hero}
${specs}
${notice}
${secnav}
${story}
${partsSec}
${kit}
${care}
</article>
${capture}
${st ? studioBlock(st, b, false) : ""}
${more}
${submitBlock("Send us your car. The best become the next build sheet, credited and linked to your handle.")}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
  }));
});

// ---------- assets, 404, sitemap, robots ----------
fs.cpSync(path.join(ROOT, "assets"), path.join(OUT, "assets"), { recursive: true });
write("thanks/index.html", layout({
  title: `You're on the list · ${site.name}`,
  description: site.description,
  depth: 1,
  body: `<div class="wrap"><div class="hero"><div class="panel p-orange shadow"><div class="vert lab" aria-hidden="true">Email_list // Confirmed</div><div class="lab">Status // Confirmed</div><h1 class="h">You're on<br>the list.</h1><p class="lede">We'll email you when the next build sheet goes live.</p><div class="cta"><a class="btn k" href="../#builds">Browse build sheets</a>${merch.length ? `<a class="btn w" href="../shop/">Back to the shop</a>` : ""}</div></div></div></div>`,
}));
write("404.html", layout({
  title: `Not found · ${site.name}`,
  description: site.description,
  depth: -1,
  body: `<div class="wrap"><div class="hero"><div class="panel p-orange"><div class="vert lab" aria-hidden="true">Error // 404</div><h1 class="h">Wrong<br>turn.</h1><div class="cta"><a class="btn k" href="/">Back to the builds</a>${merch.length ? `<a class="btn w" href="/shop/">Visit the shop</a>` : ""}</div></div></div></div>`,
}));
// Privacy policy: copy lives in site.json so it can change without touching code.
const pv = site.privacy;
write("privacy/index.html", layout({
  title: `Privacy · ${site.name}`,
  description: `How ${site.name} handles your information.`,
  depth: 1,
  canonical: "/privacy/",
  body: `<section class="legal-sec"><div class="wrap"><div class="panel p-white shadow legal">
  <div class="lab">Policy // Updated ${esc(pv.updated)}</div>
  <h1 class="h">Privacy</h1>
  <p class="lede">${esc(pv.intro)}</p>
  ${pv.sections.map((s) => `<h2 class="h">${esc(s.heading)}</h2>${s.body.map((t) => `<p>${esc(t).replace("{email}", `<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>`)}</p>`).join("")}`).join("\n  ")}
</div></div></section>`,
}));
const urls = ["/", ...(merch.length ? ["/shop/"] : []), ...live.map((b) => `/builds/${b.slug}/`), "/privacy/"];
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${site.domain}${u}</loc></url>`).join("\n")}
</urlset>`);
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${site.domain}/sitemap.xml\n`);

const drafts = builds.filter((b) => b.status === "draft").map((b) => b._file);
console.log(`Built ${live.length} live, ${published.length - live.length} coming soon, ${drafts.length} draft held${drafts.length ? ": " + drafts.join(", ") : ""}. Shop: ${merch.length} items.`);
