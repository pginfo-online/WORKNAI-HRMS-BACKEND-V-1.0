import { Payroll } from '../models/Payroll.model.js';
import { Attendance } from '../models/Attendance.model.js';
import { Employee } from '../models/Employee.model.js';
import { Holiday } from '../models/Holiday.model.js';
import { Leave } from '../models/Leave.model.js';
import { PayrollSettings } from '../models/PayrollSettings.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { evaluateWorkingMinutes } from '../utils/attendanceHelper.js';
import { generateSalarySlipPdfBuffer, renderSalarySlipDoc } from '../utils/pdfHelper.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { Readable } from 'stream';

// ─── PT CALCULATION WITH DYNAMIC SETTINGS ─────────────────────────────────────

/**
 * Calculates Professional Tax (PT) based on dynamic settings configured by Admin/HR.
 * @param {Number} baseSalary - Monthly fixed CTC / basic
 * @param {String} gender - Gender (Male/Female/Other)
 * @param {Number} monthIndex - 0-based month (0=Jan, 1=Feb, etc.)
 * @param {Object} settings - PayrollSettings document
 * @returns {Number} PT deduction in INR
 */
export const calculatePT = (baseSalary, gender, monthIndex, settings) => {
  // If PT deduction is disabled in settings, return 0
  if (!settings || !settings.ptEnabled) {
    return 0;
  }

  const normalizedGender = (gender || '').toLowerCase();
  const isFebruary = (monthIndex === 1);

  // =========================
  // FEMALE
  // =========================
  if (normalizedGender === 'female') {
    if (baseSalary <= (settings.femaleThreshold ?? 25000)) {
      return 0;
    }
    if (isFebruary) {
      return settings.femaleFebPtAmount ?? 300;
    }
    return settings.femalePtAmount ?? 200;
  }

  // =========================
  // MALE / OTHER
  // =========================
  if (baseSalary <= (settings.maleMinThreshold ?? 7500)) {
    return 0;
  }

  if (baseSalary <= (settings.maleMidThreshold ?? 10000)) {
    return settings.maleMidPtAmount ?? 175;
  }

  if (isFebruary) {
    return settings.maleFebPtAmount ?? 300;
  }

  return settings.maleMaxPtAmount ?? 200;
};

// ─── ASYNC CLOUDINARY UPLOAD HELPER ──────────────────────────────────────────

/**
 * Generates PDF and uploads to Cloudinary in background, then updates the Payroll document.
 */
export const generateAndUploadSlipBackground = async (payrollId) => {
  try {
    const payroll = await Payroll.findById(payrollId).populate('employeeId', 'joiningDate name employeeCode department position panNumber bankName accountNumber ifsc branch gender');
    if (!payroll) return;

    const pdfBuffer = await generateSalarySlipPdfBuffer(payroll);
    const folder = 'payrolls';
    const publicId = `slip_${payroll.employeeCode}_${payroll.month}_${payroll.year}_${Date.now()}`;

    const uploadRes = await uploadToCloudinary(pdfBuffer, {
      folder,
      public_id: publicId,
      resource_type: 'raw',
      format: 'pdf',
      overwrite: true,
    });

    if (uploadRes?.secure_url) {
      await Payroll.findByIdAndUpdate(payrollId, {
        salarySlipUrl: uploadRes.secure_url,
      });
    }
  } catch (err) {
    console.error(`[Cloudinary PDF Upload Error for Payroll ${payrollId}]:`, err?.message || err);
  }
};

// ─── CORE PAYROLL PROCESSOR FOR SINGLE EMPLOYEE ──────────────────────────────

