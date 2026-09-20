import {
  parseOfficeTimeToday,
  getDayOfWeekInOffice,
  DEFAULT_TIMEZONE,
} from '../utils/dateHelper.js';

/**
 * Calculates late arrival minutes based on working hours shift check-in time and grace period.
 * @param {Date} inTime - Actual check-in timestamp
 * @param {Object} workingHours - Working hours configuration
 * @param {Date} targetDate - Date of attendance
 * @param {string} timezone - Office timezone
 * @returns {{ isLate: boolean, lateMinutes: number }}
 */
export const calculateLateArrival = (
  inTime,
  workingHours,
  targetDate = new Date(),
  timezone = DEFAULT_TIMEZONE
) => {
  if (!inTime || !workingHours?.checkInTime) {
    return { isLate: false, lateMinutes: 0 };
  }

  const expectedIn = parseOfficeTimeToday(workingHours.checkInTime, targetDate, timezone);
  if (!expectedIn) return { isLate: false, lateMinutes: 0 };

  const graceMs = (workingHours.lateGraceMinutes || 0) * 60 * 1000;
  const threshold = expectedIn.getTime() + graceMs;
  const actualTime = new Date(inTime).getTime();

  if (actualTime > threshold) {
    const diffMs = actualTime - threshold;
    const lateMinutes = Math.max(1, Math.round(diffMs / 60000));
    return { isLate: true, lateMinutes };
  }

  return { isLate: false, lateMinutes: 0 };
};

/**
 * Calculates early check-out minutes based on working hours shift check-out time and grace period.
 * @param {Date} outTime - Actual check-out timestamp
 * @param {Object} workingHours - Working hours configuration
 * @param {Date} targetDate - Date of attendance
 * @param {string} timezone - Office timezone
 * @returns {{ isEarlyCheckout: boolean, earlyCheckoutMinutes: number }}
 */
export const calculateEarlyCheckout = (
  outTime,
  workingHours,
  targetDate = new Date(),
  timezone = DEFAULT_TIMEZONE
) => {
  if (!outTime || !workingHours?.checkOutTime) {
    return { isEarlyCheckout: false, earlyCheckoutMinutes: 0 };
  }

  const expectedOut = parseOfficeTimeToday(workingHours.checkOutTime, targetDate, timezone);
  if (!expectedOut) return { isEarlyCheckout: false, earlyCheckoutMinutes: 0 };

  const graceMs = (workingHours.earlyCheckoutGraceMinutes || 0) * 60 * 1000;
  const threshold = expectedOut.getTime() - graceMs;
  const actualTime = new Date(outTime).getTime();

  if (actualTime < threshold) {
    const diffMs = threshold - actualTime;
    const earlyCheckoutMinutes = Math.max(1, Math.round(diffMs / 60000));
    return { isEarlyCheckout: true, earlyCheckoutMinutes };
  }

  return { isEarlyCheckout: false, earlyCheckoutMinutes: 0 };
};

/**
 * Evaluates whether a given date is a working day based on workingHours.workDays (0-6).
 * @param {Date} date
 * @param {Object} workingHours
 * @param {string} timezone
 * @returns {boolean}
 */
export const isOfficeWorkDay = (date, workingHours, timezone = DEFAULT_TIMEZONE) => {
  const dow = getDayOfWeekInOffice(date, timezone);
  const workDays = workingHours?.workDays || [1, 2, 3, 4, 5, 6];
  return workDays.includes(dow);
};

/**
 * Centralized, production-grade shift evaluator.
 * Evaluates worked hours, status (P, Half, A, Coff, WO, H), overtime, shortfall, late and early checkout.
 *
 * @param {Object} params
 * @param {Date} params.inTime
 * @param {Date} params.outTime
 * @param {Object} params.workingHours
 * @param {Object} params.office
 * @param {boolean} params.isHoliday
 * @param {boolean} params.isWeekOff
 * @param {Date} params.targetDate
 * @returns {Object} Evaluation summary
 */
export const evaluateAttendanceShift = ({
  inTime,
  outTime,
  workingHours,
  office,
  isHoliday = false,
  isWeekOff = false,
  targetDate = new Date(),
}) => {
  const timezone = office?.timezone || DEFAULT_TIMEZONE;
  const fullDayMinutes = workingHours?.fullDayMinutes ?? 540;
  const halfDayMinutes = workingHours?.halfDayMinutes ?? 270;

  // 1. Durations
  let totalMinutes = 0;
  let totalHours = 0;

  if (inTime && outTime) {
    const workedMs = new Date(outTime).getTime() - new Date(inTime).getTime();
    totalMinutes = Math.max(0, Math.round(workedMs / 60000));
    totalHours = parseFloat((workedMs / 3600000).toFixed(2));
  }

  // 2. Late & Early checkout
  const { isLate, lateMinutes } = calculateLateArrival(inTime, workingHours, targetDate, timezone);
  const { isEarlyCheckout, earlyCheckoutMinutes } = calculateEarlyCheckout(outTime, workingHours, targetDate, timezone);

  // 3. Overtime & Shortfall
  const overtimeMinutes = Math.max(0, totalMinutes - fullDayMinutes);
  const shortfallMinutes = Math.max(0, fullDayMinutes - totalMinutes);

  // 4. Day Status & Comp-Off Qualification
  let status = 'A';
  let compOffDaysCredited = 0;

  if (isHoliday || isWeekOff) {
    if (totalMinutes >= fullDayMinutes) {
      status = 'Coff';
      compOffDaysCredited = 1.0;
    } else if (totalMinutes >= halfDayMinutes) {
      status = 'Coff';
      compOffDaysCredited = 0.5;
    } else {
      status = isHoliday ? 'H' : 'WO';
      compOffDaysCredited = 0;
    }
  } else {
    // Normal Working Day
    if (totalMinutes >= fullDayMinutes) {
      status = 'P';
    } else if (totalMinutes >= halfDayMinutes) {
      status = 'Half';
    } else {
      status = 'A';
    }
  }

  return {
    totalMinutes,
    totalHours,
    isLate,
    lateMinutes,
    isEarlyCheckout,
    earlyCheckoutMinutes,
    overtimeMinutes,
    shortfallMinutes,
    status,
    compOffDaysCredited,
    fullDayMinutes,
    halfDayMinutes,
  };
};
