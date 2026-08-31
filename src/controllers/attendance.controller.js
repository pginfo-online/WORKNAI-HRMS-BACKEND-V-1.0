import mongoose from 'mongoose';
import { Attendance } from '../models/Attendance.model.js';
import { Employee } from '../models/Employee.model.js';
import { Holiday } from '../models/Holiday.model.js';
import { Leave } from '../models/Leave.model.js';
import { LeaveBalance } from '../models/LeaveBalance.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  getActiveOffice,
  isWithinOffice,
  calcLateMinutes,
  parseTimeToday,
} from '../services/office.service.js';

// ─── DATE HELPERS ──────────────────────────────────────────────────────────────

const startOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const getLocalDateStr = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// ─── CHECK IN ─────────────────────────────────────────────────────────────────

export const checkIn = asyncHandler(async (req, res) => {
  const { latitude, longitude, workMode = 'Office' } = req.body;
  const employee = req.user;

  // Load office + working hours from DB (cached)
  const { office, workingHours } = await getActiveOffice();

  // ── GEO VALIDATION (Office mode, non-bypass employees) ──
  const isGeoBypass = employee.geoBypass || (office?.geoBypassCodes || []).includes(employee.employeeCode);

  if (!isGeoBypass && workMode === 'Office') {
    if (!office) throw new ApiError(503, 'Office settings not configured. Contact HR.');
    if (latitude == null || longitude == null) {
      throw new ApiError(400, 'Location coordinates are required for Office check-in');
    }
    const geoCheck = isWithinOffice(parseFloat(latitude), parseFloat(longitude), office);
    if (!geoCheck.isValid) {
      throw new ApiError(
        400,
        `You are outside office premises (${geoCheck.distance}m away). Must be within ${office.radiusMeters}m.`
      );
    }
  }

  const today = startOfDay();

  // ── BLOCK DUPLICATE CHECK-IN ──
  const existing = await Attendance.findOne({ employeeCode: employee.employeeCode, date: today });
  if (existing?.inTime) throw new ApiError(400, 'Already checked in today');

  const now = new Date();

  // ── LATE CHECK (dynamic from WorkingHours) ──
  let isLate = false;
  let lateMinutes = 0;
  if (workingHours?.checkInTime) {
    lateMinutes = calcLateMinutes(workingHours, now);
    isLate = lateMinutes > 0;
  }

  const locationEntry = latitude != null && longitude != null
    ? [{ latitude: parseFloat(latitude), longitude: parseFloat(longitude), timestamp: now }]
    : [];

  let attendance;
  if (existing) {
    existing.inTime = now;
    existing.isGeoAttendance = true;
    existing.checkInLatitude = latitude != null ? parseFloat(latitude) : null;
    existing.checkInLongitude = longitude != null ? parseFloat(longitude) : null;
    existing.workMode = workMode;
    existing.status = 'P';
    existing.isLate = isLate;
    existing.lateMinutes = lateMinutes;
    existing.locationHistory = locationEntry;
    attendance = await existing.save();
  } else {
    attendance = await Attendance.create({
      employeeId: employee._id,
      employeeCode: employee.employeeCode,
      employeeName: employee.name,
      date: today,
      inTime: now,
      status: 'P',
      isGeoAttendance: true,
      checkInLatitude: latitude != null ? parseFloat(latitude) : null,
      checkInLongitude: longitude != null ? parseFloat(longitude) : null,
      workMode,
      locationHistory: locationEntry,
      isLate,
      lateMinutes,
      correctionStatus: 'None',
    });
  }

  res.status(200).json(new ApiResponse(200, { attendance, checkedInAt: now }, 'Checked in successfully'));
});

// ─── CHECK OUT ────────────────────────────────────────────────────────────────

