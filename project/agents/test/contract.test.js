/**
 * Contract tests for the agent pipeline: web-research output -> information-parser.
 *
 * These check the agents work TOGETHER, not just that each file is valid JS.
 * Run: npm run test:agents
 * Offline: the research test loads a local fixture page via file://.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { gather } = require('../web-research/researcher');
const { parse } = require('../information-parser/parser');

// Build the same shape gather() returns, for parser-only tests.
const raw = (html, extra = {}) => ({
  success: true,
  url: 'https://example.test/page',
  title: '',
  textContent: '',
  metaTags: [],
  links: [],
  html,
  ...extra,
});

const assertContract = (r) => {
  assert.equal(typeof r.success, 'boolean', 'every result has success');
  if (r.success) assert.equal(typeof r.type, 'string', 'successful results have a type');
  else assert.equal(typeof r.error, 'string', 'failed results have an error');
};

// Silence the parser's routing logs during tests.
const log = console.log;
test.before(() => { console.log = () => {}; });
test.after(() => { console.log = log; });

test('research -> parser end to end (local page)', { timeout: 60_000 }, async () => {
  const url = pathToFileURL(path.join(__dirname, 'fixtures/plain-page.html')).href;
  const r = await gather(url, { scrollDepth: 1 });
  assert.equal(r.success, true, r.error);
  assert.equal(typeof r.html, 'string', 'gather returns html for the parser');
  assert.match(r.html, /Banana Bread/);
  assert.ok(Array.isArray(r.links), 'gather returns the links, not just a count');
  assert.equal(r.links.length, r.linksCount);
  assert.ok(r.links.some((l) => l.href === 'https://example.org/home'), 'nav links are kept');

  const p = await parse(r);
  assertContract(p);
  assert.equal(p.success, true, p.error);
  assert.equal(p.type, 'generic', 'a recipe is not a job/article/company/product');
});

test('generic parser handles unknown pages', async () => {
  const p = await parse(raw('<h1>Hello</h1>', { textContent: 'Hello world, write to hi@example.org', title: 'Hello' }));
  assertContract(p);
  assert.equal(p.success, true, p.error);
  assert.equal(p.type, 'generic');
  assert.deepEqual(p.extracted_data.emails, ['hi@example.org']);
});

test('the word "apply" alone does not make a page a job', async () => {
  const p = await parse(raw('<h1>Banana Bread</h1>', {
    title: 'Banana Bread Recipe',
    textContent: 'Mix flour. Apply butter to the pan. Bake.',
  }));
  assert.equal(p.type, 'generic');
});

test('a real job page without JSON-LD is detected as a job', async () => {
  const p = await parse(raw('<h1>Frontend Developer</h1><div class="job-description">Build UI.</div>', {
    url: 'https://acme.test/careers/frontend-developer',
    title: 'Frontend Developer - Careers at Acme',
    textContent: 'Frontend Developer. Full-time. Responsibilities: build UI. Qualifications: 3+ years of experience. Apply now.',
  }));
  assertContract(p);
  assert.equal(p.type, 'job');
});

test('JSON-LD JobPosting is found even when another item comes first', async () => {
  const ld = [
    { '@type': 'WebSite', name: 'Acme' },
    { '@type': 'JobPosting', title: 'Senior Engineer', hiringOrganization: { name: 'Acme' }, description: 'Build things.' },
  ];
  const p = await parse(raw(`<script type="application/ld+json">${JSON.stringify(ld)}</script><h1>Senior Engineer</h1>`));
  assertContract(p);
  assert.equal(p.type, 'job');
  assert.equal(p.company, 'Acme');
  assert.equal(p.title, 'Senior Engineer');
});

test('JSON-LD @graph is searched', async () => {
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'BreadcrumbList' },
    { '@type': 'Product', name: 'Desk Lamp', offers: { price: '39.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } },
  ] };
  const p = await parse(raw(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`));
  assert.equal(p.type, 'product');
  assert.equal(p.name, 'Desk Lamp');
  assert.equal(p.available, true);
});

test('@type given as an array and Article subtypes are understood', async () => {
  const ld = { '@type': ['NewsArticle'], headline: 'Big News', author: { name: 'Sam Lee' } };
  const p = await parse(raw(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`));
  assertContract(p);
  assert.equal(p.type, 'article');
  assert.equal(p.headline, 'Big News');
});

test('og:type without JSON-LD reads the page instead of returning empty fields', async () => {
  const html = '<head><meta property="og:type" content="article"></head><body><article><h1>Real Headline</h1><p>Body text here.</p></article></body>';
  const p = await parse(raw(html, { title: 'Real Headline', textContent: 'Real Headline Body text here.' }));
  assert.equal(p.type, 'article');
  assert.ok(p.headline, 'headline is filled from the page');
  assert.match(p.fullBody, /Body text here/);
});

test('bad input fails cleanly', async () => {
  const p = await parse({ success: false, error: 'blocked' });
  assertContract(p);
  assert.equal(p.success, false);
});
