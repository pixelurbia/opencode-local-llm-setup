/**
 * Interaction handlers — simulate user behavior to trigger lazy-loaded content
 * and detect when a page has stabilized after navigation/scrolling.
 */

const { injectStealth } = require('./anti-detect');

/**
 * Simulate scrolling down through the page in steps, pausing between each.
 * This triggers lazy-loading of images, infinite scroll, etc.
 * @param {Page} page - Playwright page instance
 * @param {number} depth - Number of scroll steps (default 3)
 */
async function simulateScroll(page, depth = 3) {
  await injectStealth(page);

  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const stepSize = Math.floor(scrollHeight / (depth + 1));

  if (stepSize <= 0) return; // No scrolling needed

  for (let i = 0; i < depth; i++) {
    await page.evaluate((pos) => window.scrollTo(0, pos), stepSize * (i + 1));
    // Random pause between scrolls to mimic human behavior
    const pause = 300 + Math.random() * 700;
    await page.waitForTimeout(pause);
  }

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * Wait for dynamic content to stabilize — no new network requests or DOM changes
 * for a short period. Useful after scrolling to let lazy-loaded content finish.
 * @param {Page} page - Playwright page instance
 * @param {number} [timeout=5000] - Max time to wait
 */
async function waitUntilStable(page, timeout = 5000) {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch (e) {
    // networkidle may fail on pages with persistent websockets/polling — that's OK
    // Just give it a short pause for content to settle
    await page.waitForTimeout(2000);
  }

  // Additional stabilization: wait until DOM is idle
  try {
    await Promise.race([
      page.evaluate(() => {
        return new Promise((resolve) => {
          if (document.readyState === 'complete') {
            resolve(true);
          } else {
            document.addEventListener('DOMContentLoaded', () => resolve(true));
            window.addEventListener('load', () => resolve(true));
          }
        });
      }),
    ]);
  } catch (e) {
    // Ignore — page may have already been stable
  }
}

/**
 * Wait for a specific element to appear on the page.
 * @param {Page} page - Playwright page instance
 * @param {string} selector - CSS selector to wait for
 * @param {number} [timeout=10000] - Max time to wait (ms)
 */
async function waitForElement(page, selector, timeout = 10000) {
  try {
    await page.waitForSelector(selector, { state: 'attached', timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a specific piece of text to appear on the page.
 * @param {Page} page - Playwright page instance
 * @param {string} text - Text content to wait for (supports partial match)
 * @param {number} [timeout=10000] - Max time to wait (ms)
 */
async function waitForText(page, text, timeout = 10000) {
  try {
    await page.waitForFunction(
      (searchText) => document.body.innerText.includes(searchText),
      String(text),
      { timeout }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a network request to complete matching a URL pattern.
 * Useful for waiting on API calls that load dynamic content.
 * @param {Page} page - Playwright page instance
 * @param {string|RegExp} urlPattern - URL or regex pattern to match
 * @param {'GET'|'POST'} [method='GET'] - HTTP method filter (optional)
 * @param {number} [timeout=10000] - Max time to wait (ms)
 */
async function waitForNetworkResponse(page, urlPattern, method = 'GET', timeout = 10000) {
  return new Promise((resolve) => {
    let settled = false;

    const handler = async (response) => {
      if (settled) return;

      const matchesUrl = typeof urlPattern === 'string'
        ? response.url().includes(urlPattern)
        : urlPattern.test(response.url());

      if (!matchesUrl) return;

      if (method && response.request().method() !== method) return;

      settled = true;
      await response.body().catch(() => {}); // Wait for full body
      resolve(true);
    };

    page.once('response', handler);

    setTimeout(() => {
      page.removeListener('response', handler);
      resolve(false);
    }, timeout);
  });
}

module.exports = { simulateScroll, waitUntilStable, waitForElement, waitForText, waitForNetworkResponse };