export const checkOut = asyncHandler(async (req, res) => {
  const { latitude, longitude, todayWork, pendingWork, issuesFaced, reportParticipants } = req.body;
  const employee = req.user;

  const today = startOfDay();
  const attendance = await Attendance.findOne({ employeeCode: employee.employeeCode, date: today });

  if (!attendance?.inTime) {
    throw new ApiError(400, 'No check-in found for today. Please check in first.');
  }
  if (attendance.outTime) {
    throw new ApiError(400, 'Already checked out today');
  }

  // Load office + working hours
  const { office, workingHours } = await getActiveOffice();
  const isGeoBypass = employee.geoBypass || (office?.geoBypassCodes || []).includes(employee.employeeCode);

  if (!isGeoBypass && attendance.workMode === 'Office') {
    if (latitude == null || longitude == null) {
      throw new ApiError(400, 'Location coordinates are required for Office check-out');
    }
    if (office) {
      const geoCheck = isWithinOffice(parseFloat(latitude), parseFloat(longitude), office);
      if (!geoCheck.isValid) {
        throw new ApiError(400, `You are outside office premises (${geoCheck.distance}m away). Must be within ${office.radiusMeters}m.`);
      }
    }
  }

  const now = new Date();
  const workedMs = now - attendance.inTime;
  const totalMinutes = Math.round(workedMs / 60000);
  const totalHours = parseFloat((workedMs / 3600000).toFixed(2));

  // ── SHIFT DURATION from WorkingHours ──
  const fullDayMinutes = workingHours?.fullDayMinutes ?? 480;
  const halfDayMinutes = workingHours?.halfDayMinutes ?? 240;

  // ── COMP-OFF / HOLIDAY CHECK ──
  const dayOfWeek = now.getDay();
  const isWeekOff = workingHours?.workDays ? !workingHours.workDays.includes(dayOfWeek) : dayOfWeek === 0;
  const holidayRecord = await Holiday.findOne({ date: { $gte: startOfDay(now), $lte: endOfDay(now) } });
  const isHoliday = !!holidayRecord;

  let overtimeMinutes = Math.max(0, totalMinutes - fullDayMinutes);
  let shortfallMinutes = Math.max(0, fullDayMinutes - totalMinutes);

  attendance.outTime = now;
  attendance.totalHours = totalHours;
  attendance.totalMinutes = totalMinutes;
  attendance.checkOutLatitude = latitude != null ? parseFloat(latitude) : null;
  attendance.checkOutLongitude = longitude != null ? parseFloat(longitude) : null;
  attendance.todayWork = todayWork;
  attendance.pendingWork = pendingWork;
  attendance.issuesFaced = issuesFaced;
  attendance.reportParticipants = reportParticipants || [];

  // ── COMP-OFF EARNING ──
  if ((isWeekOff || isHoliday) && !attendance.isCompOffCredited) {
    const leaveBalance = await LeaveBalance.findOne({ employeeId: employee._id });
    if (leaveBalance) {
      const prevBalance = leaveBalance.compOffBalance || 0;
      leaveBalance.compOffBalance = prevBalance + 1;
      const expiryDate = new Date(today);
      expiryDate.setMonth(expiryDate.getMonth() + 6);
      leaveBalance.history.push({
        type: 'CompOffCredit',
        leaveType: 'CompOff',
        amount: 1,
        previousBalance: prevBalance,
        newBalance: leaveBalance.compOffBalance,
        remarks: `Comp-Off earned for working on ${isWeekOff ? 'Week Off' : 'Holiday'} (${today.toDateString()})`,
        earnedDate: today,
        expiryDate,
        isUsed: false,
        updatedBy: employee._id,
      });
      await leaveBalance.save();
      attendance.isCompOffCredited = true;
      attendance.status = 'Coff';
    }
  } else if (!isWeekOff && !isHoliday) {
    if (totalMinutes >= halfDayMinutes) {
      attendance.status = totalMinutes >= fullDayMinutes ? 'P' : 'Half';
    } else {
      // Checked out under half-day threshold, mark as Present if checked in properly
      attendance.status = 'P';
    }
  }

  if (latitude != null && longitude != null) {
    attendance.locationHistory.push({ latitude: parseFloat(latitude), longitude: parseFloat(longitude), timestamp: now });
  }

  await attendance.save();

  res.status(200).json(new ApiResponse(200, {
    attendance, checkedOutAt: now, totalHours, totalMinutes, overtimeMinutes, shortfallMinutes,
  }, 'Checked out successfully'));
});

// ─── TRACK LOCATION ───────────────────────────────────────────────────────────

export const trackLocation = asyncHandler(async (req, res) => {
  const { latitude, longitude } = req.body;
  if (latitude == null || longitude == null) throw new ApiError(400, 'Latitude and longitude are required');

  const today = startOfDay();
  const attendance = await Attendance.findOne({
    employeeCode: req.user.employeeCode,
    date: today,
    inTime: { $ne: null },
    outTime: null,
  });

  if (!attendance) throw new ApiError(404, 'No active check-in found for today');
  if (attendance.workMode !== 'Field') {
    return res.status(200).json(new ApiResponse(200, {}, 'Tracking skipped for non-Field mode'));
  }

  attendance.locationHistory.push({ latitude: parseFloat(latitude), longitude: parseFloat(longitude), timestamp: new Date() });
  await attendance.save();

  res.status(200).json(new ApiResponse(200, { locationHistoryLength: attendance.locationHistory.length }, 'Location tracked'));
});

