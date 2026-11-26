/**
 * Product Parser — extracts product details like price, name, and availability.
 */

const { JSDOM } = require('jsdom');
const { normalize } = require('../utils/heuristics');

/**
 * Parse product information.
 * @param {Object} rawData - The input data from Agent 1
 * @param {Object} [schemaInfo] - Schema info if provided by main parser
 * @returns {Promise<Object>} Extracted product details
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

    // Extract product name from meta tags or H1
    let productName = normalize(document.querySelector('h1')?.textContent || rawData.title);

    // Attempt to find price using regex on the text content
    const bodyText = rawData.textContent || '';
    const priceMatch = bodyText.match(/(?:\$|£|€|USD|EUR)\s?(?:\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);

    // Check for availability indicators in text
    const isAvailable = /in stock|available|add to cart|buy now/i.test(bodyText);

    return {
      success: true,
      type: 'product',
      name: productName,
      price: priceMatch ? priceMatch[0] : null,
      available: isAvailable,
      url: rawData.url,
    };
  } catch (err) {
    return { success: false, error: `Product parsing failed: ${err.message}` };
  }
}

/**
 * Extracts information from a JSON-LD schema object.
 */
function extractFromSchema(schema) {
  // Schema structure for Product:
  // { @type: 'Product', name: '...', offers: { price: '...' } }
  return {
    success: true,
    type: 'product',
    name: schema.name || '',
    url: schema.url || '',
    price: schema.offers?.price || null,
    currency: schema.offers?.priceCurrency || '',
    available: !!(schema.offers?.availability && schema.offers.availability.includes('InStock')),
  };
}

module.exports = { parse };
