/**
 * Company Parser — extracts business profiles and organization details.
 */

const { JSDOM } = require('jsdom');
const { normalize } = require('../utils/heuristics');

/**
 * Parse company information.
 * @param {Object} rawData - The input data from Agent 1
 * @param {Object} [schemaInfo] - Schema info if provided by main parser
 * @returns {Promise<Object>} Extracted company details
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

    // Try to find company name from meta tags or page title
    let companyName = '';
    const ogSiteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
    if (ogSiteName) {
      companyName = normalize(ogSiteName);
    }

    // Look for contact information in the text/HTML
    const bodyText = rawData.textContent || '';
    const emailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = bodyText.match(/(?:\+?\d{1,3}[\s-]?)?(?:\(\d{3}\)|\d{3})[\s-]?\d{3}[\s-]?\d{4}/);

    return {
      success: true,
      type: 'company',
      name: companyName || rawData.title,
      email: emailMatch ? emailMatch[0] : '',
      phone: phoneMatch ? phoneMatch[0] : '',
      url: rawData.url,
    };
  } catch (err) {
    return { success: false, error: `Company parsing failed: ${err.message}` };
  }
}

/**
 * Extracts information from a JSON-LD schema object.
 */
function extractFromSchema(schema) {
  // Schema structure for Organization:
  // { @type: 'Organization', name: '...', url: '...', logo: '...' }
  return {
    success: true,
    type: 'company',
    name: schema.name || '',
    url: schema.url || '',
    logo: schema.logo || '',
  };
}

module.exports = { parse };