// ─── TODAY STATUS ─────────────────────────────────────────────────────────────

export const getTodayStatus = asyncHandler(async (req, res) => {
  const today = startOfDay();
  const record = await Attendance.findOne({ employeeCode: req.user.employeeCode, date: today }).lean();

  const { office, workingHours } = await getActiveOffice();
  const officeInfo = office ? {
    lat: office.latitude,
    lng: office.longitude,
    radius: office.radiusMeters,
    name: office.name,
    checkInTime: workingHours?.checkInTime,
    checkOutTime: workingHours?.checkOutTime,
    workDays: workingHours?.workDays,
    fullDayMinutes: workingHours?.fullDayMinutes ?? 480,
    halfDayMinutes: workingHours?.halfDayMinutes ?? 240,
    lateGraceMinutes: workingHours?.lateGraceMinutes ?? 0,
  } : null;

  res.json(new ApiResponse(200, { record, date: today, office: officeInfo }, 'Today status fetched'));
});

// ─── MY ATTENDANCE SUMMARY (FIXED TIMEZONE & DATE NORMALIZATION) ───────────────

export const getMySummary = asyncHandler(async (req, res) => {
  const employee = req.user;
  const { from, to, page = 1, limit = 31 } = req.query;

  let start, end;
  if (from) {
    const [fy, fm, fd] = from.split('-').map(Number);
    start = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
  } else {
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }

  if (to) {
    const [ty, tm, td] = to.split('-').map(Number);
    end = new Date(ty, tm - 1, td, 23, 59, 59, 999);
  } else {
    end = endOfDay(new Date());
  }

  const myRecords = await Attendance.find({
    employeeCode: employee.employeeCode,
    date: { $gte: start, $lte: end },
  }).sort({ date: -1 }).lean();

  const holidayRecords = await Holiday.find({ date: { $gte: start, $lte: end } }).lean();

  // Key map using local date strings (YYYY-MM-DD)
  const myRecordsMap = new Map(myRecords.map((r) => [getLocalDateStr(r.date), r]));
  const holidayMap = new Map(holidayRecords.map((h) => [getLocalDateStr(h.date), h]));

  const { workingHours } = await getActiveOffice();

  const summary = { present: 0, absent: 0, weekOff: 0, holiday: 0, late: 0, halfDay: 0, totalHours: 0 };
  const dailyList = [];
  let current = new Date(start);
  const todayStr = getLocalDateStr(new Date());

  while (current <= end) {
    const dateStr = getLocalDateStr(current);
    const record = myRecordsMap.get(dateStr);
    const holiday = holidayMap.get(dateStr);
    const dow = current.getDay(); // Local day of week
    const isWeekOff = workingHours?.workDays ? !workingHours.workDays.includes(dow) : dow === 0;

    let dayStatus = 'A';
    if (record && (record.status === 'P' || record.inTime)) {
      dayStatus = 'P';
      summary.present++;
      if (record.isLate) summary.late++;
    } else if (record && record.status === 'Half') {
      dayStatus = 'Half';
      summary.halfDay++;
    } else if (record && record.status === 'Coff') {
      dayStatus = 'Coff';
      summary.present++;
    } else if (record && record.status === 'L') {
      dayStatus = 'L';
    } else if (holiday) {
      dayStatus = 'H';
      summary.holiday++;
    } else if (isWeekOff) {
      dayStatus = 'WO';
      summary.weekOff++;
    } else if (record && record.status === 'A') {
      dayStatus = 'A';
      summary.absent++;
    } else if (dateStr < todayStr) {
      summary.absent++;
    } else {
      // Future date or today not yet checked in
      dayStatus = dateStr === todayStr ? 'Pending' : 'Future';
    }

    if (record?.totalHours) summary.totalHours += record.totalHours;

    dailyList.push({
      date: new Date(current),
      dateStr,
      dayStatus,
      isWeekOff,
      isHoliday: !!holiday,
      holidayName: holiday?.name,
      record: record || null,
    });

    current.setDate(current.getDate() + 1);
  }

  const total = dailyList.length;
  const pageNum = Number(page);
  const limitNum = Number(limit);
  const paginatedList = dailyList.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  res.json(new ApiResponse(200, {
    summary,
    records: paginatedList,
    pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
  }, 'Attendance summary fetched'));
});

// ─── ATTENDANCE LIST (HR/ADMIN) ───────────────────────────────────────────────

