import mongoose from 'mongoose';
import { Attendance } from '../models/Attendance.model.js';
import { Employee } from '../models/Employee.model.js';
import { Holiday } from '../models/Holiday.model.js';
import { Leave } from '../models/Leave.model.js';
import { LeaveBalance } from '../models/LeaveBalance.model.js';
import { Task } from '../models/Task.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  getActiveOffice,
  isWithinOffice,
} from '../services/office.service.js';
import {
  getOfficeDateStr,
  getOfficeStartOfDay,
  getOfficeEndOfDay,
  getDayOfWeekInOffice,
  DEFAULT_TIMEZONE,
} from '../utils/dateHelper.js';
import {
  evaluateAttendanceShift,
  calculateLateArrival,
} from '../services/attendanceCalculation.service.js';

// ─── CHECK IN ─────────────────────────────────────────────────────────────────

export const checkIn = asyncHandler(async (req, res) => {
  const { latitude, longitude, tasks = [] } = req.body;
  const workMode = req.body.workMode === 'WFH' ? 'WFH' : 'Office';
  const employee = req.user;

  // Load office + working hours from DB (cached)
  const { office, workingHours } = await getActiveOffice();
  const timezone = office?.timezone || DEFAULT_TIMEZONE;

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

  const now = new Date();
  const today = getOfficeStartOfDay(now, timezone);

  // ── IDEMPOTENCY / BLOCK DUPLICATE CHECK-IN ──
  const existing = await Attendance.findOne({ employeeCode: employee.employeeCode, date: today });
  if (existing?.inTime) {
    return res.status(200).json(
      new ApiResponse(200, { attendance: existing, checkedInAt: existing.inTime, alreadyCheckedIn: true }, 'Already checked in today')
    );
  }

  // ── LATE CALCULATION (centralized) ──
  const { isLate, lateMinutes } = calculateLateArrival(now, workingHours, today, timezone);

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

  // ── ATOMIC TASK INITIALIZATION IF PROVIDED ──
  const createdTasks = [];
  if (Array.isArray(tasks) && tasks.length > 0) {
    for (const draft of tasks) {
      if (draft && draft.title && draft.title.trim()) {
        const newTask = await Task.create({
          employeeId: employee._id,
          employeeCode: employee.employeeCode,
          employeeName: employee.name,
          attendanceId: attendance._id,
          date: today,
          title: draft.title.trim(),
          priority: draft.priority || 'Medium',
          status: 'Assigned',
          isSelfAssigned: true,
          isAdminAssigned: false,
          assignedBy: employee._id,
          assignedByName: employee.name,
        });
        createdTasks.push(newTask);
      }
    }
  }

  res.status(200).json(
    new ApiResponse(
      200,
      {
        attendance,
        checkedInAt: now,
        tasks: createdTasks,
        office: {
          name: office?.name,
          checkInTime: workingHours?.checkInTime,
          checkOutTime: workingHours?.checkOutTime,
          lateGraceMinutes: workingHours?.lateGraceMinutes,
          earlyCheckoutGraceMinutes: workingHours?.earlyCheckoutGraceMinutes,
          fullDayMinutes: workingHours?.fullDayMinutes,
          halfDayMinutes: workingHours?.halfDayMinutes,
        },
      },
      'Checked in successfully'
    )
  );
});

// ─── CHECK OUT ────────────────────────────────────────────────────────────────

