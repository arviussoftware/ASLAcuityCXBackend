const rateLimitMap = new Map();

// Periodically clean up expired rate limit entries to prevent memory leaks
if (typeof global._rateLimitInterval === 'undefined') {
  global._rateLimitInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitMap.entries()) {
      if (value.resetTime < now) {
        rateLimitMap.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  if (global._rateLimitInterval.unref) {
    global._rateLimitInterval.unref();
  }
}

/**
 * Checks if a given IP has exceeded the allowed request count in a given window.
 * @param {string} ip - The client IP address.
 * @param {string} route - The route identifier.
 * @param {number} limit - Max number of requests allowed in the window.
 * @param {number} windowMs - Time window in milliseconds.
 * @returns {boolean} - True if rate limited, false otherwise.
 */
export function isRateLimited(ip, route, limit = 5, windowMs = 60 * 1000) {
  const now = Date.now();
  const key = `${ip}:${route}`;
  const record = rateLimitMap.get(key) || { count: 0, resetTime: now + windowMs };

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
  } else {
    record.count++;
  }

  rateLimitMap.set(key, record);

  return record.count > limit;
}