export const processSingleEmployeePayroll = async ({
  employeeId,
  fromDate,
  toDate,
  targetMonth,
  targetYear,
  processedBy,
  settings: passedSettings = null,
}) => {
  const employee = await Employee.findById(employeeId);
  if (!employee) return null;

  // Load PT settings if not passed
  const settings = passedSettings || (await PayrollSettings.getSettings());

  // Total days in range is inclusive (both endpoints included)
  const totalDaysInRange = Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // Extended range for sandwich deduction analysis (10 days buffer)
  const extendedFromDate = new Date(fromDate);
  extendedFromDate.setUTCDate(extendedFromDate.getUTCDate() - 10);
  const extendedToDate = new Date(toDate);
  extendedToDate.setUTCDate(extendedToDate.getUTCDate() + 10);

  // ── FETCH ATTENDANCE, HOLIDAYS & APPROVED LEAVES ──
  const [attendanceRecords, holidayRecords, approvedLeaves] = await Promise.all([
    Attendance.find({
      employeeId,
      date: { $gte: extendedFromDate, $lte: extendedToDate },
    }),
    Holiday.find({
      date: { $gte: extendedFromDate, $lte: extendedToDate },
    }),
    Leave.find({
      employeeId,
      overallStatus: 'Approved',
      startDate: { $lte: extendedToDate },
      endDate: { $gte: extendedFromDate },
    }),
  ]);

  const summary = {
    present: 0,
    half: 0,
    absent: 0,
    holiday: 0,
    weekOff: 0,
    paidLeave: 0,
  };

  const halfDayDetails = [];
  const absentDayDetails = [];
  const presentDayDetails = [];

  const getUTCDateStr = (date) => {
    const d = new Date(date);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };

  // ── 1. SANDWICH CACHE HELPER ──
  const statusCache = {};

  const getDayStatus = (d) => {
    const dStr = getUTCDateStr(d);
    if (statusCache[dStr]) return statusCache[dStr];

    const isSunday = d.getUTCDay() === 0;
    const isHolid = holidayRecords.some((h) => getUTCDateStr(h.date) === dStr);

    if (isSunday || isHolid) {
      statusCache[dStr] = 'WO_HOLIDAY';
      return 'WO_HOLIDAY';
    }

    const record = attendanceRecords.find((r) => getUTCDateStr(r.date) === dStr);

    // Only physical work or credited comp-off breaks the sandwich
    if (record && ['P', 'Half', 'Coff'].includes(record.status)) {
      if (record.status === 'Coff') {
        statusCache[dStr] = 'PRESENT';
        return 'PRESENT';
      }
      const workedMins = record.totalMinutes || Math.round((record.totalHours || 0) * 60);
      const evalResult = evaluateWorkingMinutes(d, workedMins);

      if (evalResult.isFullDay && record.status !== 'Half') {
        statusCache[dStr] = 'PRESENT';
        return 'PRESENT';
      } else if (evalResult.isHalfDay || record.status === 'Half') {
        statusCache[dStr] = 'HALF';
        return 'HALF';
      }
    }

    statusCache[dStr] = 'LEAVE_ABSENT';
    return 'LEAVE_ABSENT';
  };

  // Pre-fill cache
  let tempDate = new Date(extendedFromDate);
  while (tempDate <= extendedToDate) {
    getDayStatus(tempDate);
    tempDate.setUTCDate(tempDate.getUTCDate() + 1);
  }

  // ── 2. SANDWICH CHECKER ──
  const isSandwiched = (d) => {
    if (getDayStatus(d) !== 'WO_HOLIDAY') return false;

    let leftStatus = null;
    let tempLeft = new Date(d);
    while (true) {
      tempLeft.setUTCDate(tempLeft.getUTCDate() - 1);
      if (tempLeft < extendedFromDate) break;
      const status = getDayStatus(tempLeft);
      if (status !== 'WO_HOLIDAY') {
        leftStatus = status;
        break;
      }
    }

    let rightStatus = null;
    let tempRight = new Date(d);
    while (true) {
      tempRight.setUTCDate(tempRight.getUTCDate() + 1);
      if (tempRight > extendedToDate) break;
      const status = getDayStatus(tempRight);
      if (status !== 'WO_HOLIDAY') {
        rightStatus = status;
        break;
      }
    }

    return leftStatus === 'LEAVE_ABSENT' && rightStatus === 'LEAVE_ABSENT';
  };

  const sandwichDetails = [];

  // ── 3. MAIN PAYROLL CALCULATION LOOP ──
  let joiningDateStr = null;
  if (employee.joiningDate) {
    joiningDateStr = getUTCDateStr(employee.joiningDate);
  }

  let current = new Date(fromDate);
  while (current <= toDate) {
    const dStr = getUTCDateStr(current);

    // Days before employee's official joining date are non-payable
    if (joiningDateStr && dStr < joiningDateStr) {
      absentDayDetails.push({ date: new Date(current), reason: 'Before Joining Date' });
      current.setUTCDate(current.getUTCDate() + 1);
      continue;
    }

    const record = attendanceRecords.find((r) => getUTCDateStr(r.date) === dStr);
    const isSunday = current.getUTCDay() === 0;
    const isHolid = holidayRecords.some((h) => getUTCDateStr(h.date) === dStr);

    if (isSunday) {
      summary.weekOff++;
      if (isSandwiched(current)) {
        sandwichDetails.push({ date: new Date(current), reason: 'Weekly Off (Sandwiched)' });
      }
    } else if (isHolid) {
      summary.holiday++;
      if (isSandwiched(current)) {
        const matchingHol = holidayRecords.find((h) => getUTCDateStr(h.date) === dStr);
        sandwichDetails.push({ date: new Date(current), reason: `Holiday (${matchingHol?.name || 'Public'}) (Sandwiched)` });
      }
    } else {
      // 1. Look for approved leave ticket
      const matchingLeave = approvedLeaves.find((leave) => {
        const leaveStart = getUTCDateStr(leave.startDate);
        const leaveEnd = getUTCDateStr(leave.endDate);
        return dStr >= leaveStart && dStr <= leaveEnd;
      });

      // 2. Physical work takes precedence over leave application
      if (record && ['P', 'Half', 'Coff'].includes(record.status)) {
        if (record.status === 'Coff') {
          summary.present++;
          presentDayDetails.push({ date: new Date(current), reason: 'Compensatory Off (Coff)' });
        } else {
          const workedMins = record.totalMinutes || Math.round((record.totalHours || 0) * 60);
          const evalResult = evaluateWorkingMinutes(current, workedMins);

          if (evalResult.isFullDay && record.status !== 'Half') {
            summary.present++;
            presentDayDetails.push({
              date: new Date(current),
              reason: `Full Present: Worked ${(record.totalHours || workedMins / 60).toFixed(2)} hrs`,
            });
          } else if (evalResult.isHalfDay || record.status === 'Half') {
            summary.half++;
            halfDayDetails.push({
              date: new Date(current),
              reason: `Half Day: Worked ${record.totalHours || (workedMins / 60).toFixed(2)} hrs (Req: ${evalResult.requiredFullMinutes} min)`,
            });
          } else {
            summary.absent++;
            absentDayDetails.push({
              date: new Date(current),
              reason: `Worked ${record.totalHours || (workedMins / 60).toFixed(2)} hrs (Below threshold)`,
            });
          }
        }
      }
      // 3. Process Approved Leave (Paid, CompOff, Casual, Sick, Earned are paid; Unpaid / Other are LWP)
      else if (matchingLeave) {
        const actualType = matchingLeave.leaveType;
        const isPaidLeaveType = ['Paid', 'CompOff', 'Casual', 'Sick', 'Earned', 'MaternityPaternity'].includes(actualType);

        if (isPaidLeaveType) {
          summary.paidLeave++;
          presentDayDetails.push({
            date: new Date(current),
            reason: `Approved Leave (${actualType}) — Paid`,
          });
        } else {
          summary.absent++;
          absentDayDetails.push({
            date: new Date(current),
            reason: `Approved Leave (${actualType}) — Unpaid (LWP)`,
          });
        }
      }
      // 4. Incomplete or unapproved absence
      else if (record) {
        summary.absent++;
        absentDayDetails.push({
          date: new Date(current),
          reason: `Status: ${record.status} (Unapproved / LWP)`,
        });
      } else {
        summary.absent++;
        absentDayDetails.push({
          date: new Date(current),
          reason: 'No Check-in / No Leave Applied',
        });
      }
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  // ── 4. FINANCIAL CALCULATIONS ──
  const sandwichDeductions = sandwichDetails.length;

  // Paid Days = Present + Half Days (0.5 each) + Week Offs + Holidays + Paid Leaves - Sandwich Deductions
  const rawPaidDays =
    summary.present +
    summary.half * 0.5 +
    summary.weekOff +
    summary.holiday +
    summary.paidLeave -
    sandwichDeductions;
  const paidDays = Math.max(0, Math.min(totalDaysInRange, rawPaidDays));

  const baseSalary = Number(employee.salary) || 0;
  const divisor = totalDaysInRange >= 28 ? totalDaysInRange : (totalDaysInRange > 0 ? totalDaysInRange : 30);
  const dailyRate = baseSalary / divisor;
  const grossEarnings = parseFloat((dailyRate * paidDays).toFixed(2));

  // Dynamic PT deduction calculation
  const professionalTax = calculatePT(baseSalary, employee.gender, toDate.getUTCMonth(), settings);
  const netSalary = Math.max(0, parseFloat((grossEarnings - professionalTax).toFixed(2)));

  // Due date: 10th of following month
  const nextMonth = targetMonth === 12 ? 1 : targetMonth + 1;
  const nextYear = targetMonth === 12 ? targetYear + 1 : targetYear;
  const paymentDueDate = new Date(Date.UTC(nextYear, nextMonth - 1, 10, 0, 0, 0));

  // ── 5. PERSIST TO DATABASE ──
  const savedPayroll = await Payroll.findOneAndUpdate(
    { employeeId, month: targetMonth, year: targetYear },
    {
      employeeCode: employee.employeeCode,
      employeeName: employee.name,
      department: employee.department,
      fromDate,
      toDate,
      paymentDueDate,
      totalDaysInMonth: totalDaysInRange,
      presentDays: summary.present,
      presentDayDetails,
      halfDays: summary.half,
      halfDayDetails,
      absentDays: summary.absent,
      absentDayDetails,
      paidLeavesTaken: summary.paidLeave,
      unpaidLeavesTaken: summary.absent + sandwichDeductions,
      holidays: summary.holiday,
      weekOffs: summary.weekOff,
      sandwichDeductions,
      sandwichDetails,
      paidDays,
      baseSalary,
      grossEarnings,
      professionalTax,
      netSalary,
      status: 'Processed',
      processedBy,
      processedAt: new Date(),
    },
    { upsert: true, new: true }
  );

  // Trigger background Cloudinary upload
  generateAndUploadSlipBackground(savedPayroll._id).catch((e) => {
    console.error(`Background upload failed for ${employee.name}:`, e.message);
  });

  return savedPayroll;
};

// ─── GENERATE PAYROLL (SINGLE) ───────────────────────────────────────────────

export const generatePayroll = asyncHandler(async (req, res) => {
  const { employeeId, month, year, startDate, endDate } = req.body;
  if (!employeeId) throw new ApiError(400, 'employeeId is required');

  const isManagement = ['SuperUser', 'HR', 'Director', 'VP', 'GM', 'Manager'].includes(req.user.role);
  if (!isManagement && req.user._id.toString() !== employeeId) {
    throw new ApiError(403, 'You are not authorized to generate payroll for other employees.');
  }

  let fromDate, toDate;
  let targetMonth, targetYear;

  if (startDate && endDate) {
    fromDate = new Date(`${startDate}T00:00:00Z`);
    toDate = new Date(`${endDate}T23:59:59Z`);
    targetMonth = toDate.getUTCMonth() + 1;
    targetYear = toDate.getUTCFullYear();
  } else if (month && year) {
    const m = Number(month);
    const y = Number(year);
    fromDate = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
    toDate = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    targetMonth = m;
    targetYear = y;
  } else {
    throw new ApiError(400, 'Either startDate/endDate or month/year is required');
  }

  const payroll = await processSingleEmployeePayroll({
    employeeId,
    fromDate,
    toDate,
    targetMonth,
    targetYear,
    processedBy: req.user._id,
  });

  if (!payroll) throw new ApiError(404, 'Employee not found');
  res.status(200).json(new ApiResponse(200, payroll, 'Payroll generated successfully'));
});

// ─── GENERATE ALL PAYROLL (BULK) ─────────────────────────────────────────────

export const generateAllPayroll = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) throw new ApiError(400, 'startDate and endDate are required');

  const fromDate = new Date(`${startDate}T00:00:00Z`);
  const toDate = new Date(`${endDate}T23:59:59Z`);
  const targetMonth = toDate.getUTCMonth() + 1;
  const targetYear = toDate.getUTCFullYear();

  // Load PT settings once for entire batch
  const settings = await PayrollSettings.getSettings();

  const employees = await Employee.find({ status: 'Active' });
  const results = [];

  for (const emp of employees) {
    try {
      const payroll = await processSingleEmployeePayroll({
        employeeId: emp._id,
        fromDate,
        toDate,
        targetMonth,
        targetYear,
        processedBy: req.user._id,
        settings,
      });
      if (payroll) results.push(payroll);
    } catch (err) {
      console.error(`Failed processing payroll for ${emp.name} (${emp.employeeCode}):`, err);
    }
  }

  res.status(200).json(
    new ApiResponse(
      200,
      { count: results.length, totalActive: employees.length },
      `Successfully processed payroll for ${results.length} active employees`
    )
  );
});