export const checkOut = asyncHandler(async (req, res) => {
  const { latitude, longitude, todayWork, pendingWork, issuesFaced, reportParticipants, tasks = [] } = req.body;
  const employee = req.user;

  const { office, workingHours } = await getActiveOffice();
  const timezone = office?.timezone || DEFAULT_TIMEZONE;

  const now = new Date();
  const today = getOfficeStartOfDay(now, timezone);
  const attendance = await Attendance.findOne({ employeeCode: employee.employeeCode, date: today });

  if (!attendance?.inTime) {
    throw new ApiError(400, 'No check-in found for today. Please check in first.');
  }
  if (attendance.outTime) {
    throw new ApiError(400, 'Already checked out today');
  }

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

  // ── HOLIDAY & WEEK-OFF CHECK ──
  const dow = getDayOfWeekInOffice(now, timezone);
  const isWeekOff = workingHours?.workDays ? !workingHours.workDays.includes(dow) : dow === 0;
  const holidayRecord = await Holiday.findOne({
    date: { $gte: today, $lte: getOfficeEndOfDay(now, timezone) },
  });
  const isHoliday = !!holidayRecord;

  // ── CENTRALIZED TIMING EVALUATION ──
  const shiftEval = evaluateAttendanceShift({
    inTime: attendance.inTime,
    outTime: now,
    workingHours,
    office,
    isHoliday,
    isWeekOff,
    targetDate: today,
  });

  attendance.outTime = now;
  attendance.totalHours = shiftEval.totalHours;
  attendance.totalMinutes = shiftEval.totalMinutes;
  attendance.isLate = shiftEval.isLate;
  attendance.lateMinutes = shiftEval.lateMinutes;
  attendance.isEarlyCheckout = shiftEval.isEarlyCheckout;
  attendance.earlyCheckoutMinutes = shiftEval.earlyCheckoutMinutes;
  attendance.overtimeMinutes = shiftEval.overtimeMinutes;
  attendance.shortfallMinutes = shiftEval.shortfallMinutes;
  attendance.status = shiftEval.status;

  attendance.checkOutLatitude = latitude != null ? parseFloat(latitude) : null;
  attendance.checkOutLongitude = longitude != null ? parseFloat(longitude) : null;
  attendance.todayWork = todayWork;
  attendance.pendingWork = pendingWork;
  attendance.issuesFaced = issuesFaced;
  attendance.reportParticipants = reportParticipants || [];

  // ── COMP-OFF ACCRUAL ──
  if ((isWeekOff || isHoliday) && shiftEval.compOffDaysCredited > 0 && !attendance.isCompOffCredited) {
    const leaveBalance = await LeaveBalance.findOne({ employeeId: employee._id });
    if (leaveBalance) {
      const prevBalance = leaveBalance.compOffBalance || 0;
      leaveBalance.compOffBalance = prevBalance + shiftEval.compOffDaysCredited;
      const expiryDate = new Date(today);
      expiryDate.setMonth(expiryDate.getMonth() + 6);
      leaveBalance.history.push({
        type: 'CompOffCredit',
        leaveType: 'CompOff',
        amount: shiftEval.compOffDaysCredited,
        previousBalance: prevBalance,
        newBalance: leaveBalance.compOffBalance,
        remarks: `Comp-Off earned (${shiftEval.compOffDaysCredited} day) for working on ${isWeekOff ? 'Week Off' : 'Holiday'} (${today.toDateString()})`,
        earnedDate: today,
        expiryDate,
        isUsed: false,
        updatedBy: employee._id,
      });
      await leaveBalance.save();
      attendance.isCompOffCredited = true;
      attendance.compOffDaysCredited = shiftEval.compOffDaysCredited;
    }
  }

  if (latitude != null && longitude != null) {
    attendance.locationHistory.push({ latitude: parseFloat(latitude), longitude: parseFloat(longitude), timestamp: now });
  }

  await attendance.save();

  // ── BATCH SYNC SESSION TASKS IF PROVIDED AT CHECKOUT ──
  if (Array.isArray(tasks) && tasks.length > 0) {
    const validTasks = tasks.filter((t) => t && t._id);
    for (const t of validTasks) {
      const isCompleted = t.status === 'Completed';
      await Task.findOneAndUpdate(
        { _id: t._id, employeeId: employee._id },
        {
          $set: {
            status: isCompleted ? 'Completed' : 'Pending',
            completedAt: isCompleted ? new Date() : null,
            description: t.description !== undefined ? String(t.description).trim() : undefined,
            notes: t.notes !== undefined ? String(t.notes).trim() : undefined,
            attendanceId: attendance._id,
          },
        }
      );
    }
  }

  res.status(200).json(new ApiResponse(200, {
    attendance,
    checkedOutAt: now,
    totalHours: shiftEval.totalHours,
    totalMinutes: shiftEval.totalMinutes,
    isLate: shiftEval.isLate,
    lateMinutes: shiftEval.lateMinutes,
    isEarlyCheckout: shiftEval.isEarlyCheckout,
    earlyCheckoutMinutes: shiftEval.earlyCheckoutMinutes,
    overtimeMinutes: shiftEval.overtimeMinutes,
    shortfallMinutes: shiftEval.shortfallMinutes,
  }, 'Checked out successfully'));
});

// ─── TODAY STATUS ─────────────────────────────────────────────────────────────

