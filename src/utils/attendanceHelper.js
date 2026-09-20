/**
 * DEPRECATED: This module is deprecated.
 * All attendance and shift calculations are now centralized in
 * `backend/src/services/attendanceCalculation.service.js`.
 */

import { evaluateAttendanceShift } from '../services/attendanceCalculation.service.js';

export const evaluateWorkingMinutes = (date, totalMinutes, customWorkingHours = null) => {
  const fullDayMinutes = customWorkingHours?.fullDayMinutes ?? 540;
  const halfDayMinutes = customWorkingHours?.halfDayMinutes ?? 270;

  const isFullDay = totalMinutes >= fullDayMinutes;
  const isHalfDay = !isFullDay && totalMinutes >= halfDayMinutes;
  const isAbsent = totalMinutes < halfDayMinutes;

  return {
    isFullDay,
    isHalfDay,
    isAbsent,
    requiredFullMinutes: fullDayMinutes,
    minFullMinutes: fullDayMinutes,
    requiredHalfMinutes: halfDayMinutes,
    minHalfMinutes: halfDayMinutes,
    label: isFullDay ? 'Full Day' : isHalfDay ? 'Half Day' : 'Absent',
  };
};
