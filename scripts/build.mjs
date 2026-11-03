#!/usr/bin/env node
// Builds openstuff.dev into dist/ from catalog.json.
//
//   node scripts/build.mjs            reads versions and release dates from npm
//   node scripts/build.mjs --offline  uses "version" and "released" from catalog.json instead
//
// No dependencies beyond Node 20. Run `npx os-tokens` first (npm run build does both).

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OFFLINE = process.argv.includes('--offline');
const SITE_URL = 'https://openstuff.dev';
const GITHUB = 'https://github.com/openstuff-dev';

// ---------- helpers ----------

const esc = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const read = (path) => readFile(join(ROOT, path), 'utf8');

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const count = (n, one, many) => `${WORDS[n] ?? n} ${n === 1 ? one : many}`;

const formatDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '';

// "OpenPurpose" → Open<b>Purpose</b>; "OpenStuff Design" → Open<b>Stuff</b> Design.
function nameHtml(name) {
  const m = /^Open(\S+)(.*)$/.exec(name);
  return m ? `Open<b>${esc(m[1])}</b>${esc(m[2])}` : esc(name);
}

const repoUrl = (repo) => (repo.startsWith('http') ? repo : `https://github.com/${repo}`);

const RING = 'M16 1.5a14.5 14.5 0 1 0 0 29a14.5 14.5 0 1 0 0-29Zm0 4a10.5 10.5 0 1 1 0 21a10.5 10.5 0 1 1 0-21Z';
const CORE = 'M10.75 16a5.25 5.25 0 1 0 10.5 0a5.25 5.25 0 1 0 -10.5 0Z';

// A project's icon is its favicon: the OpenStuff ring plus one coloured pictogram path.
async function readIcon(path) {
  const svg = await read(join('public', path));
  const paths = [...svg.matchAll(/<path\b([^>]*)>/g)].map(([, attrs]) => ({
    d: /\bd="([^"]+)"/.exec(attrs)?.[1],
    fill: /\bfill="(#[0-9a-fA-F]{3,8})"/.exec(attrs)?.[1],
  }));
  const pictogram = paths.findLast((p) => p.fill && p.d);
  if (!pictogram) throw new Error(`${path}: no coloured pictogram path found`);
  return { d: pictogram.d, color: pictogram.fill };
}

const mark = (d, size) =>
  `<svg viewBox="0 0 32 32"${size ? ` width="${size}" height="${size}"` : ''} aria-hidden="true"><path fill="var(--ring)" fill-rule="evenodd" d="${RING}"/><path fill="var(--c)" d="${esc(d)}"/></svg>`;

const icon = {
  copy: '<svg class="i-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  check: '<svg class="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  sun: '<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  github: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>',
};

// ---------- npm ----------

async function npmInfo(name) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const version = data['dist-tags']?.latest;
    return { version, released: data.time?.[version] };
  } finally {
    clearTimeout(timer);
  }
}

async function withVersions(packages) {
  return Promise.all(
    packages.map(async (pkg) => {
      if (!OFFLINE) {
        try {
          return { ...pkg, ...(await npmInfo(pkg.name)) };
        } catch (error) {
          console.warn(`  ! ${pkg.name}: couldn't read npm (${error.message}); using catalog.json`);
        }
      }
      return pkg;
    }),
  );
}

// ---------- page parts ----------

let WORDMARK = '';