export const getAttendanceList = asyncHandler(async (req, res) => {
  const { date, fromDate, toDate, employeeCode, search, department, workMode, status, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (date) {
    filter.date = { $gte: startOfDay(new Date(date)), $lte: endOfDay(new Date(date)) };
  } else if (fromDate || toDate) {
    filter.date = {};
    if (fromDate) filter.date.$gte = startOfDay(new Date(fromDate));
    if (toDate) filter.date.$lte = endOfDay(new Date(toDate));
  }

  const searchTerm = search || employeeCode;
  if (searchTerm) {
    filter.$or = [
      { employeeCode: { $regex: searchTerm, $options: 'i' } },
      { employeeName: { $regex: searchTerm, $options: 'i' } },
    ];
  }

  if (workMode) filter.workMode = workMode;
  if (status) filter.status = status;

  if (department) {
    const emps = await Employee.find({ department }, { employeeCode: 1 }).lean();
    filter.employeeCode = { $in: emps.map((e) => e.employeeCode) };
  }

  const total = await Attendance.countDocuments(filter);
  const records = await Attendance.find(filter)
    .sort({ date: -1, inTime: -1, createdAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  res.json(new ApiResponse(200, {
    records,
    data: records,
    pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
  }, 'Attendance list fetched'));
});

// ─── MARK REPORT AS READ ──────────────────────────────────────────────────────

export const markReportAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const record = await Attendance.findById(id);
  if (!record) {
    throw new ApiError(404, 'Attendance record not found');
  }

  if (!record.reportReadBy) {
    record.reportReadBy = [];
  }

  const alreadyRead = record.reportReadBy.some(
    (readId) => readId.toString() === userId.toString()
  );

  if (!alreadyRead) {
    record.reportReadBy.push(userId);
    await record.save();
  }

  res.json(new ApiResponse(200, record, 'Report marked as read'));
});

// ─── CORRECTION REQUEST ───────────────────────────────────────────────────────

export const requestCorrection = asyncHandler(async (req, res) => {
  const attendanceId = req.body.attendanceId || req.params.id;
  const {
    date,
    requestedInTime,
    requestedOutTime,
    requestedStatus = 'P',
    correctionReason,
    reason,
    correctionProofUrl,
    proofUrl,
  } = req.body;

  const actualReason = correctionReason || reason || '';
  const actualProofUrl = correctionProofUrl || proofUrl || '';

  if (!requestedInTime && !requestedOutTime && !actualReason) {
    throw new ApiError(400, 'Please provide at least a requested check-in/check-out time or reason');
  }

  let attendance = null;

  // 1. Try finding by valid MongoDB ObjectId
  if (attendanceId && mongoose.Types.ObjectId.isValid(attendanceId)) {
    attendance = await Attendance.findById(attendanceId);
  }

  // 2. If not found by ID, try finding by employee and date
  const targetDateStr = date || requestedInTime || (attendance ? attendance.date : null);
  if (!attendance && targetDateStr) {
    const targetDate = startOfDay(new Date(targetDateStr));
    attendance = await Attendance.findOne({
      employeeCode: req.user.employeeCode,
      date: targetDate,
    });
  }

  // 3. If still no record exists (e.g. Absent day or Holiday with no record document), create one!
  if (!attendance) {
    if (!targetDateStr) {
      throw new ApiError(400, 'Attendance date or valid record ID is required');
    }
    const targetDate = startOfDay(new Date(targetDateStr));
    attendance = new Attendance({
      employeeId: req.user._id,
      employeeCode: req.user.employeeCode,
      employeeName: req.user.name,
      date: targetDate,
      status: 'A',
      correctionStatus: 'None',
    });
  }

  if (attendance.employeeId.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'You can only request correction for your own attendance');
  }

  if (['Pending_HR', 'Pending_GM', 'Pending_VP', 'Pending_Director'].includes(attendance.correctionStatus)) {
    throw new ApiError(400, 'A correction request is already pending for this date');
  }

  attendance.correctionRequested = true;
  attendance.correctionStatus = 'Pending_HR';
  attendance.correctionReason = actualReason;
  attendance.correctionCount = (attendance.correctionCount || 0) + 1;
  if (actualProofUrl) attendance.correctionProofUrl = actualProofUrl;
  attendance.correctionRequestedOn = new Date();
  if (requestedInTime) attendance.requestedInTime = new Date(requestedInTime);
  if (requestedOutTime) attendance.requestedOutTime = new Date(requestedOutTime);
  if (requestedStatus) attendance.requestedStatus = requestedStatus;

  attendance.correctionHistory.push({
    action: 'Requested',
    byRole: req.user.role,
    byEmployeeId: req.user._id,
    remark: actualReason || `Correction requested (${requestedStatus})`,
    timestamp: new Date(),
  });

  await attendance.save();

  res.status(200).json(new ApiResponse(200, attendance, 'Correction request submitted to HR'));
});

