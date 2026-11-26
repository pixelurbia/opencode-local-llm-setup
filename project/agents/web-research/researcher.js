const { chromium } = require('playwright');
const { getStealthConfig, rotateUserAgent } = require('./utils/anti-detect');
const { waitForContent, simulateScroll, waitUntilStable } = require('./utils/handlers');

/**
 * Web Research Agent — navigates to a URL with browser automation,
 * handles anti-bot patterns and JS rendering, extracts structured content.
 */

// Pre-generated pool of realistic user agents (browsers + OS combos)
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
];

const DEFAULT_OPTIONS = {
  headless: true,
  timeout: 30000,          // navigation timeout per page
  waitUntil: 'networkidle', // wait for network to settle
  scrollDepth: 3,          // number of scrolls to simulate
  extractLinks: true,      // extract all links from page
  extractImages: false,    // extract image URLs
  maxContentLength: 50000, // cap extracted text length
  includeHtml: true,       // return raw HTML (the information-parser needs it)
};

/**
 * Gather content from a URL.
 * @param {string} url - The URL to visit and scrape
 * @param {Object} [options] - Override defaults
 * @returns {Promise<Object>} Structured content result
 */
async function gather(url, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let browser;

  try {
    // Validate URL format before proceeding
    if (!url || typeof url !== 'string' || !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
      return { error: `Invalid URL format: ${url}`, success: false };
    }

    // Launch browser with stealth settings
    browser = await chromium.launch(getStealthConfig(opts));

    const context = await browser.newContext({
      userAgent: rotateUserAgent(USER_AGENTS),
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      // Disable automation indicators
      bypassCSP: true,
    });

    const page = await context.newPage();

    // Set up request/response interceptors for diagnostics
    let wasBlocked = false;
    page.on('requestfailed', (req) => {
      if (req.failure().errorText?.includes('net::ERR_BLOCKED_BY_CLIENT')) {
        wasBlocked = true;
      }
    });

    // Navigate to URL with retry logic
    let html;
    try {
      await page.goto(url, {
        waitUntil: opts.waitUntil,
        timeout: opts.timeout,
      });
      html = await page.content();
    } catch (navErr) {
      // Try one more time on timeout (content may have loaded slowly)
      if (navErr.message?.includes('Timeout')) {
        try {
          html = await page.content();
        } catch {
          return { error: `Navigation timed out after ${opts.timeout}ms: ${url}`, success: false };
        }
      } else {
        return { error: `Navigation failed: ${navErr.message}`, url, success: false };
      }
    }

    // If page appears empty or is a known blockpage pattern, flag it
    const title = await page.title();
    const finalUrl = page.url();

    if (!html || html.length < 200) {
      return {
        url: finalUrl,
        title,
        success: false,
        error: `Page content too short (${html?.length || 0} chars). Possible bot block.`,
        diagnostics: { wasBlocked, redirectCount: 0 },
      };
    }

    // Simulate scrolling to trigger lazy-loaded content
    await simulateScroll(page, opts.scrollDepth);

    // Wait for dynamic content to stabilize after scroll
    await waitUntilStable(page);

    // Re-read HTML after scrolls (lazy content may have loaded)
    html = await page.content();

    // Extract links/images BEFORE text: extractTextContent removes nav/footer
    // from the live page, which would otherwise drop their links.
    const links = opts.extractLinks ? await extractLinks(page) : [];
    const images = opts.extractImages ? await extractImages(page) : [];
    const textContent = await extractTextContent(page, opts.maxContentLength);

    // Extract meta tags for SEO/diagnostic info
    const metaTags = await page.evaluate(() => {
      const metas = document.querySelectorAll('meta[name], meta[property]');
      return Array.from(metas).map((m) => ({
        name: m.getAttribute('name') || m.getAttribute('property'),
        content: m.getAttribute('content'),
      }));
    });

    // Detect if JS was required (check for common SSR frameworks)
    const detectedFramework = await detectFramework(page);

    return {
      success: true,
      url: finalUrl,
      originalUrl: url,
      title,
      contentLength: textContent.length,
      textContent: truncate(textContent, opts.maxContentLength),
      html: opts.includeHtml ? html : undefined,
      links,
      linksCount: links.length,
      images,
      imagesCount: images.length,
      metaTags,
      detectedFramework,
      diagnostics: {
        wasBlocked,
        headless: opts.headless,
        userAgent: await page.evaluate(() => navigator.userAgent),
        platform: await page.evaluate(() => navigator.platform),
        language: await page.evaluate(() => navigator.language),
      },
    };
  } catch (err) {
    return { error: err.message || String(err), url, success: false };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Extract visible text content from the page.
 */
async function extractTextContent(page, maxLength) {
  const text = await page.evaluate((limit) => {
    // Remove script/style/noise elements before extracting text
    document.querySelectorAll('script, style, nav, footer, header[role="banner"], .ads, .ad, [class*="advertisement"]').forEach(
      (el) => el.remove()
    );

    const body = document.body;
    if (!body) return '';

    // Use a range to extract text node content while preserving paragraph breaks
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName?.toLowerCase();
        // Skip elements with no visible text (zero whitespace-only content)
        if (/^(script|style|noscript)$/.test(tag)) return NodeFilter.FILTER_REJECT;
        // Keep headings, paragraphs, list items, and general text
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let result = '';
    while (walker.nextNode()) {
      const nodeValue = walker.currentNode.nodeValue.trim();
      if (nodeValue) {
        result += '\n' + nodeValue;
      }
    }

    // Collapse excessive whitespace
    return result.replace(/\n{3,}/g, '\n\n').trim().slice(0, limit);
  }, maxLength || DEFAULT_OPTIONS.maxContentLength);

  return text || '';
}

/**
 * Extract all links from the page.
 */
async function extractLinks(page) {
  const links = await page.evaluate(() => {
    const anchors = document.querySelectorAll('a[href]');
    return Array.from(anchors)
      .map((a) => ({
        text: a.textContent?.trim().slice(0, 200),
        href: a.href,
        rel: a.getAttribute('rel'),
        target: a.getAttribute('target'),
      }))
      // Deduplicate by href
      .filter((link, index, self) => index === self.findIndex((l) => l.href === link.href));
  });

  return links;
}

/**
 * Extract image URLs from the page.
 */
async function extractImages(page) {
  const images = await page.evaluate(() => {
    const imgs = document.querySelectorAll('img[src], img[data-src]');
    return Array.from(imgs)
      .map((img) => ({
        src: img.src || img.dataset?.src,
        alt: img.alt,
        width: img.width,
        height: img.height,
      }))
      // Deduplicate by src
      .filter((img, index, self) => index === self.findIndex((i) => i.src === img.src));
  });

  return images;
}

/**
 * Detect what framework the page is built with.
 */
async function detectFramework(page) {
  const info = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script[src]');
    let framework = null;

    for (const script of scripts) {
      const src = script.src.toLowerCase();
      if (src.includes('react') || script.innerHTML?.includes('react')) framework = 'React';
      else if (src.includes('vue')) framework = 'Vue';
      else if (src.includes('angular')) framework = 'Angular';
      else if (src.includes('next')) framework = 'Next.js';
      else if (src.includes('nuxt')) framework = 'Nuxt';
    }

    // Check for meta tags that hint at the stack
    const generator = document.querySelector('meta[name="generator"]');
    if (generator?.content) {
      const content = generator.content.toLowerCase();
      if (content.includes('wordpress')) framework = 'WordPress';
      else if (content.includes('gatsby')) framework = 'Gatsby';
      else if (framework !== 'Next.js' && content.includes('next')) framework = 'Next.js';
    }

    // Check for data attributes commonly used by frameworks
    const htmlEl = document.documentElement;
    if (htmlEl.getAttribute('data-reactroot')) framework = 'React';
    if (htmlEl.getAttribute('ng-app')) framework = 'Angular';

    return framework;
  });

  return info || null;
}

/**
 * Truncate a string to maxLength, adding ellipsis.
 */
function truncate(str, maxLength) {
  if (!str || str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

module.exports = { gather, DEFAULT_OPTIONS };