export const getTodayStatus = asyncHandler(async (req, res) => {
  const { office, workingHours } = await getActiveOffice();
  const timezone = office?.timezone || DEFAULT_TIMEZONE;

  const today = getOfficeStartOfDay(new Date(), timezone);
  const record = await Attendance.findOne({ employeeCode: req.user.employeeCode, date: today }).lean();

  const officeInfo = office ? {
    lat: office.latitude,
    lng: office.longitude,
    radius: office.radiusMeters,
    name: office.name,
    timezone,
    checkInTime: workingHours?.checkInTime,
    checkOutTime: workingHours?.checkOutTime,
    workDays: workingHours?.workDays ?? [1, 2, 3, 4, 5, 6],
    fullDayMinutes: workingHours?.fullDayMinutes ?? 540,
    halfDayMinutes: workingHours?.halfDayMinutes ?? 270,
    lateGraceMinutes: workingHours?.lateGraceMinutes ?? 0,
    earlyCheckoutGraceMinutes: workingHours?.earlyCheckoutGraceMinutes ?? 0,
  } : null;

  res.json(new ApiResponse(200, { record, date: today, office: officeInfo }, 'Today status fetched'));
});

// ─── ATTENDANCE SUMMARY (PRODUCTION-GRADE & TIMEZONE NORMALIZED) ─────────────

