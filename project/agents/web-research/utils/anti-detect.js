/**
 * Anti-detection utilities for Playwright browser automation.
 * Configures browser to avoid detection as an automated tool.
 */

const crypto = require('crypto');

/**
 * Generate stealth launch arguments for Chromium.
 */
function getStealthConfig(options = {}) {
  return {
    headless: options.headless !== false, // true = new optimized headless (headless-shell) in PW v1.30+
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--enable-precise-memory-info',
      '--start-maximized',
      '--lang=en-US',
    ],
    // Hide automation signals
    ignoreDefaultArgs: ['--enable-automation'],
  };
}

/**
 * Rotate through a pool of user agents, or generate a random one.
 */
function rotateUserAgent(pool) {
  if (!pool || !Array.isArray(pool) || pool.length === 0) {
    return generateRandomChromeUA();
  }
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

/**
 * Generate a plausible random Chrome user agent string.
 */
function generateRandomChromeUA() {
  const versions = ['120.0.0.0', '119.0.0.0', '118.0.0.0', '121.0.0.0'];
  const platforms = [
    '(Windows NT 10.0; Win64; x64)',
    '(Macintosh; Intel Mac OS X 10_15_7)',
    '(X11; Linux x86_64)',
  ];

  return `Mozilla/5.0 ${platforms[Math.floor(Math.random() * platforms.length)]} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${versions[Math.floor(Math.random() * versions.length)]} Safari/537.36`;
}

/**
 * Inject stealth script into the page context to hide automation markers.
 * This runs in the browser context before any page scripts execute.
 */
async function injectStealth(page) {
  await page.addInitScript(() => {
    // Override webdriver property
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Patch plugins length to look like a real browser
    if (navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const pluginList = [];
          pluginList.push({ name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' });
          pluginList.push({ name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' });
          pluginList.push({ name: 'Native Client', filename: 'internal-nacl-plugin' });
          return Object.freeze(pluginList);
        },
      });
    }

    // Patch languages to look non-empty
    if (!navigator.languages || navigator.languages.length === 0) {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    }

    // I18N Area Format (used for dates/numbers)
    if (!navigator.unlocalizedLanguageSettings) {
      navigator.unlocalizedLanguageSettings = {};
    }

    // Chrome Runtime
    window.chrome = { runtime: {} };

    // Permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);

    // Window chrome
    Object.defineProperty(window, 'innerHeight', { get: () => window.innerHeight });
    Object.defineProperty(window, 'outerWidth', { get: () => 1920 });
    Object.defineProperty(window, 'devicePixelRatio', { get: () => 2 });

    // Fix toString to bypass detection
    const originalToString = Function.prototype.toString;
    Function.prototype.toString = function (...args) {
      if (this === window.chrome?.runtime?.onMessage || this.name === 'original') {
        return originalToString.apply(this, args);
      }
      return originalToString.call(this, ...args);
    };

    // Pass the CSP iframe test
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.documentElement.appendChild(iframe);
    window.$wappstoNativeContent = iframe.contentWindow?.window;
  });
}

/**
 * Generate a random Chrome extension ID (makes browser fingerprint more realistic).
 */
function generateExtensionId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id.replace(/(.{8})(.{8})(.{8})/, '$1-$2-$3');
}

/**
 * Generate a random canvas fingerprint seed.
 */
function generateCanvasSeed() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { getStealthConfig, rotateUserAgent, injectStealth };