// ─── GET PAYROLL LIST ────────────────────────────────────────────────────────

export const getPayrollList = asyncHandler(async (req, res) => {
  const {
    month,
    year,
    status,
    startDate,
    endDate,
    employeeId,
    department,
    search,
    self,
    page = 1,
    limit = 1000,
  } = req.query;

  const isManagement = ['SuperUser', 'HR', 'Director', 'VP', 'GM', 'Manager'].includes(req.user.role);
  let query = {};

  // ── ROLE PERMISSIONS & SELF FILTER ──
  if (self === 'true' || !isManagement) {
    query.employeeId = req.user._id;
  } else if (employeeId) {
    query.employeeId = employeeId;
  }

  // Department filter
  if (department && department !== 'All') {
    query.department = department;
  }

  // Date Range or Month/Year Filter
  if (startDate && endDate) {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T23:59:59Z`);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      query.fromDate = { $lte: end };
      query.toDate = { $gte: start };
    }
  } else if (month && year) {
    query.month = Number(month);
    query.year = Number(year);
  }

  if (status && status !== 'All') {
    query.status = status;
  }

  if (search) {
    query.$or = [
      { employeeName: { $regex: search, $options: 'i' } },
      { employeeCode: { $regex: search, $options: 'i' } },
    ];
  }

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.max(1, parseInt(limit));
  const skip = (pageNum - 1) * limitNum;

  const [payrolls, total] = await Promise.all([
    Payroll.find(query)
      .populate('employeeId', 'name employeeCode department position joiningDate panNumber bankName accountNumber ifsc branch')
      .sort({ employeeCode: 1, fromDate: -1 })
      .skip(skip)
      .limit(limitNum),
    Payroll.countDocuments(query),
  ]);

  const totalPages = Math.ceil(total / limitNum);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        payrolls,
        pagination: { total, page: pageNum, limit: limitNum, totalPages },
      },
      'Payrolls fetched successfully'
    )
  );
});

// ─── GET SALARY SLIP PDF ─────────────────────────────────────────────────────

export const getSalarySlip = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const payroll = await Payroll.findById(id).populate(
    'employeeId',
    'joiningDate name employeeCode department position panNumber bankName accountNumber ifsc branch gender'
  );

  if (!payroll) throw new ApiError(404, 'Payroll record not found');

  const filename = `SalarySlip_${payroll.employeeCode}_${payroll.month}_${payroll.year}.pdf`;

  // 1. If stored on Cloudinary, stream directly using native fetch
  if (payroll.salarySlipUrl) {
    try {
      const response = await fetch(payroll.salarySlipUrl);
      if (response.ok && response.body) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return Readable.fromWeb(response.body).pipe(res);
      }
    } catch (cdnErr) {
      console.warn('Failed to stream PDF from Cloudinary URL, generating on-the-fly:', cdnErr.message);
    }
  }

  // 2. Generate on-the-fly fallback
  const pdfBuffer = await generateSalarySlipPdfBuffer(payroll);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdfBuffer);
});

// ─── GET & UPDATE PAYROLL SETTINGS ───────────────────────────────────────────

export const getPayrollSettings = asyncHandler(async (req, res) => {
  const settings = await PayrollSettings.getSettings();
  res.status(200).json(new ApiResponse(200, settings, 'Payroll settings fetched successfully'));
});

export const savePayrollSettings = asyncHandler(async (req, res) => {
  const {
    ptEnabled,
    femaleThreshold,
    femalePtAmount,
    femaleFebPtAmount,
    maleMinThreshold,
    maleMidThreshold,
    maleMidPtAmount,
    maleMaxPtAmount,
    maleFebPtAmount,
  } = req.body;

  let settings = await PayrollSettings.findOne();
  if (!settings) {
    settings = new PayrollSettings({});
  }

  if (ptEnabled !== undefined) settings.ptEnabled = Boolean(ptEnabled);
  if (femaleThreshold !== undefined) settings.femaleThreshold = Number(femaleThreshold);
  if (femalePtAmount !== undefined) settings.femalePtAmount = Number(femalePtAmount);
  if (femaleFebPtAmount !== undefined) settings.femaleFebPtAmount = Number(femaleFebPtAmount);
  if (maleMinThreshold !== undefined) settings.maleMinThreshold = Number(maleMinThreshold);
  if (maleMidThreshold !== undefined) settings.maleMidThreshold = Number(maleMidThreshold);
  if (maleMidPtAmount !== undefined) settings.maleMidPtAmount = Number(maleMidPtAmount);
  if (maleMaxPtAmount !== undefined) settings.maleMaxPtAmount = Number(maleMaxPtAmount);
  if (maleFebPtAmount !== undefined) settings.maleFebPtAmount = Number(maleFebPtAmount);

  settings.updatedBy = req.user._id;
  await settings.save();

  res.status(200).json(new ApiResponse(200, settings, 'Payroll settings saved successfully'));
});
