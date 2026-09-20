import { Payroll } from '../models/Payroll.model.js';
import { Attendance } from '../models/Attendance.model.js';
import { Employee } from '../models/Employee.model.js';
import { EmployeeBankDetails } from '../models/EmployeeBankDetails.model.js';
import { EmployeeDocument } from '../models/EmployeeDocument.model.js';
import { Holiday } from '../models/Holiday.model.js';
import { Leave } from '../models/Leave.model.js';
import { PayrollSettings } from '../models/PayrollSettings.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getActiveOffice } from '../services/office.service.js';
import {
  getOfficeDateStr,
  getOfficeStartOfDay,
  getOfficeEndOfDay,
  getDayOfWeekInOffice,
  DEFAULT_TIMEZONE,
} from '../utils/dateHelper.js';
import { generateSalarySlipPdfBuffer } from '../utils/pdfHelper.js';
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
  if (!settings || !settings.ptEnabled) {
    return 0;
  }

  const normalizedGender = (gender || '').toLowerCase();
  const isFebruary = monthIndex === 1;

  // FEMALE
  if (normalizedGender === 'female') {
    if (baseSalary <= (settings.femaleThreshold ?? 25000)) {
      return 0;
    }
    if (isFebruary) {
      return settings.femaleFebPtAmount ?? 300;
    }
    return settings.femalePtAmount ?? 200;
  }

  // MALE / OTHER
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

