export const RETRYABLE_API_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function isRetryableApiStatus(status) { return RETRYABLE_API_STATUS.has(Number(status)); }

export function retryDelayMs(attempt, retryAfter = "", random = Math.random()) {
  const value = String(retryAfter || "").trim();
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.min(15000, Math.max(0, Number(value) * 1000));
  if (value) {
    const dateDelay = Date.parse(value) - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay > 0) return Math.min(15000, dateDelay);
  }
  const base = Math.min(8000, 700 * (2 ** Math.max(0, Number(attempt) || 0)));
  return Math.round(base * (1 + Math.max(0, Math.min(1, Number(random) || 0)) * .25));
}

export function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