function head({ title, description, path = '/' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#fcfbf8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121110" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE_URL}${path}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400..700&amp;family=Geist+Mono:wght@400..500&amp;display=swap">
<link rel="stylesheet" href="/assets/site.css">
<script>try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<script type="module" src="/assets/site.js"></script>
</head>`;
}

function topbar() {
  return `<a class="skip" href="#main">Skip to content</a>
<header class="topbar">
<div class="wrap">
<a class="brand" href="/" aria-label="OpenStuff home">
<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path fill="var(--ring)" fill-rule="evenodd" d="${RING}"/><path fill="var(--os-brand-default)" d="${CORE}"/></svg>
${WORDMARK}
</a>
<nav class="nav" aria-label="Main">
<a href="/#sites">Sites</a>
<a href="/#packages">Packages</a>
<a href="https://design.openstuff.dev">Design system</a>
</nav>
<div class="actions">
<button class="iconbtn" type="button" data-theme-toggle aria-label="Switch theme" hidden>${icon.sun}${icon.moon}</button>
<a class="iconbtn" href="${GITHUB}" aria-label="OpenStuff on GitHub">${icon.github}</a>
</div>
</div>
</header>`;
}

function footer(projects) {
  const links = projects
    .map((p) => `<a href="${esc(p.url)}">${esc(p.name.replace(/^Open(Stuff )?/, ''))}</a>`)
    .join('\n');
  return `<footer class="foot">
<div class="wrap">
<span class="made"><svg viewBox="0 0 32 32" aria-hidden="true"><path fill="var(--ring)" fill-rule="evenodd" d="${RING}"/><path fill="var(--os-brand-default)" d="${CORE}"/></svg>Made by OpenStuff · MIT licence</span>
<nav aria-label="Footer">
${links}
<a href="${GITHUB}">GitHub</a>
<a href="https://www.npmjs.com/~turmz">npm</a>
</nav>
</div>
</footer>`;
}

// Projects fill rings outward: 8, then 14, then 22. A ring is drawn only once it has projects,
// and the orbit zooms out to fit the outermost ring, so it never has empty space around it.
function orbit(projects) {
  const rings = [
    { r: 100, cap: 8 },
    { r: 148, cap: 14 },
    { r: 194, cap: 22 },
  ];
  const used = [];
  let rest = projects;
  for (const ring of rings) {
    const items = rest.slice(0, ring.cap);
    rest = rest.slice(ring.cap);
    if (items.length) used.push({ ...ring, items });
  }
  if (rest.length) console.warn(`  ! The orbit holds 44 projects; ${rest.length} more are left out of it.`);

  const box = 2 * (used.at(-1)?.r ?? 100) + 56;
  const c = box / 2;
  const pct = (v) => ((v / box) * 100).toFixed(2) + '%';
  const coreSize = 92;
  const out = used.map((ring, ri) => {
    const start = -60 + ri * 17;
    const icons = ring.items.map((p, i) => {
      const a = ((start + (360 / ring.items.length) * i) * Math.PI) / 180;
      return `<a class="pict" href="${esc(p.url)}" aria-label="${esc(p.name)}" title="${esc(p.name)}" style="left: ${pct(c + ring.r * Math.cos(a))}; top: ${pct(c + ring.r * Math.sin(a))}; width: ${pct(30)}"><svg viewBox="9.6 9.6 12.8 12.8" aria-hidden="true"><path fill="${p.color}" d="${esc(p.d)}"/></svg></a>`;
    });
    return `<div class="ring ring-${ri}">
<div class="ring-line" aria-hidden="true" style="inset: ${pct(c - ring.r)}"></div>
${icons.join('\n')}
</div>`;
  });
  return `<nav class="orbit" aria-label="All OpenStuff projects">
<svg class="core" viewBox="0 0 32 32" aria-hidden="true" style="left: ${pct(c - coreSize / 2)}; top: ${pct(c - coreSize / 2)}; width: ${pct(coreSize)}; height: ${pct(coreSize)}"><path fill="var(--ring)" fill-rule="evenodd" d="${RING}"/><path class="core-dot" fill="var(--os-brand-default)" d="${CORE}"/></svg>
${out.join('\n')}
</nav>`;
}

async function preview(p) {
  if (p.preview && existsSync(join(ROOT, p.preview))) {
    const html = (await read(p.preview)).replace(/^\s*<!--[\s\S]*?-->\s*/, '');
    return html.replaceAll('{{mark}}', mark(p.d, 16));
  }
  // No drawn preview yet: the project's name and tagline on the OpenStuff grid.
  return `<div class="mini-nav">${mark(p.d)}<b>${nameHtml(p.name)}</b><span class="mini-cta">Website</span></div>
<div class="mini-grid" style="position: absolute; inset: 40px 0 0; opacity: 0.4; -webkit-mask-image: radial-gradient(60% 60% at 50% 40%, #000, transparent 75%); mask-image: radial-gradient(60% 60% at 50% 40%, #000, transparent 75%)"></div>
<div class="shot-default" style="position: absolute; inset: 40px 0 0"><p class="mini-h">${esc(p.tagline)}</p></div>`;
}

async function card(p, i) {
  const host = new URL(p.url).host;
  return `<article class="card" style="--c: ${p.color}">
<a class="card-shot" href="${esc(p.url)}" aria-label="Visit ${esc(host)}">
<div class="chrome"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="url">${esc(host)}</span></div>
<div class="viewport"><div class="shot" aria-hidden="true">
${await preview(p)}
</div></div>
</a>
<div class="card-body">
<div class="card-title">${mark(p.d)}<h3>${nameHtml(p.name)}</h3><span class="card-num">${String(i + 1).padStart(2, '0')}</span></div>
<p class="card-tagline">${esc(p.tagline)}</p>
<p class="card-desc">${esc(p.description)}</p>
<div class="card-links">
<a class="ul" href="${esc(p.url)}">Website</a>
${p.repo ? `<a class="ul" href="${esc(repoUrl(p.repo))}">Source</a>` : ''}
</div>
</div>
</article>`;
}

function chains(packages, chainList = []) {
  const short = (name) => name.replace(/^@openstuff-dev\//, '');
  const inChain = new Set(chainList.flat());
  const loose = packages.map((p) => p.name).filter((n) => !inChain.has(n));
  if (!chainList.length) return '';
  const rows = chainList.map((chain, i) => {
    const chips = chain.map((n) => `<span class="chip">${esc(short(n))}</span>`).join('<span aria-hidden="true">→</span>');
    const extra = i === chainList.length - 1 && loose.length ? `<span class="loose">+ ${esc(loose.map(short).join(', '))}</span>` : '';
    return `<li>${chips}${extra}</li>`;
  });
  const label = chainList.map((c) => c.map(short).join(' → ')).join('; ');
  return `<ul class="chains" aria-label="How the packages build on each other: ${esc(label)}">${rows.join('')}</ul>`;
}

function packageRow(p) {
  const short = p.name.replace(/^(@[^/]+\/)/, '<span>$1</span>');
  return `<tr>
<td class="name"><a class="ul" href="https://www.npmjs.com/package/${esc(p.name)}">${short}</a></td>
<td class="desc">${esc(p.description)}</td>
<td class="ver">${esc(p.version ?? '—')}</td>
<td class="date">${p.released ? `<time datetime="${esc(p.released)}">${esc(formatDate(p.released))}</time>` : '—'}</td>
<td class="install"><code>${esc(p.install)}</code><button class="copy" type="button" data-copy="${esc(p.install)}" aria-label="Copy install command for ${esc(p.name)}" hidden>${icon.copy}${icon.check}</button></td>
</tr>`;
}

// ---------- build ----------

async function main() {
  const catalog = JSON.parse(await read('catalog.json'));
  WORDMARK = (await read('public/icons/openstuff-wordmark.svg'))
    .replace(/<title>.*?<\/title>/, '')
    .replace('role="img"', 'class="word" aria-hidden="true" focusable="false"');

  const projects = await Promise.all(
    catalog.projects.map(async (p) => {
      for (const key of ['name', 'url', 'icon', 'tagline']) {
        if (!p[key]) throw new Error(`catalog.json: project ${p.name ?? '?'} is missing "${key}"`);
      }
      return { ...p, ...(await readIcon(p.icon)) };
    }),
  );
  console.log(`  ${projects.length} projects`);

  const packages = await withVersions(catalog.packages);
  console.log(`  ${packages.length} packages${OFFLINE ? ' (offline)' : ''}`);

  const builtOn = formatDate(new Date().toISOString());
  const description = 'Small, open tools you can run yourself: self-hostable apps and the npm packages they’re built from. MIT licensed.';

  const index = `${head({ title: 'OpenStuff — small, open tools you can run yourself', description })}
<body>
${topbar()}
<main id="main">

<section class="intro">
<div class="wrap">
<div class="intro-copy">
<h1>Small, open tools you can run yourself.</h1>
<p class="intro-sub">OpenStuff is a handful of self-hostable apps, and the npm packages they’re built from. All of it is MIT licensed and on GitHub.</p>
<div class="intro-links">
<a class="ul" href="#sites">${count(projects.length, 'site', 'sites')}</a>
<a class="ul" href="#packages">${count(packages.length, 'package', 'packages')}</a>
<a class="ul muted" href="${GITHUB}">github.com/openstuff-dev</a>
</div>
</div>
<div class="orbit-wrap">
${orbit(projects)}
</div>
</div>
</section>

<section class="section" id="sites">
<div class="wrap">
<div class="section-head">
<h2>Sites</h2>
<p class="muted">Every project has its own page. Click a preview to go there.</p>
</div>
<div class="cards">
${(await Promise.all(projects.map(card))).join('\n')}
</div>
</div>
</section>

<section class="section section-alt" id="packages">
<div class="wrap">
<div class="pkg-head">
<div>
<h2>Packages</h2>
<p>Published under <span class="scope">@openstuff-dev</span> on npm. The sites above are built from them, and anything you build can use them too.</p>
</div>
${chains(packages, catalog.packageChains)}
</div>
<div class="table-box">
<table class="pkgs">
<thead><tr><th scope="col">Package</th><th scope="col">What it does</th><th scope="col">Version</th><th scope="col">Released</th><th scope="col">Install</th></tr></thead>
<tbody>
${packages.map(packageRow).join('\n')}
</tbody>
</table>
</div>
<p class="pkg-foot">Starting something new? <span class="mono">npm create @openstuff-dev/app</span> sets all of this up in one go. Versions checked on npm ${esc(builtOn)}.</p>
</div>
</section>

<section class="section add">
<div class="wrap">
<h2>Made something that belongs here?</h2>
<p>This page is built from one <span class="mono">catalog.json</span> on GitHub Pages. Add an entry, open a pull request, and it shows up when it merges. <a class="ul" href="${GITHUB}/openstuff.dev">Open the repo</a></p>
</div>
</section>

</main>
${footer(projects)}
</body>
</html>
`;

  const notFound = `${head({ title: 'Not found · OpenStuff', description, path: '/404' })}
<body>
${topbar()}
<main id="main" class="not-found">
<div class="wrap">
<span class="code">404</span>
<h1>Nothing lives here.</h1>
<p>The page may have moved to one of the project sites. <a class="ul" href="/">Back to everything</a></p>
</div>
</main>
${footer(projects)}
</body>
</html>
`;

  // CSS: the ui layers, reset and base, the generated tokens in their layer, then the site.
  const tokensPath = join(ROOT, 'src/tokens/tokens.css');
  if (!existsSync(tokensPath)) throw new Error('src/tokens/tokens.css is missing. Run `npx os-tokens` first.');
  const ui = (file) => read(`node_modules/@openstuff-dev/ui/css/${file}`);
  const css = [
    '/* Built by scripts/build.mjs. Edit src/site.css or tokens.config.json instead. */',
    await ui('layers.css'),
    await ui('reset.css'),
    `@layer os.tokens {\n${await readFile(tokensPath, 'utf8')}\n}`,
    await ui('base.css'),
    await read('src/site.css'),
  ].join('\n\n');

  await rm(DIST, { recursive: true, force: true });
  await mkdir(join(DIST, 'assets'), { recursive: true });
  await cp(join(ROOT, 'public'), DIST, { recursive: true });
  await writeFile(join(DIST, 'assets/site.css'), css);
  await cp(join(ROOT, 'src/site.js'), join(DIST, 'assets/site.js'));
  await writeFile(join(DIST, 'index.html'), index);
  await writeFile(join(DIST, '404.html'), notFound);
  await writeFile(join(DIST, '.nojekyll'), '');
  console.log('  → dist/');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