export const generateAndUploadSlipBackground = async (payrollId) => {
  try {
    const payroll = await Payroll.findById(payrollId).populate(
      'employeeId',
      'joiningDate name employeeCode department position panNumber bankName accountNumber ifsc branch gender'
    );
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

// ─── CORE PRODUCTION PAYROLL PROCESSOR ───────────────────────────────────────

export const processSingleEmployeePayroll = async ({
  employeeId,
  targetMonth,
  targetYear,
  processedBy,
  settings: passedSettings = null,
}) => {
  const employee = await Employee.findById(employeeId);
  if (!employee) return null;

  const { office, workingHours } = await getActiveOffice();
  const timezone = office?.timezone || DEFAULT_TIMEZONE;
  const settings = passedSettings || (await PayrollSettings.getSettings());

  // Determine normalized month bounds (1st to last day of target month)
  const fromDate = getOfficeStartOfDay(new Date(targetYear, targetMonth - 1, 1), timezone);
  const toDate = getOfficeEndOfDay(new Date(targetYear, targetMonth, 0), timezone);

  // Total calendar days in this month
  const totalDaysInMonth = new Date(targetYear, targetMonth, 0).getDate();

  // Buffer range (+/- 7 days) for accurate sandwich rule evaluation
  const extendedStart = new Date(fromDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const extendedEnd = new Date(toDate.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Fetch verified Attendance, Holidays, and approved Leaves
  const [attendanceRecords, holidayRecords, approvedLeaves] = await Promise.all([
    Attendance.find({
      $or: [{ employeeId }, { employeeCode: employee.employeeCode }],
      date: { $gte: extendedStart, $lte: extendedEnd },
    }).lean(),
    Holiday.find({
      date: { $gte: extendedStart, $lte: extendedEnd },
    }).lean(),
    Leave.find({
      employeeId,
      overallStatus: 'Approved',
      startDate: { $lte: extendedEnd },
      endDate: { $gte: extendedStart },
    }).lean(),
  ]);

  const attMap = new Map();
  attendanceRecords.forEach((r) => {
    const k = getOfficeDateStr(r.date, timezone);
    attMap.set(k, r);
  });

  const holidayMap = new Map();
  holidayRecords.forEach((h) => {
    const k = getOfficeDateStr(h.date, timezone);
    holidayMap.set(k, h);
  });

  // Helper to determine status for any date in range
  const getDayCategory = (d) => {
    const dStr = getOfficeDateStr(d, timezone);
    const att = attMap.get(dStr);

    if (att) {
      if (att.status === 'P' || att.status === 'Coff') return 'PRESENT';
      if (att.status === 'Half') return 'HALF';
      if (att.status === 'A') return 'ABSENT';
      if (att.status === 'L') return 'LEAVE';
    }

    const isOnLeave = approvedLeaves.some((l) => {
      const lStart = getOfficeDateStr(l.startDate, timezone);
      const lEnd = getOfficeDateStr(l.endDate, timezone);
      return dStr >= lStart && dStr <= lEnd;
    });
    if (isOnLeave) return 'LEAVE';

    if (holidayMap.has(dStr)) return 'HOLIDAY';

    const dow = getDayOfWeekInOffice(d, timezone);
    const isWeekOff = workingHours?.workDays ? !workingHours.workDays.includes(dow) : dow === 0;
    if (isWeekOff) return 'WEEKOFF';

    return 'ABSENT';
  };

  // Sandwich check helper for week-off / holiday
  const isSandwichedDate = (date) => {
    const cat = getDayCategory(date);
    if (cat !== 'WEEKOFF' && cat !== 'HOLIDAY') return false;

    // Check left non-off day
    let leftCat = null;
    let curLeft = new Date(date.getTime() - 24 * 60 * 60 * 1000);
    while (curLeft >= extendedStart) {
      const c = getDayCategory(curLeft);
      if (c !== 'WEEKOFF' && c !== 'HOLIDAY') {
        leftCat = c;
        break;
      }
      curLeft = new Date(curLeft.getTime() - 24 * 60 * 60 * 1000);
    }

    // Check right non-off day
    let rightCat = null;
    let curRight = new Date(date.getTime() + 24 * 60 * 60 * 1000);
    while (curRight <= extendedEnd) {
      const c = getDayCategory(curRight);
      if (c !== 'WEEKOFF' && c !== 'HOLIDAY') {
        rightCat = c;
        break;
      }
      curRight = new Date(curRight.getTime() + 24 * 60 * 60 * 1000);
    }

    // Sandwiched if surrounded by absences/unpaid leave on both sides
    return leftCat === 'ABSENT' && rightCat === 'ABSENT';
  };

  // Detailed accumulation
  let presentDays = 0;
  let halfDays = 0;
  let absentDays = 0;
  let paidLeavesTaken = 0;
  let unpaidLeavesTaken = 0;
  let holidays = 0;
  let weekOffs = 0;
  let sandwichDeductions = 0;
  let workingDays = 0;

  const presentDayDetails = [];
  const halfDayDetails = [];
  const absentDayDetails = [];
  const paidLeaveDayDetails = [];
  const sandwichDetails = [];

  const joiningDateStr = employee.joiningDate ? getOfficeDateStr(employee.joiningDate, timezone) : null;

  for (let day = 1; day <= totalDaysInMonth; day++) {
    const curDate = new Date(targetYear, targetMonth - 1, day);
    const dateStr = getOfficeDateStr(curDate, timezone);
    const dow = getDayOfWeekInOffice(curDate, timezone);
    const isRegularWorkDay = workingHours?.workDays ? workingHours.workDays.includes(dow) : dow !== 0;

    if (isRegularWorkDay && !holidayMap.has(dateStr)) {
      workingDays++;
    }

    // If day is before employee's joining date, treat as unpaid absent without sandwich penalty
    if (joiningDateStr && dateStr < joiningDateStr) {
      absentDays++;
      absentDayDetails.push({ date: curDate, reason: 'Before Joining Date' });
      continue;
    }

    const att = attMap.get(dateStr);
    const holiday = holidayMap.get(dateStr);
    const isWeekOff = !isRegularWorkDay;

    if (att) {
      if (att.status === 'P' || att.status === 'Coff') {
        presentDays++;
        presentDayDetails.push({ date: curDate, workMode: att.workMode || 'Office' });
      } else if (att.status === 'Half') {
        halfDays++;
        halfDayDetails.push({ date: curDate, reason: 'Half Day Shift' });
      } else if (att.status === 'A') {
        absentDays++;
        absentDayDetails.push({ date: curDate, reason: 'Marked Absent' });
      } else if (att.status === 'L') {
        paidLeavesTaken++;
        paidLeaveDayDetails.push({ date: curDate, leaveId: null });
      } else {
        presentDays++;
        presentDayDetails.push({ date: curDate, workMode: att.workMode || 'Office' });
      }
    } else {
      // Check leave
      const leaveObj = approvedLeaves.find((l) => {
        const lStart = getOfficeDateStr(l.startDate, timezone);
        const lEnd = getOfficeDateStr(l.endDate, timezone);
        return dateStr >= lStart && dateStr <= lEnd;
      });

      if (leaveObj) {
        if (leaveObj.leaveType === 'Unpaid') {
          unpaidLeavesTaken++;
          absentDayDetails.push({ date: curDate, reason: 'Unpaid Leave' });
        } else {
          paidLeavesTaken++;
          paidLeaveDayDetails.push({ date: curDate, leaveId: leaveObj._id });
        }
      } else if (holiday) {
        holidays++;
        if (isSandwichedDate(curDate)) {
          sandwichDeductions++;
          sandwichDetails.push({ date: curDate, reason: `Sandwiched Holiday: ${holiday.name}` });
        }
      } else if (isWeekOff) {
        weekOffs++;
        if (isSandwichedDate(curDate)) {
          sandwichDeductions++;
          sandwichDetails.push({ date: curDate, reason: 'Sandwiched Weekly Off' });
        }
      } else {
        absentDays++;
        absentDayDetails.push({ date: curDate, reason: 'Unrecorded Absence' });
      }
    }
  }

  // ── PAYABLE DAYS ──
  const effectivePresent = presentDays + halfDays * 0.5;
  const netWeekOffs = Math.max(0, weekOffs - sandwichDeductions);
  const rawPaidDays = effectivePresent + paidLeavesTaken + holidays + netWeekOffs;
  const paidDays = Math.max(0, Math.min(totalDaysInMonth, parseFloat(rawPaidDays.toFixed(2))));

  // ── SALARY CALCULATIONS ──
  const baseSalary = employee.salary || 0;
  const grossEarnings = totalDaysInMonth > 0
    ? Math.round((baseSalary / totalDaysInMonth) * paidDays * 100) / 100
    : 0;

  const monthIndex = targetMonth - 1; // 0-based
  const professionalTax = calculatePT(baseSalary, employee.gender, monthIndex, settings);
  const otherDeductions = 0;
  const netSalary = Math.max(0, Math.round(grossEarnings - professionalTax - otherDeductions));

  // Payment due date: 10th of following month
  const nextMonth = targetMonth === 12 ? 1 : targetMonth + 1;
  const nextYear = targetMonth === 12 ? targetYear + 1 : targetYear;
  const paymentDueDate = new Date(nextYear, nextMonth - 1, 10);

  const payroll = await Payroll.findOneAndUpdate(
    { employeeId: employee._id, month: targetMonth, year: targetYear },
    {
      employeeCode: employee.employeeCode,
      employeeName: employee.name,
      department: employee.department || '',
      month: targetMonth,
      year: targetYear,
      fromDate,
      toDate,
      paymentDueDate,
      totalDaysInMonth,
      workingDays,
      presentDays,
      halfDays,
      absentDays,
      paidLeavesTaken,
      unpaidLeavesTaken,
      holidays,
      weekOffs,
      sandwichDeductions,
      presentDayDetails,
      halfDayDetails,
      absentDayDetails,
      paidLeaveDayDetails,
      sandwichDetails,
      paidDays,
      baseSalary,
      grossEarnings,
      professionalTax,
      otherDeductions,
      netSalary,
      status: 'Processed',
      processedBy,
      processedAt: new Date(),
    },
    { upsert: true, new: true }
  );

  // Trigger background Cloudinary PDF upload
  generateAndUploadSlipBackground(payroll._id).catch((err) => {
    console.warn(`[Background Slip Upload] Failed for ${employee.name}:`, err.message);
  });

  return payroll;
};

// ─── GENERATE PAYROLL (SINGLE) ───────────────────────────────────────────────

export const generatePayroll = asyncHandler(async (req, res) => {
  const { employeeId, month, year, startDate, endDate } = req.body;
  if (!employeeId) throw new ApiError(400, 'employeeId is required');

  const isManagement = ['SuperUser', 'HR', 'Director', 'VP', 'GM', 'Manager'].includes(req.user.role);
  if (!isManagement && req.user._id.toString() !== employeeId) {
    throw new ApiError(403, 'You are not authorized to generate payroll for other employees');
  }

  let targetMonth, targetYear;
  if (month && year) {
    targetMonth = Number(month);
    targetYear = Number(year);
  } else if (startDate && endDate) {
    const end = new Date(endDate);
    targetMonth = end.getMonth() + 1;
    targetYear = end.getFullYear();
  } else {
    const now = new Date();
    targetMonth = now.getMonth() + 1;
    targetYear = now.getFullYear();
  }

  const payroll = await processSingleEmployeePayroll({
    employeeId,
    targetMonth,
    targetYear,
    processedBy: req.user._id,
  });

  if (!payroll) throw new ApiError(404, 'Employee not found');
  res.status(200).json(new ApiResponse(200, payroll, 'Payroll generated successfully'));
});

// ─── GENERATE ALL PAYROLL (BULK) ─────────────────────────────────────────────

export const generateAllPayroll = asyncHandler(async (req, res) => {
  const { month, year, startDate, endDate } = req.body;

  let targetMonth, targetYear;
  if (month && year) {
    targetMonth = Number(month);
    targetYear = Number(year);
  } else if (startDate && endDate) {
    const end = new Date(endDate);
    targetMonth = end.getMonth() + 1;
    targetYear = end.getFullYear();
  } else {
    const now = new Date();
    targetMonth = now.getMonth() + 1;
    targetYear = now.getFullYear();
  }

  const settings = await PayrollSettings.getSettings();
  const employees = await Employee.find({ status: 'Active' });
  const results = [];

  for (const emp of employees) {
    try {
      const payroll = await processSingleEmployeePayroll({
        employeeId: emp._id,
        targetMonth,
        targetYear,
        processedBy: req.user._id,
        settings,
      });
      if (payroll) results.push(payroll);
    } catch (err) {
      console.error(`Failed generating payroll for ${emp.name} (${emp.employeeCode}):`, err);
    }
  }

  res.status(200).json(
    new ApiResponse(
      200,
      { count: results.length, totalActive: employees.length },
      `Processed payroll for ${results.length} active employees`
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
  const query = {};

  if (self === 'true' || !isManagement) {
    query.employeeId = req.user._id;
  } else if (employeeId) {
    query.employeeId = employeeId;
  }

  if (department && department !== 'All') {
    query.department = department;
  }

  if (month && year) {
    query.month = Number(month);
    query.year = Number(year);
  } else if (year) {
    query.year = Number(year);
  } else if (startDate && endDate) {
    const { office } = await getActiveOffice();
    const timezone = office?.timezone || DEFAULT_TIMEZONE;
    const start = getOfficeStartOfDay(new Date(startDate), timezone);
    const end = getOfficeEndOfDay(new Date(endDate), timezone);
    query.fromDate = { $lte: end };
    query.toDate = { $gte: start };
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

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 1000);
  const skip = (pageNum - 1) * limitNum;

  const [payrolls, total] = await Promise.all([
    Payroll.find(query)
      .populate('employeeId', 'name employeeCode department position joiningDate panNumber bankName accountNumber ifsc branch')
      .sort({ year: -1, month: -1, employeeCode: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Payroll.countDocuments(query),
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        payrolls,
        pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
      },
      'Payrolls fetched successfully'
    )
  );
});

// ─── UPDATE PAYROLL STATUS ───────────────────────────────────────────────────

export const updatePayrollStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, paymentDate, remarks } = req.body;

  if (!['Draft', 'Processed', 'Paid'].includes(status)) {
    throw new ApiError(400, "Invalid status. Must be 'Draft', 'Processed', or 'Paid'");
  }

  const payroll = await Payroll.findById(id);
  if (!payroll) throw new ApiError(404, 'Payroll record not found');

  payroll.status = status;
  if (paymentDate) payroll.paymentDate = new Date(paymentDate);
  if (status === 'Paid' && !payroll.paymentDate) payroll.paymentDate = new Date();
  if (remarks !== undefined) payroll.remarks = remarks;

  await payroll.save();

  res.status(200).json(new ApiResponse(200, payroll, `Payroll status updated to ${status}`));
});

// ─── GET PAYROLL BY ID (ENRICHED DETAILS) ───────────────────────────────────

export const getPayrollById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const payroll = await Payroll.findById(id).populate(
    'employeeId',
    'joiningDate name employeeCode department position panNumber bankName accountNumber ifsc branch gender profileImageUrl'
  );

  if (!payroll) throw new ApiError(404, 'Payroll record not found');

  // Verify access: employees can only view their own
  const isEmployee = req.user.role === 'Employee' || req.user.role === 'Intern';
  if (isEmployee) {
    const payEmpId = payroll.employeeId?._id ? payroll.employeeId._id.toString() : payroll.employeeId.toString();
    if (payEmpId !== req.user._id.toString() && payroll.employeeCode !== req.user.employeeCode) {
      throw new ApiError(403, 'Unauthorized: You can only access your own payroll details');
    }
  }

  const empId = payroll.employeeId?._id || payroll.employeeId;
  const [bankDetails, docDetails] = await Promise.all([
    EmployeeBankDetails.findOne({ employeeId: empId }).lean(),
    EmployeeDocument.findOne({ employeeId: empId }).lean(),
  ]);

  const payrollObj = payroll.toObject();
  if (payrollObj.employeeId && typeof payrollObj.employeeId === 'object') {
    payrollObj.employeeId.bankName = bankDetails?.bankName || payrollObj.employeeId.bankName || 'N/A';
    payrollObj.employeeId.accountNumber = bankDetails?.accountNumber || payrollObj.employeeId.accountNumber || 'N/A';
    payrollObj.employeeId.ifsc = bankDetails?.ifsc || payrollObj.employeeId.ifsc || 'N/A';
    payrollObj.employeeId.branch = bankDetails?.branch || payrollObj.employeeId.branch || 'N/A';
    payrollObj.employeeId.panNumber = docDetails?.panNumber || payrollObj.employeeId.panNumber || 'N/A';
  }

  res.status(200).json(new ApiResponse(200, payrollObj, 'Payroll details fetched successfully'));
});

// ─── GET SALARY SLIP PDF ─────────────────────────────────────────────────────

export const getSalarySlip = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const payroll = await Payroll.findById(id).populate(
    'employeeId',
    'joiningDate name employeeCode department position panNumber bankName accountNumber ifsc branch gender'
  );

  if (!payroll) throw new ApiError(404, 'Payroll record not found');

  const isEmployee = req.user.role === 'Employee' || req.user.role === 'Intern';
  if (isEmployee) {
    const payEmpId = payroll.employeeId?._id ? payroll.employeeId._id.toString() : payroll.employeeId.toString();
    if (payEmpId !== req.user._id.toString() && payroll.employeeCode !== req.user.employeeCode) {
      throw new ApiError(403, 'Unauthorized: You can only access your own salary slip');
    }
  }

  const empId = payroll.employeeId?._id || payroll.employeeId;
  const [bankDetails, docDetails] = await Promise.all([
    EmployeeBankDetails.findOne({ employeeId: empId }).lean(),
    EmployeeDocument.findOne({ employeeId: empId }).lean(),
  ]);

  const empObj = payroll.employeeId?.toObject ? payroll.employeeId.toObject() : (payroll.employeeId || {});
  empObj.bankName = bankDetails?.bankName || empObj.bankName || 'N/A';
  empObj.accountNumber = bankDetails?.accountNumber || empObj.accountNumber || 'N/A';
  empObj.ifsc = bankDetails?.ifsc || empObj.ifsc || 'N/A';
  empObj.branch = bankDetails?.branch || empObj.branch || 'N/A';
  empObj.panNumber = docDetails?.panNumber || empObj.panNumber || 'N/A';

  const enrichedPayroll = {
    ...payroll.toObject(),
    employeeId: empObj,
  };

  const filename = `SalarySlip_${payroll.employeeCode}_${payroll.month}_${payroll.year}.pdf`;

  // 1. If stored on Cloudinary, stream directly
  if (payroll.salarySlipUrl) {
    try {
      const response = await fetch(payroll.salarySlipUrl);
      if (response.ok && response.body) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return Readable.fromWeb(response.body).pipe(res);
      }
    } catch (cdnErr) {
      console.warn('Cloudinary streaming failed, fallback to on-the-fly PDF:', cdnErr.message);
    }
  }

  // 2. Generate on-the-fly fallback with enriched details
  const pdfBuffer = await generateSalarySlipPdfBuffer(enrichedPayroll);
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
