/**
 * Main entry point for the Information Parser Agent.
 * Routes raw scraped data to the appropriate specialized parser.
 */

const { parseSchema } = require('./utils/schema-parser');
const jobParser = require('./parsers/job');
const articleParser = require('./parsers/article');
const companyParser = require('./parsers/company');
const productParser = require('./parsers/product');
const genericParser = require('./parsers/generic');

/**
 * Parses raw data from Agent 1 into structured information.
 * @param {Object} rawData - The output from the Web Research agent
 * @returns {Promise<Object>} Structured, formatted result
 */
async function parse(rawData) {
  if (!rawData || !rawData.success) {
    return { error: 'Invalid or unsuccessful input data', success: false };
  }

  const { textContent, metaTags, url } = rawData;

  try {
    // 1. Try Schema.org / JSON-LD first (highest confidence)
    const schemaInfo = parseSchema(rawData);
    if (schemaInfo && schemaInfo.type) {
      console.log(`[Parser] Detected Schema.org type: ${schemaInfo.type}`);
      switch (schemaInfo.type) {
        case 'JobPosting': return await jobParser.parse(rawData, schemaInfo);
        case 'Article': return await articleParser.parse(rawData, schemaInfo);
        case 'Product': return await productParser.parse(rawData, schemaInfo);
        case 'Organization': return await companyParser.parse(rawData, schemaInfo);
      }
    }

    // 2. Heuristic-based Routing (if no explicit schema)
    const type = detectContentType(rawData);
    console.log(`[Parser] Detected content type: ${type}`);

    switch (type) {
      case 'job': return await jobParser.parse(rawData);
      case 'article': return await articleParser.parse(rawData);
      case 'company': return await companyParser.parse(rawData);
      case 'product': return await productParser.parse(rawData);
      default: return await genericParser.parse(rawData);
    }
  } catch (err) {
    return { 
      error: `Parsing failed: ${err.message}`, 
      success: false,
      originalDataSummary: `${textContent?.slice(0, 100)}...`
    };
  }
}

/**
 * Heuristic-based content type detection.
 *
 * Scores each type instead of returning on the first matching word: single
 * common words ("apply", "contact", "price") appear on almost every page, so a
 * type needs a strong signal (title/URL/og:type) or several distinct phrases.
 */
const SIGNALS = {
  job: {
    titleOrUrl: /\b(jobs?|careers?|hiring|vacanc(?:y|ies)|openings?|positions?)\b/i,
    phrases: [/apply now/i, /job description/i, /responsibilities/i, /qualifications/i,
      /\bfull[- ]time\b/i, /\bpart[- ]time\b/i, /\bsalary\b/i, /years of experience/i,
      /\bbenefits\b/i, /equal opportunity employer/i],
  },
  article: {
    titleOrUrl: /\b(blog|news|articles?|posts?|editorial|stor(?:y|ies)|opinion)\b/i,
    phrases: [/\bby [A-Z][a-z]+ [A-Z][a-z]+/, /\bpublished\b/i, /min(ute)? read\b/i,
      /\bshare this\b/i, /\bcomments?\b/i, /\bupdated on\b/i],
  },
  company: {
    titleOrUrl: /\b(about(?:[- ]us)?|our company|who we are|leadership)\b/i,
    phrases: [/\bfounded in\b/i, /\bheadquarter(?:s|ed)\b/i, /\bour mission\b/i,
      /\bour team\b/i, /\bour story\b/i, /\bchief executive\b|\bceo\b/i],
  },
  product: {
    titleOrUrl: /\b(shop|store|products?)\b/i,
    phrases: [/add to (?:cart|bag|basket)/i, /buy now/i, /\bin stock\b/i, /out of stock/i,
      /free shipping/i, /(?:\$|£|€)\s?\d[\d,]*(?:\.\d{2})?/],
  },
};

function detectContentType(rawData) {
  const text = rawData.textContent || '';
  const titleAndUrl = `${rawData.title || ''} ${(rawData.url || '').replace(/[/_.-]+/g, ' ')}`;
  const ogType = rawData.metaTags?.find((m) => m.name === 'og:type')?.content;

  let best = 'generic';
  let bestScore = 0;
  for (const [type, sig] of Object.entries(SIGNALS)) {
    let score = sig.phrases.filter((re) => re.test(text)).length;
    if (sig.titleOrUrl.test(titleAndUrl)) score += 2;
    if ((type === 'product' && ogType === 'product') || (type === 'article' && ogType === 'article')) score += 3;
    if (score > bestScore) { best = type; bestScore = score; }
  }
  // Need at least two independent signals before committing to a specific type.
  return bestScore >= 2 ? best : 'generic';
}

module.exports = { parse };
