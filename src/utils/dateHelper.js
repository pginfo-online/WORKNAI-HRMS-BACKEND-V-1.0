/**
 * Centralized, production-grade Timezone and Date normalization helper.
 * Standardizes all date comparisons on the Office timezone (default: Asia/Kolkata / IST).
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Returns formatted YYYY-MM-DD string in the specified timezone.
 * @param {Date|string|number} date
 * @param {string} timezone
 * @returns {string} e.g. "2026-09-21"
 */
export const getOfficeDateStr = (date = new Date(), timezone = DEFAULT_TIMEZONE) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d); // "en-CA" formats as YYYY-MM-DD
};

/**
 * Returns UTC Date object representing 00:00:00.000 in the office timezone.
 * For example in Asia/Kolkata (UTC+5:30), 2026-09-21 00:00:00 is 2026-09-20T18:30:00.000Z.
 * @param {Date|string|number} date
 * @param {string} timezone
 * @returns {Date}
 */
export const getOfficeStartOfDay = (date = new Date(), timezone = DEFAULT_TIMEZONE) => {
  const dateStr = getOfficeDateStr(date, timezone);
  const [year, month, day] = dateStr.split('-').map(Number);
  
  // Find UTC timestamp that equals 00:00:00 in timezone
  const tempUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  // Adjust by timezone offset
  const tzDateStr = tempUtc.toLocaleString('en-US', { timeZone: timezone });
  const tzDate = new Date(tzDateStr);
  const diffMs = tempUtc.getTime() - tzDate.getTime();
  return new Date(tempUtc.getTime() + diffMs);
};

/**
 * Returns UTC Date object representing 23:59:59.999 in the office timezone.
 * @param {Date|string|number} date
 * @param {string} timezone
 * @returns {Date}
 */
export const getOfficeEndOfDay = (date = new Date(), timezone = DEFAULT_TIMEZONE) => {
  const start = getOfficeStartOfDay(date, timezone);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
};

/**
 * Parses "HH:mm" time string for a given date in the office timezone and returns UTC Date.
 * @param {string} timeStr - "HH:mm" in 24h format (e.g. "09:30")
 * @param {Date|string} referenceDate
 * @param {string} timezone
 * @returns {Date}
 */
export const parseOfficeTimeToday = (timeStr, referenceDate = new Date(), timezone = DEFAULT_TIMEZONE) => {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  const startOfDay = getOfficeStartOfDay(referenceDate, timezone);
  return new Date(startOfDay.getTime() + (hours * 60 + minutes) * 60 * 1000);
};

/**
 * Returns day of week (0 = Sunday, 1 = Monday ... 6 = Saturday) in the office timezone.
 * @param {Date|string|number} date
 * @param {string} timezone
 * @returns {number}
 */
export const getDayOfWeekInOffice = (date = new Date(), timezone = DEFAULT_TIMEZONE) => {
  const d = new Date(date);
  const weekdayStr = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(d);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekdayStr] ?? d.getDay();
};

/**
 * Formats a Date object to "hh:mm A" string in the office timezone.
 * @param {Date|string|number} date
 * @param {string} timezone
 * @returns {string} e.g. "09:30 AM"
 */
export const formatTimeInOffice = (date, timezone = DEFAULT_TIMEZONE) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
};