// ─── GET CORRECTION HISTORY ───────────────────────────────────────────────────

export const getMyCorrectionHistory = asyncHandler(async (req, res) => {
  const { month, year, employeeCode } = req.query;
  const isManager = ['Admin', 'SuperAdmin', 'HR', 'Director', 'VP', 'GM', 'Manager'].includes(req.user.role);

  const filter = { correctionRequested: true };

  // If not a manager role, force own employeeCode
  if (!isManager || !employeeCode) {
    if (!isManager) {
      filter.employeeCode = req.user.employeeCode;
    }
  } else if (employeeCode) {
    filter.employeeCode = employeeCode;
  }

  if (month && year) {
    const start = new Date(Number(year), Number(month) - 1, 1, 0, 0, 0, 0);
    const end = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);
    filter.date = { $gte: start, $lte: end };
  }

  const records = await Attendance.find(filter)
    .sort({ correctionRequestedOn: -1, date: -1 })
    .lean();

  res.status(200).json(new ApiResponse(200, records, 'Correction requests history fetched'));
});

// ─── GET PENDING CORRECTIONS (HR / ADMIN) ─────────────────────────────────────

export const getPendingCorrections = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, employeeCode } = req.query;

  const filter = {
    correctionRequested: true,
    correctionStatus: { $in: ['Pending_HR', 'Pending_GM', 'Pending_VP', 'Pending_Director'] },
  };
  if (employeeCode) filter.employeeCode = { $regex: employeeCode, $options: 'i' };

  const total = await Attendance.countDocuments(filter);
  const records = await Attendance.find(filter)
    .sort({ correctionRequestedOn: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  res.status(200).json(
    new ApiResponse(
      200,
      {
        records,
        pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
      },
      'Pending corrections fetched'
    )
  );
});

// ─── APPROVE / REJECT CORRECTION ──────────────────────────────────────────────

export const approveCorrection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, remark, requestedStatus } = req.body; // status: 'Approved' | 'Rejected'

  if (!['Approved', 'Rejected'].includes(status)) {
    throw new ApiError(400, "Invalid status. Must be 'Approved' or 'Rejected'");
  }

  const attendance = await Attendance.findById(id);
  if (!attendance) throw new ApiError(404, 'Attendance record not found');

  if (status === 'Approved') {
    if (attendance.requestedInTime) attendance.inTime = attendance.requestedInTime;
    if (attendance.requestedOutTime) attendance.outTime = attendance.requestedOutTime;

    if (attendance.inTime && attendance.outTime) {
      const workedMs = new Date(attendance.outTime) - new Date(attendance.inTime);
      attendance.totalMinutes = Math.max(0, Math.round(workedMs / 60000));
      attendance.totalHours = parseFloat((workedMs / 3600000).toFixed(2));
    }

    const { workingHours } = await getActiveOffice();
    if (workingHours?.checkInTime && attendance.inTime) {
      attendance.lateMinutes = calcLateMinutes(workingHours, new Date(attendance.inTime));
      attendance.isLate = attendance.lateMinutes > 0;
    }

    // Set approved status
    attendance.status = requestedStatus || attendance.requestedStatus || 'P';
    attendance.correctionStatus = 'Approved';
  } else {
    attendance.correctionStatus = 'Rejected';
  }

  attendance.correctionHistory.push({
    action: status,
    byRole: req.user.role,
    byEmployeeId: req.user._id,
    remark: remark || `Correction ${status.toLowerCase()}`,
    timestamp: new Date(),
  });

  await attendance.save();

  res.status(200).json(new ApiResponse(200, attendance, `Correction ${status.toLowerCase()} successfully`));
});

// ─── GET INDIVIDUAL EMPLOYEE SUMMARY ──────────────────────────────────────────

export const getEmployeeAttendanceSummary = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;
  const { from, to } = req.query;

  const emp = await Employee.findById(employeeId);
  if (!emp) throw new ApiError(404, 'Employee not found');

  const start = from ? startOfDay(new Date(from)) : startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const end = to ? endOfDay(new Date(to)) : endOfDay(new Date());

  const records = await Attendance.find({
    employeeCode: emp.employeeCode,
    date: { $gte: start, $lte: end },
  }).sort({ date: -1 }).lean();

  res.status(200).json(
    new ApiResponse(200, { employee: emp, records }, 'Employee attendance summary fetched')
  );
});
