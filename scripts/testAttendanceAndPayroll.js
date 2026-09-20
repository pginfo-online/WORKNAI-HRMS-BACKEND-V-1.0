import {
  getOfficeDateStr,
  getOfficeStartOfDay,
  getOfficeEndOfDay,
  getDayOfWeekInOffice,
  parseOfficeTimeToday,
  DEFAULT_TIMEZONE,
} from '../src/utils/dateHelper.js';
import {
  calculateLateArrival,
  calculateEarlyCheckout,
  evaluateAttendanceShift,
} from '../src/services/attendanceCalculation.service.js';
import { calculatePT } from '../src/controllers/payroll.controller.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

console.log('─── 1. TESTING DATE HELPER & TIMEZONE NORMALIZATION ───');
const sampleDate = new Date('2026-09-21T08:30:00.000Z');
const dateStr = getOfficeDateStr(sampleDate, 'Asia/Kolkata');
assert(dateStr === '2026-09-21', `Date string in Asia/Kolkata matches "2026-09-21" (got: ${dateStr})`);

const startOfDay = getOfficeStartOfDay(sampleDate, 'Asia/Kolkata');
const endOfDay = getOfficeEndOfDay(sampleDate, 'Asia/Kolkata');
assert(startOfDay instanceof Date, 'getOfficeStartOfDay returns Date object');
assert(endOfDay instanceof Date, 'getOfficeEndOfDay returns Date object');
assert(endOfDay.getTime() > startOfDay.getTime(), 'endOfDay is after startOfDay');

const parsedTime = parseOfficeTimeToday('09:30', sampleDate, 'Asia/Kolkata');
assert(parsedTime instanceof Date, 'parseOfficeTimeToday returns valid Date');

console.log('\n─── 2. TESTING ATTENDANCE CALCULATION SERVICE ───');
const mockWorkingHours = {
  checkInTime: '09:30',
  checkOutTime: '18:30',
  lateGraceMinutes: 15,
  earlyCheckoutGraceMinutes: 15,
  halfDayMinutes: 270,
  fullDayMinutes: 540,
  workDays: [1, 2, 3, 4, 5, 6],
};
const mockOffice = {
  timezone: 'Asia/Kolkata',
  radiusMeters: 200,
};

// Test on-time check-in: 09:35 (within 15m grace)
const onTimeIn = parseOfficeTimeToday('09:35', sampleDate, 'Asia/Kolkata');
const onTimeLateRes = calculateLateArrival(onTimeIn, mockWorkingHours, sampleDate, 'Asia/Kolkata');
assert(onTimeLateRes.isLate === false, '09:35 is NOT late (within 15m grace of 09:30)');

// Test late check-in: 09:55 (after 15m grace)
const lateIn = parseOfficeTimeToday('09:55', sampleDate, 'Asia/Kolkata');
const lateRes = calculateLateArrival(lateIn, mockWorkingHours, sampleDate, 'Asia/Kolkata');
assert(lateRes.isLate === true, '09:55 IS late');
assert(lateRes.lateMinutes === 10, `Late minutes is 10 (got: ${lateRes.lateMinutes})`);

// Test on-time checkout: 18:25 (within 15m early checkout grace)
const onTimeOut = parseOfficeTimeToday('18:25', sampleDate, 'Asia/Kolkata');
const onTimeEarlyRes = calculateEarlyCheckout(onTimeOut, mockWorkingHours, sampleDate, 'Asia/Kolkata');
assert(onTimeEarlyRes.isEarlyCheckout === false, '18:25 is NOT early checkout (within 15m grace of 18:30)');

// Test early checkout: 17:30 (before 18:15 threshold)
const earlyOut = parseOfficeTimeToday('17:30', sampleDate, 'Asia/Kolkata');
const earlyRes = calculateEarlyCheckout(earlyOut, mockWorkingHours, sampleDate, 'Asia/Kolkata');
assert(earlyRes.isEarlyCheckout === true, '17:30 IS early checkout');
assert(earlyRes.earlyCheckoutMinutes === 45, `Early checkout minutes is 45 (got: ${earlyRes.earlyCheckoutMinutes})`);

// Full day shift: 09:30 to 18:30 (9 hours = 540 min)
const fullIn = parseOfficeTimeToday('09:30', sampleDate, 'Asia/Kolkata');
const fullOut = parseOfficeTimeToday('18:30', sampleDate, 'Asia/Kolkata');
const fullShiftEval = evaluateAttendanceShift({
  inTime: fullIn,
  outTime: fullOut,
  workingHours: mockWorkingHours,
  office: mockOffice,
  isHoliday: false,
  isWeekOff: false,
  targetDate: sampleDate,
});
assert(fullShiftEval.totalMinutes === 540, `Full day total minutes is 540 (got: ${fullShiftEval.totalMinutes})`);
assert(fullShiftEval.status === 'P', `Full day status is 'P' (got: ${fullShiftEval.status})`);

