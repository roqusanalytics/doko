// Guards the built landing pages' SEO/GEO contract (English at /, Lithuanian at /lt/). Runs after `astro build` (see package.json).
import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const text = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const privateRepo = /https:\/\/(?:api\.)?github\.com\/(?:repos\/)?roqusanalytics\/doko(?:\/|#|["'\s])/;
for (const file of ['../src/components/Landing.astro', '../src/scripts/landing.js', '../src/data/software.ts', '../public/llms.txt'])
  assert.ok(!privateRepo.test(readFileSync(new URL(file, import.meta.url), 'utf8')), `${file}: public page must not link to the private source repository`);
const pages = [
  { file: 'index.html', lang: 'en', url: 'https://doko.lt/' },
  { file: 'lt/index.html', lang: 'lt', url: 'https://doko.lt/lt/' },
];

for (const { file, lang, url } of pages) {
  const html = readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8');
  const at = msg => `${file}: ${msg}`;
  assert.ok(!privateRepo.test(html), at('no private source repository URL'));
  assert.match(html, new RegExp(`<html lang="${lang}"`), at(`html lang=${lang}`));
  assert.ok(html.includes(`<link rel="canonical" href="${url}">`), at(`canonical ${url}`));
  for (const [hl, href] of [['en', 'https://doko.lt/'], ['lt', 'https://doko.lt/lt/'], ['x-default', 'https://doko.lt/']])
    assert.ok(html.includes(`<link rel="alternate" hreflang="${hl}" href="${href}">`), at(`hreflang ${hl}`));
  assert.ok(html.includes(`<meta property="og:url" content="${url}">`), at('og:url'));
  assert.match(html, /<meta property="og:locale" content="[a-z]{2}_[A-Z]{2}">/, at('og:locale'));
  assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+">/, at('absolute og:image'));
  const title = text(html.match(/<title>([^<]*)<\/title>/)[1]);
  assert.ok(title.length >= 30 && title.length <= 65, at(`title length ${title.length}`));
  const desc = text(html.match(/<meta name="description" content="([^"]*)"/)[1]);
  assert.ok(desc.length >= 120 && desc.length <= 160, at(`description length ${desc.length}`));
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, at('exactly one h1'));
  assert.ok(!/—/.test(text(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ''))), at('no em dashes in visible copy'));

  for (const img of html.match(/<img\b[^>]*>/g) || []) assert.match(img, /\salt="/, at(`img without alt: ${img}`));

  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  const app = ld.find(x => x['@type'] === 'SoftwareApplication');
  assert.ok(app && app.offers.price === '0' && app.operatingSystem && app.url === url, at('SoftwareApplication schema'));
  const faq = ld.find(x => x['@type'] === 'FAQPage');
  const visible = [...html.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map(m => [text(m[1]), text(m[2])]);
  assert.ok(visible.length > 0, at('visible FAQ'));
  assert.deepEqual(faq.mainEntity.map(q => [q.name, q.acceptedAnswer.text]), visible, at('FAQ schema matches visible FAQ'));
  console.log(`landing SEO ok (${file}): "${title}" (${title.length}), description ${desc.length} chars, ${visible.length} FAQ entries`);
}

for (const f of ['robots.txt', 'llms.txt', 'sitemap.xml', 'og.png', 'favicon.svg']) assert.ok(existsSync(new URL(`../dist/${f}`, import.meta.url)), `missing dist/${f}`);
const sitemap = readFileSync(new URL('../dist/sitemap.xml', import.meta.url), 'utf8');
for (const { url } of pages) assert.ok(sitemap.includes(`<loc>${url}</loc>`), `sitemap lists ${url}`);
