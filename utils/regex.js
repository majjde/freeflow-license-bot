/**
 * Extract 12-digit UTR/RRN from payment notification text.
 * Handles common Indian bank/UPI SMS formats.
 */
function extractUtr(text) {
  if (!text || typeof text !== 'string') return null;

  const patterns = [
    // HDFC SmartHub Vyapar: "RRN-375521358355"
    /RRN-(\d{12})/i,
    /\b(?:UTR|RRN|Ref(?:erence)?\.?\s*(?:No|Number|#)?)\s*[:\-]?\s*(\d{12})\b/i,
    /\b(?:txn|transaction)\s*(?:id|ref)?\s*[:\-]?\s*(\d{12})\b/i,
    /\b(\d{12})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Extract INR amount from payment notification text.
 * Returns amount as a number (integer or float).
 */
function extractAmount(text) {
  if (!text || typeof text !== 'string') return null;

  const patterns = [
    // HDFC: "You have received Rs. 5.00 via HDFC Bank"
    /received\s+Rs\.?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:credited|credited with|received|debited)\s*(?:with|of|by)?\s*(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\b([\d,]+(?:\.\d{1,2})?)\s*(?:INR|Rs\.?|₹)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (!Number.isNaN(amount) && amount > 0) return amount;
    }
  }

  return null;
}

/**
 * Validate user-submitted UTR (exactly 12 digits).
 */
function isValidUtr(utr) {
  return typeof utr === 'string' && /^\d{12}$/.test(utr.trim());
}

module.exports = {
  extractUtr,
  extractAmount,
  isValidUtr,
};