// Half day shift: 09:30 to 14:30 (5 hours = 300 min)
const halfIn = parseOfficeTimeToday('09:30', sampleDate, 'Asia/Kolkata');
const halfOut = parseOfficeTimeToday('14:30', sampleDate, 'Asia/Kolkata');
const halfShiftEval = evaluateAttendanceShift({
  inTime: halfIn,
  outTime: halfOut,
  workingHours: mockWorkingHours,
  office: mockOffice,
  isHoliday: false,
  isWeekOff: false,
  targetDate: sampleDate,
});
assert(halfShiftEval.totalMinutes === 300, `Half day total minutes is 300 (got: ${halfShiftEval.totalMinutes})`);
assert(halfShiftEval.status === 'Half', `Half day status is 'Half' (got: ${halfShiftEval.status})`);

// Absent shift: 09:30 to 12:00 (2.5 hours = 150 min < 270 min)
const absentIn = parseOfficeTimeToday('09:30', sampleDate, 'Asia/Kolkata');
const absentOut = parseOfficeTimeToday('12:00', sampleDate, 'Asia/Kolkata');
const absentShiftEval = evaluateAttendanceShift({
  inTime: absentIn,
  outTime: absentOut,
  workingHours: mockWorkingHours,
  office: mockOffice,
  isHoliday: false,
  isWeekOff: false,
  targetDate: sampleDate,
});
assert(absentShiftEval.status === 'A', `Under half-day threshold evaluates to 'A' (got: ${absentShiftEval.status})`);

// Sunday / Holiday work evaluation
const sundayShiftEval = evaluateAttendanceShift({
  inTime: fullIn,
  outTime: fullOut,
  workingHours: mockWorkingHours,
  office: mockOffice,
  isHoliday: false,
  isWeekOff: true,
  targetDate: sampleDate,
});
assert(sundayShiftEval.status === 'Coff', `Full day work on Sunday evaluates to 'Coff' (got: ${sundayShiftEval.status})`);
assert(sundayShiftEval.compOffDaysCredited === 1.0, `Comp-off credit is 1.0 day (got: ${sundayShiftEval.compOffDaysCredited})`);

const sundayHalfEval = evaluateAttendanceShift({
  inTime: halfIn,
  outTime: halfOut,
  workingHours: mockWorkingHours,
  office: mockOffice,
  isHoliday: false,
  isWeekOff: true,
  targetDate: sampleDate,
});
assert(sundayHalfEval.status === 'Coff', `Half day work on Sunday evaluates to 'Coff' (got: ${sundayHalfEval.status})`);
assert(sundayHalfEval.compOffDaysCredited === 0.5, `Half day Sunday comp-off credit is 0.5 day (got: ${sundayHalfEval.compOffDaysCredited})`);

console.log('\n─── 3. TESTING PROFESSIONAL TAX (PT) CALCULATION ───');
const mockSettings = {
  ptEnabled: true,
  femaleThreshold: 25000,
  femalePtAmount: 200,
  femaleFebPtAmount: 300,
  maleMinThreshold: 7500,
  maleMidThreshold: 10000,
  maleMidPtAmount: 175,
  maleMaxPtAmount: 200,
  maleFebPtAmount: 300,
};

// Female <= 25k -> 0
assert(calculatePT(20000, 'Female', 5, mockSettings) === 0, 'Female <= 25k has 0 PT');
// Female > 25k regular month -> 200
assert(calculatePT(40000, 'Female', 5, mockSettings) === 200, 'Female > 25k in June has 200 PT');
// Female > 25k Feb -> 300
assert(calculatePT(40000, 'Female', 1, mockSettings) === 300, 'Female > 25k in Feb has 300 PT');

// Male <= 7.5k -> 0
assert(calculatePT(6000, 'Male', 5, mockSettings) === 0, 'Male <= 7.5k has 0 PT');
// Male 8k -> 175
assert(calculatePT(8000, 'Male', 5, mockSettings) === 175, 'Male 8k has 175 PT');
// Male 15k -> 200
assert(calculatePT(15000, 'Male', 5, mockSettings) === 200, 'Male 15k in June has 200 PT');
// Male 15k Feb -> 300
assert(calculatePT(15000, 'Male', 1, mockSettings) === 300, 'Male 15k in Feb has 300 PT');

// Disabled PT -> 0
assert(calculatePT(50000, 'Male', 5, { ptEnabled: false }) === 0, 'Disabled PT returns 0');

console.log('\n─── 4. SUMMARY ───');
console.log(`Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 All business rule tests passed successfully!\n');
}
