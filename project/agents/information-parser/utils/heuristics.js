/**
 * Heuristics utility for pattern matching text and metadata.
 */

const HEURISTICS = {
  date: /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/i,
  salary: /(?:\$|£|€|USD|EUR)\s?(?:\d{1,3}(?:,\d{3})*(?:\.\d{2})?)(?:\s?-\s?(?:\$|£|€|USD|EUR)?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)?|\d+\s?(?:k|K|thousand|million|M|m)/i,
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /(?:\+?\d{1,3}[\s-]?)?(?:\(\d{3}\)|\d{3})[\s-]?\d{3}[\s-]?\d{4}/g,
  url: /https?:\/\/[^\s"']+/g
};

/**
 * Extracts patterns from text using regex.
 */
function extractPatterns(text) {
  const results = {};
  for (const [key, pattern] of Object.entries(HEURISTICS)) {
    results[key] = text.match(pattern) || [];
  }
  return results;
}

/**
 * Normalizes a string for comparison.
 */
function normalize(str) {
  return str ? str.toLowerCase().trim() : '';
}

module.exports = { extractPatterns, normalize };
