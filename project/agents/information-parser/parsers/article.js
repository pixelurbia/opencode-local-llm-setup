/**
 * Article Parser — extracts headline, author, and body text from articles/blogs.
 */

const { JSDOM } = require('jsdom');
const { normalize } = require('../utils/heuristics');

/**
 * Parse article information.
 * @param {Object} rawData - The input data from Agent 1
 * @param {Object} [schemaInfo] - Schema info if provided by main parser
 * @returns {Promise<Object>} Extracted article details
 */
async function parse(rawData, schemaInfo = null) {
  if (schemaInfo && schemaInfo.raw) {
    return extractFromSchema(schemaInfo.raw);
  }

  if (!rawData.html) {
    return { success: false, error: 'No HTML content provided for parsing' };
  }

  try {
    const dom = new JSDOM(rawData.html);
    const document = dom.window.document;

    // Extract title
    let headline = normalize(document.querySelector('h1')?.textContent || rawData.title);
    
    // Search for author in meta tags or common elements
    let author = '';
    const authorMeta = document.querySelector('meta[name="author"], meta[property="article:author"], meta[property="og:author"]');
    if (authorMeta) {
      author = normalize(authorMeta.getAttribute('content'));
    }

    // Try to find the main article body
    let bodyText = '';
    const articleEl = document.querySelector('article, [class*="article"], [id*="article"], [class*="post"]');
    if (articleEl) {
      bodyText = articleEl.textContent.trim();
    } else {
      // Fallback to textContent if no obvious article element exists
      bodyText = rawData.textContent || '';
    }

    return {
      success: true,
      type: 'article',
      headline: headline,
      author: author || 'Unknown Author',
      bodySummary: bodyText.slice(0, 500), // snippet for quick view
      fullBody: bodyText,
      url: rawData.url,
    };
  } catch (err) {
    return { success: false, error: `Article parsing failed: ${err.message}` };
  }
}

/**
 * Extracts information from a JSON-LD schema object.
 */
function extractFromSchema(schema) {
  // Schema structure for Article:
  // { @type: 'Article', headline: '...', author: { name: '...' }, datePublished: '...' }
  return {
    success: true,
    type: 'article',
    headline: schema.headline || '',
    author: schema.author?.name || (Array.isArray(schema.author) ? schema.author[0]?.name : ''),
    datePublished: schema.datePublished || schema.dateModified || '',
    url: schema.url || '',
  };
}

module.exports = { parse };