export const getMySummary = asyncHandler(async (req, res) => {
  const employee = req.user;
  const { from, to, page = 1, limit = 31 } = req.query;

  const { office, workingHours } = await getActiveOffice();
  const timezone = office?.timezone || DEFAULT_TIMEZONE;

  let start, end;
  if (from) {
    const [fy, fm, fd] = from.split('-').map(Number);
    start = getOfficeStartOfDay(new Date(fy, fm - 1, fd), timezone);
  } else {
    const now = new Date();
    start = getOfficeStartOfDay(new Date(now.getFullYear(), now.getMonth(), 1), timezone);
  }

  if (to) {
    const [ty, tm, td] = to.split('-').map(Number);
    end = getOfficeEndOfDay(new Date(ty, tm - 1, td), timezone);
  } else {
    end = getOfficeEndOfDay(new Date(), timezone);
  }

  const [myRecords, holidayRecords, approvedLeaves] = await Promise.all([
    Attendance.find({
      employeeCode: employee.employeeCode,
      date: { $gte: start, $lte: end },
    }).sort({ date: -1 }).lean(),
    Holiday.find({ date: { $gte: start, $lte: end } }).lean(),
    Leave.find({
      employeeId: employee._id,
      overallStatus: 'Approved',
      startDate: { $lte: end },
      endDate: { $gte: start },
    }).lean(),
  ]);

  const myRecordsMap = new Map(myRecords.map((r) => [getOfficeDateStr(r.date, timezone), r]));
  const holidayMap = new Map(holidayRecords.map((h) => [getOfficeDateStr(h.date, timezone), h]));

  const summary = {
    present: 0,
    halfDay: 0,
    absent: 0,
    leave: 0,
    weekOff: 0,
    holiday: 0,
    late: 0,
    earlyCheckout: 0,
    totalHours: 0,
    overtimeMinutes: 0,
    attendancePercentage: 0,
  };

  const dailyList = [];
  let current = new Date(start);
  const todayStr = getOfficeDateStr(new Date(), timezone);
  let totalEvaluatedDays = 0;

  while (current <= end) {
    const dateStr = getOfficeDateStr(current, timezone);
    const record = myRecordsMap.get(dateStr);
    const holiday = holidayMap.get(dateStr);
    const dow = getDayOfWeekInOffice(current, timezone);
    const isWeekOff = workingHours?.workDays ? !workingHours.workDays.includes(dow) : dow === 0;

    // Check if on approved leave
    const isOnLeave = approvedLeaves.some((l) => {
      const lStart = getOfficeDateStr(l.startDate, timezone);
      const lEnd = getOfficeDateStr(l.endDate, timezone);
      return dateStr >= lStart && dateStr <= lEnd;
    });

    let dayStatus = 'A';

    if (record) {
      if (record.status === 'Half') {
        dayStatus = 'Half';
        summary.halfDay++;
        if (record.isLate) summary.late++;
        if (record.isEarlyCheckout) summary.earlyCheckout++;
      } else if (record.status === 'Coff') {
        dayStatus = 'Coff';
        summary.present++;
        if (record.isLate) summary.late++;
        if (record.isEarlyCheckout) summary.earlyCheckout++;
      } else if (record.status === 'L') {
        dayStatus = 'L';
        summary.leave++;
      } else if (record.status === 'A') {
        dayStatus = 'A';
        summary.absent++;
      } else if (record.status === 'P' || record.inTime) {
        dayStatus = 'P';
        summary.present++;
        if (record.isLate) summary.late++;
        if (record.isEarlyCheckout) summary.earlyCheckout++;
      } else if (record.status === 'WO') {
        dayStatus = 'WO';
        summary.weekOff++;
      } else if (record.status === 'H') {
        dayStatus = 'H';
        summary.holiday++;
      } else {
        dayStatus = record.status || 'P';
      }

      if (record.totalHours) summary.totalHours += record.totalHours;
      if (record.overtimeMinutes) summary.overtimeMinutes += record.overtimeMinutes;
    } else if (isOnLeave) {
      dayStatus = 'L';
      summary.leave++;
    } else if (holiday) {
      dayStatus = 'H';
      summary.holiday++;
    } else if (isWeekOff) {
      dayStatus = 'WO';
      summary.weekOff++;
    } else if (dateStr < todayStr) {
      dayStatus = 'A';
      summary.absent++;
    } else {
      dayStatus = dateStr === todayStr ? 'Pending' : 'Future';
    }

    if (dateStr <= todayStr) {
      totalEvaluatedDays++;
    }

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

  // Round total hours
  summary.totalHours = parseFloat(summary.totalHours.toFixed(2));

  // Calculate Attendance Percentage: (effective present + leaves + holidays + weekoffs) / evaluated days
  if (totalEvaluatedDays > 0) {
    const creditedDays = summary.present + (summary.halfDay * 0.5) + summary.leave + summary.holiday + summary.weekOff;
    summary.attendancePercentage = Math.min(100, Math.round((creditedDays / totalEvaluatedDays) * 100));
  }

  const total = dailyList.length;
  const pageNum = Number(page);
  const limitNum = Number(limit);
  const paginatedList = dailyList.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  res.json(new ApiResponse(200, {
    summary,
    records: paginatedList,
    pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    office: {
      checkInTime: workingHours?.checkInTime,
      checkOutTime: workingHours?.checkOutTime,
      fullDayMinutes: workingHours?.fullDayMinutes,
      halfDayMinutes: workingHours?.halfDayMinutes,
      lateGraceMinutes: workingHours?.lateGraceMinutes,
      earlyCheckoutGraceMinutes: workingHours?.earlyCheckoutGraceMinutes,
      timezone,
    },
  }, 'Attendance summary fetched'));
});

// ─── ATTENDANCE LIST (HR/ADMIN) ───────────────────────────────────────────────

export const getAttendanceList = asyncHandler(async (req, res) => {
  const { date, fromDate, toDate, employeeCode, search, department, workMode, status, page = 1, limit = 20 } = req.query;

  const { office } = await getActiveOffice();
  const timezone = office?.timezone || DEFAULT_TIMEZONE;

  const filter = {};
  if (date) {
    const [y, m, d] = date.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    filter.date = { $gte: getOfficeStartOfDay(target, timezone), $lte: getOfficeEndOfDay(target, timezone) };
  } else if (fromDate || toDate) {
    filter.date = {};
    if (fromDate) filter.date.$gte = getOfficeStartOfDay(new Date(fromDate), timezone);
    if (toDate) filter.date.$lte = getOfficeEndOfDay(new Date(toDate), timezone);
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
  const rawRecords = await Attendance.find(filter)
    .sort({ date: -1, inTime: -1, createdAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  const records = rawRecords.map((r) => ({
    ...r,
    checkInTime: r.inTime || r.checkInTime,
    checkOutTime: r.outTime || r.checkOutTime,
    location: {
      latitude: r.checkInLatitude ?? r.location?.latitude,
      longitude: r.checkInLongitude ?? r.location?.longitude,
      checkOutLatitude: r.checkOutLatitude ?? r.location?.checkOutLatitude,
      checkOutLongitude: r.checkOutLongitude ?? r.location?.checkOutLongitude,
    },
  }));

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

// ─── REQUEST CORRECTION ───────────────────────────────────────────────────────

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
    throw new ApiError(400, 'Please provide requested check-in/out times and a reason');
  }

  const { office } = await getActiveOffice();
  const timezone = office?.timezone || DEFAULT_TIMEZONE;

  // Parse and normalize target date
  const targetDateStr = date || (requestedInTime ? getOfficeDateStr(requestedInTime, timezone) : null);
  if (!targetDateStr) {
    throw new ApiError(400, 'Attendance date is required');
  }

  const [y, m, d] = targetDateStr.slice(0, 10).split('-').map(Number);
  const targetDate = getOfficeStartOfDay(new Date(y, m - 1, d), timezone);
  const todayEnd = getOfficeEndOfDay(new Date(), timezone);

  // Future date check
  if (targetDate > todayEnd) {
    throw new ApiError(400, 'Cannot request attendance correction for a future date');
  }

  // Validate in/out sequence if both are provided
  if (requestedInTime && requestedOutTime) {
    if (new Date(requestedOutTime) <= new Date(requestedInTime)) {
      throw new ApiError(400, 'Requested Check-out time must be after check-in time');
    }
  }

  let attendance = null;

  // 1. Try finding by valid MongoDB ObjectId
  if (attendanceId && mongoose.Types.ObjectId.isValid(attendanceId)) {
    attendance = await Attendance.findById(attendanceId);
  }

  // 2. If not found by ID, try finding by employee and date
  if (!attendance && targetDate) {
    attendance = await Attendance.findOne({
      employeeCode: req.user.employeeCode,
      date: targetDate,
    });
  }

  // 3. If still no record exists (e.g. Absent day), create placeholder record
  if (!attendance) {
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

// ─── EDIT PENDING CORRECTION ──────────────────────────────────────────────────

export const editCorrection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { requestedInTime, requestedOutTime, requestedStatus, correctionReason, reason, correctionProofUrl, proofUrl } = req.body;

  const attendance = await Attendance.findById(id);
  if (!attendance) throw new ApiError(404, 'Attendance record not found');

  if (attendance.employeeId.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'You can only edit your own correction request');
  }

  if (!['Pending_HR', 'Pending_GM', 'Pending_VP', 'Pending_Director'].includes(attendance.correctionStatus)) {
    throw new ApiError(400, 'Cannot edit correction request. It has already been reviewed.');
  }

  if (requestedInTime && requestedOutTime && new Date(requestedOutTime) <= new Date(requestedInTime)) {
    throw new ApiError(400, 'Requested Check-out time must be after check-in time');
  }

  const actualReason = correctionReason || reason;
  const actualProof = correctionProofUrl || proofUrl;

  if (requestedInTime) attendance.requestedInTime = new Date(requestedInTime);
  if (requestedOutTime) attendance.requestedOutTime = new Date(requestedOutTime);
  if (requestedStatus) attendance.requestedStatus = requestedStatus;
  if (actualReason) attendance.correctionReason = actualReason;
  if (actualProof) attendance.correctionProofUrl = actualProof;

  attendance.correctionHistory.push({
    action: 'Requested',
    byRole: req.user.role,
    byEmployeeId: req.user._id,
    remark: `Updated correction request: ${actualReason || ''}`,
    timestamp: new Date(),
  });

  await attendance.save();

  res.status(200).json(new ApiResponse(200, attendance, 'Correction request updated successfully'));
});

// ─── GET CORRECTION HISTORY ───────────────────────────────────────────────────

export const getMyCorrectionHistory = asyncHandler(async (req, res) => {
  const { month, year, employeeCode } = req.query;
  const isManager = ['Admin', 'SuperAdmin', 'HR', 'Director', 'VP', 'GM', 'Manager', 'SuperUser'].includes(req.user.role);

  const filter = { correctionRequested: true };

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
  const { page = 1, limit = 10, employeeCode, search, status } = req.query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

  const filter = {
    correctionRequested: true,
    correctionStatus: { $in: ['Pending_HR', 'Pending_GM', 'Pending_VP', 'Pending_Director'] },
  };

  if (status && status !== 'All') {
    filter.correctionStatus = status;
  }

  if (search && search.trim()) {
    const s = search.trim();
    filter.$or = [
      { employeeName: { $regex: s, $options: 'i' } },
      { employeeCode: { $regex: s, $options: 'i' } },
      { department: { $regex: s, $options: 'i' } },
    ];
  } else if (employeeCode && employeeCode.trim()) {
    filter.employeeCode = { $regex: employeeCode.trim(), $options: 'i' };
  }

  const total = await Attendance.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil(total / limitNum));
  const records = await Attendance.find(filter)
    .sort({ correctionRequestedOn: -1, createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .lean();

  res.status(200).json(
    new ApiResponse(
      200,
      {
        records,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages,
        },
      },
      'Pending corrections fetched'
    )
  );
});

// ─── APPROVE / REJECT CORRECTION (WITH CENTRALIZED RECALCULATION) ─────────────

export const approveCorrection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, remark, requestedStatus } = req.body; // status: 'Approved' | 'Rejected'

  if (!['Approved', 'Rejected'].includes(status)) {
    throw new ApiError(400, "Invalid status. Must be 'Approved' or 'Rejected'");
  }

  const attendance = await Attendance.findById(id);
  if (!attendance) throw new ApiError(404, 'Attendance record not found');

  if (!['Pending_HR', 'Pending_GM', 'Pending_VP', 'Pending_Director'].includes(attendance.correctionStatus)) {
    throw new ApiError(400, `Cannot update correction. Current status is already '${attendance.correctionStatus}'`);
  }

  if (status === 'Approved') {
    if (attendance.requestedInTime) attendance.inTime = attendance.requestedInTime;
    if (attendance.requestedOutTime) attendance.outTime = attendance.requestedOutTime;

    const { office, workingHours } = await getActiveOffice();
    const timezone = office?.timezone || DEFAULT_TIMEZONE;

    // Check holiday / week off
    const dow = getDayOfWeekInOffice(attendance.date, timezone);
    const isWeekOff = workingHours?.workDays ? !workingHours.workDays.includes(dow) : dow === 0;
    const holidayRecord = await Holiday.findOne({
      date: {
        $gte: getOfficeStartOfDay(attendance.date, timezone),
        $lte: getOfficeEndOfDay(attendance.date, timezone),
      },
    });
    const isHoliday = !!holidayRecord;

    // Centralized recalculation
    const shiftEval = evaluateAttendanceShift({
      inTime: attendance.inTime,
      outTime: attendance.outTime,
      workingHours,
      office,
      isHoliday,
      isWeekOff,
      targetDate: attendance.date,
    });

    attendance.totalHours = shiftEval.totalHours;
    attendance.totalMinutes = shiftEval.totalMinutes;
    attendance.isLate = shiftEval.isLate;
    attendance.lateMinutes = shiftEval.lateMinutes;
    attendance.isEarlyCheckout = shiftEval.isEarlyCheckout;
    attendance.earlyCheckoutMinutes = shiftEval.earlyCheckoutMinutes;
    attendance.overtimeMinutes = shiftEval.overtimeMinutes;
    attendance.shortfallMinutes = shiftEval.shortfallMinutes;

    const finalStatus = requestedStatus || attendance.requestedStatus || shiftEval.status;
    attendance.status = finalStatus;
    attendance.correctionStatus = 'Approved';

    // Credit Comp-Off if approved as Comp-Off
    if (finalStatus === 'Coff' && !attendance.isCompOffCredited) {
      const leaveBalance = await LeaveBalance.findOne({ employeeId: attendance.employeeId });
      if (leaveBalance) {
        const creditAmt = shiftEval.compOffDaysCredited || 1.0;
        const prevBalance = leaveBalance.compOffBalance || 0;
        leaveBalance.compOffBalance = prevBalance + creditAmt;
        const expiryDate = new Date(attendance.date);
        expiryDate.setMonth(expiryDate.getMonth() + 6);
        leaveBalance.history.push({
          type: 'CompOffCredit',
          leaveType: 'CompOff',
          amount: creditAmt,
          previousBalance: prevBalance,
          newBalance: leaveBalance.compOffBalance,
          remarks: `Comp-Off (${creditAmt} day) approved via correction for ${attendance.date.toDateString()}`,
          earnedDate: attendance.date,
          expiryDate,
          isUsed: false,
          updatedBy: req.user._id,
        });
        await leaveBalance.save();
        attendance.isCompOffCredited = true;
        attendance.compOffDaysCredited = creditAmt;
      }
    }
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

  const { office, workingHours } = await getActiveOffice();
  const timezone = office?.timezone || DEFAULT_TIMEZONE;

  const start = from
    ? getOfficeStartOfDay(new Date(from), timezone)
    : getOfficeStartOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1), timezone);
  const end = to
    ? getOfficeEndOfDay(new Date(to), timezone)
    : getOfficeEndOfDay(new Date(), timezone);

  const records = await Attendance.find({
    employeeCode: emp.employeeCode,
    date: { $gte: start, $lte: end },
  }).sort({ date: -1 }).lean();

  res.status(200).json(
    new ApiResponse(200, { employee: emp, records }, 'Employee attendance summary fetched')
  );
});
