/**
 * Generic Parser — fallback for pages that aren't a job, article, company or product.
 * Returns the page title, a short summary and any contact details/dates/links found.
 */

const { extractPatterns } = require('../utils/heuristics');

/**
 * Parse generic information.
 * @param {Object} rawData - The output from the Web Research agent
 * @returns {Promise<Object>} Extracted general info
 */
async function parse(rawData) {
  try {
    const text = rawData.textContent || '';
    const patterns = extractPatterns(text);
    const unique = (arr) => [...new Set(arr)];

    return {
      success: true,
      type: 'generic',
      title: (rawData.title || '').trim(),
      summary: text.replace(/\s+/g, ' ').trim().slice(0, 500),
      extracted_data: {
        emails: unique(patterns.email),
        phones: unique(patterns.phone),
        urls: unique(patterns.url),
        dates: unique(patterns.date),
      },
      linksCount: Array.isArray(rawData.links) ? rawData.links.length : rawData.linksCount || 0,
      url: rawData.url,
    };
  } catch (err) {
    return { success: false, error: `Generic parsing failed: ${err.message}` };
  }
}

module.exports = { parse };
