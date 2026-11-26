/**
 * Job Posting Parser — extracts job details from JSON-LD or raw HTML.
 */

const { JSDOM } = require('jsdom');
const { extractPatterns, normalize } = require('../utils/heuristics');

/**
 * Parse job information.
 * @param {Object} rawData - The input data from Agent 1
 * @param {Object} [schemaInfo] - Schema info if provided by main parser
 * @returns {Promise<Object>} Extracted job details
 */
async function parse(rawData, schemaInfo = null) {
  // 1. If we have structured JSON-LD, use it directly (highest confidence)
  if (schemaInfo && schemaInfo.raw) {
    return extractFromSchema(schemaInfo.raw);
  }

  // 2. Otherwise, fallback to scraping the HTML content
  if (!rawData.html) {
    return { success: false, error: 'No HTML content provided for parsing' };
  }

  try {
    const dom = new JSDOM(rawData.html);
    const document = dom.window.document;

    // Attempt to find job title (usually in <h1> or <title>)
    let title = normalize(document.querySelector('h1')?.textContent || rawData.title);
    if (!title) {
      title = normalize(document.title);
    }

    // Heuristic: Look for common job-related text patterns to identify the real content
    const bodyText = rawData.textContent || '';
    const salaryMatch = bodyText.match(/[a-z]+salary[a-z]*|(\$[0-9,]+(?:\s?-\s?\$[0-9,]+)?)/i);

    // Try to find company name (often in meta tags or specific elements)
    let company = '';
    const ogSiteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
    if (ogSiteName) {
      company = normalize(ogSiteName);
    }

    // Find description/body text by looking for long paragraphs after the title
    let description = '';
    const mainContentEl = document.querySelector('article, .job-description, #job-details, [class*="description"]');
    if (mainContentEl) {
      description = mainContentEl.textContent.trim();
    } else {
      // Fallback: use a snippet of text that contains the title to find context
      const index = bodyText.indexOf(title);
      if (index !== -1) {
        description = bodyText.substring(Math.max(0, index - 50), Math.min(bodyText.length, index + 500));
      }
    }

    // Extract salary if found via heuristics
    let salary = null;
    if (salaryMatch) {
      salary = salaryMatch[0];
    }

    return {
      success: true,
      type: 'job',
      title: title.trim(),
      company: company.trim(),
      description: description.trim().slice(0, 1000), // cap for output
      salary: salary || null,
      url: rawData.url,
    };
  } catch (err) {
    return { success: false, error: `Job parsing failed: ${err.message}` };
  }
}

/**
 * Extracts information from a JSON-LD schema object.
 */
function extractFromSchema(schema) {
  // Schema structure for JobPosting:
  // { @type: 'JobPosting', title: '...', company: { name: '...' }, description: '...', etc }
  return {
    success: true,
    type: 'job',
    title: schema.title || '',
    company: schema.hiringOrganization?.name || schema.employer?.name || '',
    description: schema.description || '',
    salary: extractSalaryFromText(schema.description), // Try to pull salary from description if in JSON-LD
    url: schema.url || '',
  };
}

/**
 * Helper to pull salary information out of text blobs using regex.
 */
function extractSalaryFromText(text) {
  if (!text) return null;
  const match = text.match(/(?:\$|£|€|USD|EUR)\s?(?:\d{1,3}(?:,\d{3})*(?:\.\d{2})?)(?:\s?-\s?(?:\$|£|€|USD|EUR)?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)?|\d+\s?(?:k|K|thousand|million|M|m)/i);
  return match ? match[0] : null;
}

module.exports = { parse };
