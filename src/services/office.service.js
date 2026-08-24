import { Office } from '../models/Office.model.js';
import { WorkingHours } from '../models/WorkingHours.model.js';

// ── In-memory cache for office settings ─────────────────────────────────────
let _cachedOffice = null;
let _cachedWH = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the active office with its working hours.
 * Results are cached for 5 minutes to avoid DB calls on every check-in.
 */
export const getActiveOffice = async () => {
  const now = Date.now();
  if (_cachedOffice && now < _cacheExpiresAt) {
    return { office: _cachedOffice, workingHours: _cachedWH };
  }

  const office = await Office.findOne({ isActive: true }).lean();
  if (!office) return { office: null, workingHours: null };

  let workingHours = null;
  if (office.workingHoursId) {
    workingHours = await WorkingHours.findById(office.workingHoursId).lean();
  }
  if (!workingHours) {
    // Fallback: find default working hours for this office
    workingHours = await WorkingHours.findOne({ officeId: office._id, isDefault: true }).lean();
  }

  _cachedOffice = office;
  _cachedWH = workingHours;
  _cacheExpiresAt = now + CACHE_TTL_MS;

  return { office, workingHours };
};

/** Invalidate cache after office/working-hours update */
export const invalidateOfficeCache = () => {
  _cachedOffice = null;
  _cachedWH = null;
  _cacheExpiresAt = 0;
};

/**
 * Check if coordinates are within the office radius.
 */
const toRad = (v) => (v * Math.PI) / 180;

export const distanceInMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const isWithinOffice = (latitude, longitude, office) => {
  const distance = distanceInMeters(
    office.latitude,
    office.longitude,
    latitude,
    longitude
  );
  return {
    isValid: distance <= office.radiusMeters,
    distance: Math.round(distance),
  };
};

/**
 * Parse "HH:MM" string and return today's Date at that time (local).
 */
export const parseTimeToday = (timeStr, referenceDate = new Date()) => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const d = new Date(referenceDate);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

/**
 * Calculate late minutes given working hours config and actual check-in time.
 */
export const calcLateMinutes = (workingHours, checkInTime) => {
  if (!workingHours?.checkInTime) return 0;
  const expected = parseTimeToday(workingHours.checkInTime, checkInTime);
  const grace = (workingHours.lateGraceMinutes || 0) * 60 * 1000;
  const diff = checkInTime - expected - grace;
  return diff > 0 ? Math.round(diff / 60000) : 0;
};
