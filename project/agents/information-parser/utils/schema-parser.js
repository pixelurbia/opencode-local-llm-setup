/**
 * Schema.org and JSON-LD parser utility.
 * Extracts structured data from the page's HTML or meta tags.
 */

const { JSDOM } = require('jsdom');

/**
 * Parses JSON-LD scripts to find schema information.
 * @param {Object} rawData - Output from Web Research agent
 * @returns {Object|null} Extracted schema info if found
 */
function parseSchema(rawData) {
  if (!rawData.html) return null;

  try {
    const dom = new JSDOM(rawData.html);
    const document = dom.window.document;
    
    // Collect every JSON-LD item on the page: top-level objects, arrays and @graph lists.
    const items = [];
    const collect = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(collect);
      if (node['@type']) items.push(node);
      if (node['@graph']) collect(node['@graph']);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        collect(JSON.parse(script.textContent));
      } catch (e) {
        // Skip invalid JSON
      }
    }

    // Pick the most useful item, not just the first (pages often list WebSite/BreadcrumbList first).
    for (const wanted of PRIORITY) {
      const item = items.find((i) => normalizeType(i['@type']) === wanted);
      if (item) return { type: wanted, raw: item };
    }

    // Fallback to OpenGraph if no usable JSON-LD. raw is null so the parser reads
    // the page itself instead of returning empty fields from an empty schema object.
    const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute('content');
    const mapped = ogType && mapOgToSchema(ogType);
    if (mapped) {
      return { type: mapped, raw: null };
    }

  } catch (err) {
    console.error('[SchemaParser] Error parsing schema:', err.message);
  }

  return null;
}

// Types the parsers handle, most specific first.
const PRIORITY = ['JobPosting', 'Product', 'Article', 'Organization'];

// Schema.org subtypes mapped to the type the parsers understand.
const TYPE_ALIASES = {
  JobPosting: 'JobPosting',
  Product: 'Product', ProductGroup: 'Product', IndividualProduct: 'Product',
  Article: 'Article', NewsArticle: 'Article', BlogPosting: 'Article', TechArticle: 'Article',
  Report: 'Article', ScholarlyArticle: 'Article', SocialMediaPosting: 'Article',
  Organization: 'Organization', Corporation: 'Organization', LocalBusiness: 'Organization',
  NGO: 'Organization', EducationalOrganization: 'Organization',
};

/**
 * Normalizes @type, which may be a string, an array, or a full URL
 * ("https://schema.org/NewsArticle"), to one of the PRIORITY types (or null).
 */
function normalizeType(type) {
  for (const t of [].concat(type || [])) {
    const name = String(t).split(/[/#]/).pop();
    if (TYPE_ALIASES[name]) return TYPE_ALIASES[name];
  }
  return null;
}

/**
 * Maps OpenGraph types to Schema.org equivalents.
 */
function mapOgToSchema(ogType) {
  const mapping = {
    'website': 'WebSite',
    'article': 'Article',
    'profile': 'Person',
    'product': 'Product',
    'book': 'Book',
    'music.song': 'MusicComposition',
    // Add more mappings as needed
  };
  return mapping[ogType] || null;
}

module.exports = { parseSchema };
