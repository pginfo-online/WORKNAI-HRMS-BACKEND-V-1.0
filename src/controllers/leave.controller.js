import { Leave } from '../models/Leave.model.js';
import { Employee } from '../models/Employee.model.js';
import { LeaveBalance } from '../models/LeaveBalance.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { Attendance } from '../models/Attendance.model.js';
import { Payroll } from '../models/Payroll.model.js';
import { Holiday } from '../models/Holiday.model.js';
import mongoose from 'mongoose';
import { processSingleEmployeePayroll } from './payroll.controller.js';

// ── ROLE CONSTANTS ──
const APPROVER_ROLES = ['SuperUser', 'HR', 'GM', 'VP', 'Director', 'Manager'];
const ADMIN_ROLES = ['SuperUser', 'HR', 'Director'];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function buildInitialApprovalState(applicantRole) {
  const base = {
    managerStatus: '-',
    hrStatus: 'Pending',
    gmStatus: '-',
    vpStatus: '-',
    directorStatus: '-',
    overallStatus: 'Pending',
    currentApproverRole: 'HR',
  };

  switch (applicantRole) {
    case 'Director':
    case 'SuperUser':
      return {
        ...base,
        hrStatus: '-',
        overallStatus: 'Approved',
        currentApproverRole: 'Completed',
      };
    default:
      return base;
  }
}

/**
 * Calculate total days between two dates, excluding Sundays and Holidays.
 */
async function calcActualLeaveDays(start, end, halfDay) {
  let current = new Date(start);
  current.setHours(0, 0, 0, 0);
  const finish = new Date(end);
  finish.setHours(0, 0, 0, 0);

  // Fetch all holidays in range at once
  const holidays = await Holiday.find({
    date: { $gte: current, $lte: finish }
  });
  const holidayDates = new Set(holidays.map(h => h.date.toDateString()));

  if (halfDay) {
    const dayOfWeek = current.getDay();
    const isSunday = dayOfWeek === 0;
    const isHoliday = holidayDates.has(current.toDateString());
    if (isSunday || isHoliday) return 0;
    return 0.5;
  }

  let count = 0;
  while (current <= finish) {
    const dayOfWeek = current.getDay();
    const isSunday = dayOfWeek === 0;
    const isHoliday = holidayDates.has(current.toDateString());

    if (!isSunday && !isHoliday) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/**
 * Synchronize an approved leave request with the Attendance and Payroll modules.
 * Creates or updates Attendance records for all days covered by the leave,
 * and triggers recalculation/generation of any overlapping Payroll records.
 */
async function syncApprovedLeaveToAttendanceAndPayroll(leave, session = null) {
  try {
    const empId = leave.employeeId._id || leave.employeeId;
    const employee = await Employee.findById(empId);
    if (!employee) {
      console.error(`syncApprovedLeaveToAttendanceAndPayroll: Employee not found for ID: ${empId}`);
      return;
    }

    let current = new Date(leave.startDate);
    const end = new Date(leave.endDate);

    const startOfUTCDate = (date) => {
      const d = new Date(date);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    };

    while (current <= end) {
      const targetDate = startOfUTCDate(current);

      // Find if there is an existing attendance record for the employee on this date
      const existing = await Attendance.findOne({
        employeeCode: employee.employeeCode,
        date: targetDate
      }).session(session);

      const status = leave.leaveType === 'CompOff' ? 'Coff' : 'L';

      if (existing) {
        existing.status = status;
        existing.inTime = undefined;
        existing.outTime = undefined;
        existing.totalHours = 0;
        existing.totalMinutes = 0;
        await existing.save({ session });
      } else {
        await Attendance.create([{
          employeeId: employee._id,
          employeeCode: employee.employeeCode,
          employeeName: employee.name,
          date: targetDate,
          status: status,
          totalHours: 0,
          totalMinutes: 0
        }], { session });
      }

      current.setUTCDate(current.getUTCDate() + 1);
    }

    // Now, fetch all existing payroll records for this employee that overlap the leave period
    const overlappingPayrolls = await Payroll.find({
      employeeId: employee._id,
      fromDate: { $lte: leave.endDate },
      toDate: { $gte: leave.startDate }
    }).session(session);

    for (const pr of overlappingPayrolls) {
      await processSingleEmployeePayroll({
        employeeId: pr.employeeId,
        fromDate: pr.fromDate,
        toDate: pr.toDate,
        targetMonth: pr.month,
        targetYear: pr.year,
        processedBy: empId
      });
    }
  } catch (err) {
    console.error('Error in syncApprovedLeaveToAttendanceAndPayroll:', err);
    throw err;
  }
}

/**
 * Revert Attendance and Payroll records for a cancelled leave that was previously Approved.
 */
async function revertApprovedLeaveFromAttendanceAndPayroll(leave, session = null) {
  try {
    const empId = leave.employeeId._id || leave.employeeId;
    const employee = await Employee.findById(empId);
    if (!employee) return;

    let current = new Date(leave.startDate);
    const end = new Date(leave.endDate);

    const startOfUTCDate = (date) => {
      const d = new Date(date);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    };

    while (current <= end) {
      const targetDate = startOfUTCDate(current);

      const existing = await Attendance.findOne({
        employeeCode: employee.employeeCode,
        date: targetDate,
      }).session(session);

      if (existing) {
        // If the attendance record was auto-created for the leave (no check-in / check-out times)
        if (!existing.inTime && !existing.outTime && (existing.status === 'L' || existing.status === 'Coff')) {
          await Attendance.deleteOne({ _id: existing._id }).session(session);
        } else if (existing.status === 'L' || existing.status === 'Coff') {
          // If there were actual check-in times recorded, revert status back to Present
          existing.status = 'P';
          await existing.save({ session });
        }
      }

      current.setUTCDate(current.getUTCDate() + 1);
    }

    // Recalculate overlapping payroll records
    const overlappingPayrolls = await Payroll.find({
      employeeId: employee._id,
      fromDate: { $lte: leave.endDate },
      toDate: { $gte: leave.startDate },
    }).session(session);

    for (const pr of overlappingPayrolls) {
      await processSingleEmployeePayroll({
        employeeId: pr.employeeId,
        fromDate: pr.fromDate,
        toDate: pr.toDate,
        targetMonth: pr.month,
        targetYear: pr.year,
        processedBy: empId,
      });
    }
  } catch (err) {
    console.error('Error in revertApprovedLeaveFromAttendanceAndPayroll:', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// APPLY FOR LEAVE
// ─────────────────────────────────────────────────────────────────────────────
export const applyLeave = asyncHandler(async (req, res) => {
  const { leaveType, startDate, endDate, reason, halfDay = false, halfDayPeriod = '' } = req.body;

  if (!leaveType || !startDate || !reason) {
    throw new ApiError(400, 'leaveType, startDate, and reason are required');
  }

  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : start;

  if (end < start) throw new ApiError(400, 'endDate cannot be before startDate');

  const totalDays = await calcActualLeaveDays(start, end, halfDay);
  if (totalDays === 0) throw new ApiError(400, 'Selected date range consists only of Sundays or Holidays');

  // ── BALANCE VALIDATION & DEDUCTION ──
  let leaveBalance = await LeaveBalance.findOne({ employeeId: req.user._id });
  if (!leaveBalance) leaveBalance = new LeaveBalance({ employeeId: req.user._id });

  const isPaidLeave = ['Paid', 'Casual', 'Sick', 'Earned'].includes(leaveType);
  const isCompOffLeave = leaveType === 'CompOff';

  if (isPaidLeave) {
    if ((leaveBalance.paidLeaveBalance || 0) < totalDays) {
      throw new ApiError(400, `Insufficient Paid Leave balance. Available: ${leaveBalance.paidLeaveBalance || 0}`);
    }
  } else if (isCompOffLeave) {
    if ((leaveBalance.compOffBalance || 0) < totalDays) {
      throw new ApiError(400, `Insufficient Comp-Off balance. Available: ${leaveBalance.compOffBalance || 0}`);
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const approvalState = buildInitialApprovalState(req.user.role);

    // 1. Create Leave Record
    const leave = await Leave.create([{
      employeeId: req.user._id,
      leaveType,
      startDate: start,
      endDate: end,
      totalDays,
      halfDay,
      halfDayPeriod: halfDay ? halfDayPeriod : '',
      reason,
      ...approvalState,
      actionHistory: [{
        action: 'Applied',
        byEmployeeId: req.user._id,
        byName: req.user.name,
        byRole: req.user.role,
        remarks: reason,
        timestamp: new Date(),
      }],
    }], { session });

    // 2. Deduct Balance Immediately (Tentative)
    if (isPaidLeave || isCompOffLeave) {
      const balanceField = isPaidLeave ? 'paidLeaveBalance' : 'compOffBalance';
      const prevBalance = leaveBalance[balanceField] || 0;
      const newBalance = prevBalance - totalDays;
      if (newBalance < 0) throw new ApiError(400, 'Insufficient balance');

      leaveBalance[balanceField] = newBalance;
      const historyLeaveType = isCompOffLeave ? 'CompOff' : 'Paid';
      leaveBalance.history.push({
        type: 'Deduction',
        leaveType: historyLeaveType,
        amount: totalDays,
        previousBalance: prevBalance,
        newBalance,
        remarks: `Leave applied: ${start.toDateString()} to ${end.toDateString()} (Pending approval)`,
        updatedBy: req.user._id,
      });
      await leaveBalance.save({ session });
    }

    await session.commitTransaction();

    const populated = await Leave.findById(leave[0]._id).populate('employeeId', 'name employeeCode department role');
    
    if (populated.overallStatus === 'Approved') {
      await syncApprovedLeaveToAttendanceAndPayroll(populated);
    }

    res.status(201).json(new ApiResponse(201, populated, 'Leave applied successfully. Balance deducted.'));
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET MY LEAVES
// ─────────────────────────────────────────────────────────────────────────────
export const getMyLeaves = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, year } = req.query;
  const query = { employeeId: req.user._id };

  if (status && status !== 'All') query.overallStatus = status;
  if (year) {
    query.startDate = {
      $gte: new Date(`${year}-01-01`),
      $lte: new Date(`${year}-12-31`),
    };
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [leaves, total] = await Promise.all([
    Leave.find(query)
      .populate('employeeId', 'name employeeCode department role profileImageUrl')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Leave.countDocuments(query),
  ]);

  // Summary counts
  const [totalCount, approvedCount, pendingCount, rejectedCount, cancelledCount] = await Promise.all([
    Leave.countDocuments({ employeeId: req.user._id }),
    Leave.countDocuments({ employeeId: req.user._id, overallStatus: 'Approved' }),
    Leave.countDocuments({ employeeId: req.user._id, overallStatus: 'Pending' }),
    Leave.countDocuments({ employeeId: req.user._id, overallStatus: 'Rejected' }),
    Leave.countDocuments({ employeeId: req.user._id, overallStatus: 'Cancelled' }),
  ]);

  res.json(
    new ApiResponse(
      200,
      {
        leaves,
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
        summary: { total: totalCount, approved: approvedCount, pending: pendingCount, rejected: rejectedCount, cancelled: cancelledCount },
      },
      'My leaves fetched'
    )
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET PENDING LEAVES (for approvers)
// ─────────────────────────────────────────────────────────────────────────────
export const getPendingLeaves = asyncHandler(async (req, res) => {
  const role = req.user.role;

  let query = {};
  if (['HR', 'SuperUser', 'Director'].includes(role)) {
    query = { hrStatus: 'Pending', overallStatus: 'Pending' };
  } else {
    throw new ApiError(403, 'You do not have approval permissions');
  }

  if (req.query.page || req.query.limit) {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [leaves, total] = await Promise.all([
      Leave.find(query)
        .populate('employeeId', 'name employeeCode department role profileImageUrl')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Leave.countDocuments(query),
    ]);

    return res.json(
      new ApiResponse(
        200,
        {
          leaves,
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)),
        },
        'Pending leaves fetched'
      )
    );
  }

  const leaves = await Leave.find(query)
    .populate('employeeId', 'name employeeCode department role profileImageUrl')
    .sort({ createdAt: -1 });

  res.json(new ApiResponse(200, leaves, 'Pending leaves fetched'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL LEAVES (admin/HR view)
// ─────────────────────────────────────────────────────────────────────────────
export const getAllLeaves = asyncHandler(async (req, res) => {
  const { page = 1, limit = 30, status, leaveType, department, employeeId, year, month } = req.query;
  const query = {};

  if (status && status !== 'All') query.overallStatus = status;
  if (leaveType) query.leaveType = leaveType;
  if (employeeId) query.employeeId = employeeId;

  if (year || month) {
    const y = year ? parseInt(year) : new Date().getFullYear();
    const m = month ? parseInt(month) : null;
    if (m) {
      query.startDate = {
        $gte: new Date(y, m - 1, 1),
        $lte: new Date(y, m, 0),
      };
    } else {
      query.startDate = {
        $gte: new Date(`${y}-01-01`),
        $lte: new Date(`${y}-12-31`),
      };
    }
  }

  const skip = (Number(page) - 1) * Number(limit);
  let leavesQuery = Leave.find(query)
    .populate('employeeId', 'name employeeCode department role profileImageUrl')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  // Filter by department (requires post-population filter)
  let leaves = await leavesQuery;
  if (department) {
    leaves = leaves.filter((l) => l.employeeId?.department === department);
  }

  const total = await Leave.countDocuments(query);

  res.json(
    new ApiResponse(
      200,
      {
        leaves,
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
      'All leaves fetched'
    )
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET LEAVE BY ID
// ─────────────────────────────────────────────────────────────────────────────
export const getLeaveById = asyncHandler(async (req, res) => {
  const leave = await Leave.findById(req.params.id).populate(
    'employeeId',
    'name employeeCode department role profileImageUrl'
  );
  if (!leave) throw new ApiError(404, 'Leave not found');

  // Owner or approver can view
  const isOwner = leave.employeeId._id.toString() === req.user._id.toString();
  const isApprover = APPROVER_ROLES.includes(req.user.role);
  if (!isOwner && !isApprover) throw new ApiError(403, 'Access denied');

  res.json(new ApiResponse(200, leave, 'Leave fetched'));
});

// ─────────────────────────────────────────────────────────────────────────────
// APPROVE LEAVE
// ─────────────────────────────────────────────────────────────────────────────
export const approveLeave = asyncHandler(async (req, res) => {
  const { remarks = '' } = req.body;
  const leave = await Leave.findById(req.params.id).populate('employeeId', 'name role');
  if (!leave) throw new ApiError(404, 'Leave not found');
  if (leave.overallStatus !== 'Pending') throw new ApiError(400, `Leave is already ${leave.overallStatus}`);

  const approverRole = req.user.role;

  if (['HR', 'SuperUser', 'Director'].includes(approverRole)) {
    if (leave.hrStatus !== 'Pending') throw new ApiError(400, 'Leave is not pending HR approval');
    leave.hrStatus = 'Approved';
    leave.hrRemarks = remarks;
  } else {
    throw new ApiError(403, 'You do not have approval permissions');
  }

  leave.overallStatus = 'Approved';
  leave.currentApproverRole = 'Completed';

  // ── BALANCE ALREADY DEDUCTED DURING APPLICATION ──
  // If Comp-Off, mark history entries in LeaveBalance as used (FIFO)
  if (leave.leaveType === 'CompOff') {
    const balanceDoc = await LeaveBalance.findOne({ employeeId: leave.employeeId });
    if (balanceDoc && balanceDoc.history) {
      let daysToMark = leave.totalDays;
      for (let i = 0; i < balanceDoc.history.length; i++) {
        const entry = balanceDoc.history[i];
        if (entry.leaveType === 'CompOff' && (entry.type === 'CompOffCredit' || entry.type === 'Addition') && !entry.isUsed) {
          entry.isUsed = true;
          entry.usedDate = new Date();
          daysToMark -= entry.amount;
          if (daysToMark <= 0) break;
        }
      }
      await balanceDoc.save();
    }
  }

  leave.actionHistory.push({
    action: 'Approved',
    byEmployeeId: req.user._id,
    byName: req.user.name,
    byRole: req.user.role,
    remarks,
    timestamp: new Date(),
  });

  await leave.save();

  const updated = await Leave.findById(leave._id).populate('employeeId', 'name employeeCode department role');

  if (updated.overallStatus === 'Approved') {
    await syncApprovedLeaveToAttendanceAndPayroll(updated);
  }

  res.json(new ApiResponse(200, updated, 'Leave approved successfully'));
});

// ─────────────────────────────────────────────────────────────────────────────
// REJECT LEAVE
// ─────────────────────────────────────────────────────────────────────────────
export const rejectLeave = asyncHandler(async (req, res) => {
  const { remarks = '' } = req.body;
  const leave = await Leave.findById(req.params.id).populate('employeeId', 'name role');
  if (!leave) throw new ApiError(404, 'Leave not found');
  if (leave.overallStatus !== 'Pending') throw new ApiError(400, `Leave is already ${leave.overallStatus}`);

  const approverRole = req.user.role;
  if (!['HR', 'SuperUser', 'Director'].includes(approverRole)) throw new ApiError(403, 'You do not have rejection permissions');

  leave.hrStatus = 'Rejected';
  leave.hrRemarks = remarks;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    leave.overallStatus = 'Rejected';
    leave.currentApproverRole = 'Completed';

    leave.actionHistory.push({
      action: 'Rejected',
      byEmployeeId: req.user._id,
      byName: req.user.name,
      byRole: req.user.role,
      remarks,
      timestamp: new Date(),
    });

    // ── REFUND BALANCE ──
    const isPaidLeaveRefund = ['Paid', 'Casual', 'Sick', 'Earned'].includes(leave.leaveType);
    const isCompOffRefund = leave.leaveType === 'CompOff';

    if (isPaidLeaveRefund || isCompOffRefund) {
      const balanceDoc = await LeaveBalance.findOne({ employeeId: leave.employeeId }).session(session);
      if (balanceDoc) {
        const balanceField = isPaidLeaveRefund ? 'paidLeaveBalance' : 'compOffBalance';
        const prevBalance = balanceDoc[balanceField] || 0;
        const newBalance = prevBalance + leave.totalDays;

        balanceDoc[balanceField] = newBalance;
        const historyLeaveType = isCompOffRefund ? 'CompOff' : 'Paid';
        balanceDoc.history.push({
          type: 'Adjustment',
          leaveType: historyLeaveType,
          amount: leave.totalDays,
          previousBalance: prevBalance,
          newBalance: newBalance,
          remarks: `Leave rejected: Refund for ${new Date(leave.startDate).toDateString()}`,
          updatedBy: req.user._id,
          timestamp: new Date(),
        });
        await balanceDoc.save({ session });
      }
    }

    await leave.save({ session });
    await session.commitTransaction();

    const updated = await Leave.findById(leave._id).populate('employeeId', 'name employeeCode department role');
    res.json(new ApiResponse(200, updated, 'Leave rejected and balance refunded'));
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL LEAVE
// ─────────────────────────────────────────────────────────────────────────────
export const cancelLeave = asyncHandler(async (req, res) => {
  const { reason = '' } = req.body;
  const leave = await Leave.findById(req.params.id);
  if (!leave) throw new ApiError(404, 'Leave not found');

  const isOwner = leave.employeeId.toString() === req.user._id.toString();
  const isAdmin = ADMIN_ROLES.includes(req.user.role);

  if (!isOwner && !isAdmin) throw new ApiError(403, 'You can only cancel your own leave');

  if (!['Pending', 'Approved'].includes(leave.overallStatus)) {
    throw new ApiError(400, `Cannot cancel a leave that is already ${leave.overallStatus}`);
  }

  const wasApproved = leave.overallStatus === 'Approved';

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    leave.overallStatus = 'Cancelled';
    leave.cancelledBy = req.user._id;
    leave.cancelledAt = new Date();
    leave.cancelReason = reason;
    leave.currentApproverRole = 'Completed';

    leave.actionHistory.push({
      action: 'Cancelled',
      byEmployeeId: req.user._id,
      byName: req.user.name,
      byRole: req.user.role,
      remarks: reason,
      timestamp: new Date(),
    });

    // ── REFUND BALANCE ──
    const isPaidLeaveCancel = ['Paid', 'Casual', 'Sick', 'Earned'].includes(leave.leaveType);
    const isCompOffCancel = leave.leaveType === 'CompOff';

    if (isPaidLeaveCancel || isCompOffCancel) {
      const balanceDoc = await LeaveBalance.findOne({ employeeId: leave.employeeId }).session(session);
      if (balanceDoc) {
        const balanceField = isPaidLeaveCancel ? 'paidLeaveBalance' : 'compOffBalance';
        const prevBalance = balanceDoc[balanceField] || 0;
        const newBalance = prevBalance + leave.totalDays;

        balanceDoc[balanceField] = newBalance;
        const historyLeaveType = isCompOffCancel ? 'CompOff' : 'Paid';
        balanceDoc.history.push({
          type: 'Adjustment',
          leaveType: historyLeaveType,
          amount: leave.totalDays,
          previousBalance: prevBalance,
          newBalance: newBalance,
          remarks: `Leave cancelled: Refund for ${new Date(leave.startDate).toDateString()}`,
          updatedBy: req.user._id,
          timestamp: new Date(),
        });
        await balanceDoc.save({ session });
      }
    }

    await leave.save({ session });
    await session.commitTransaction();

    if (wasApproved) {
      await revertApprovedLeaveFromAttendanceAndPayroll(leave);
    }

    const updated = await Leave.findById(leave._id).populate('employeeId', 'name employeeCode department role');
    res.json(new ApiResponse(200, updated, 'Leave cancelled and balance refunded'));
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET LEAVE STATS (for HR/Director dashboard)
// ─────────────────────────────────────────────────────────────────────────────
export const getLeaveStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [
    totalPending,
    hrPending,
    approvedThisMonth,
    rejectedThisMonth,
    totalThisMonth,
    byType,
    byStatus,
  ] = await Promise.all([
    Leave.countDocuments({ overallStatus: 'Pending' }),
    Leave.countDocuments({ hrStatus: 'Pending', overallStatus: 'Pending' }),
    Leave.countDocuments({ overallStatus: 'Approved', startDate: { $gte: startOfMonth, $lte: endOfMonth } }),
    Leave.countDocuments({ overallStatus: 'Rejected', startDate: { $gte: startOfMonth, $lte: endOfMonth } }),
    Leave.countDocuments({ startDate: { $gte: startOfMonth, $lte: endOfMonth } }),
    Leave.aggregate([{ $group: { _id: '$leaveType', count: { $sum: 1 } } }]),
    Leave.aggregate([{ $group: { _id: '$overallStatus', count: { $sum: 1 } } }]),
  ]);

  res.json(
    new ApiResponse(
      200,
      {
        totalPending,
        pendingByStage: { hr: hrPending },
        thisMonth: { total: totalThisMonth, approved: approvedThisMonth, rejected: rejectedThisMonth },
        byType,
        byStatus,
      },
      'Leave stats fetched'
    )
  );
});

// ─── MONTHLY LEAVE ACCRUAL & SETTLEMENT ──────────────────────────────────────

export const accrueMonthlyLeaves = asyncHandler(async (req, res) => {
  res.status(200).json(new ApiResponse(200, null, 'Monthly leave accrual is disabled.'));
});

export const getLeaveBalanceHistory = asyncHandler(async (req, res) => {
  const balanceDoc = await LeaveBalance.findOne({ employeeId: req.user._id });
  const history = (balanceDoc?.history || []).sort((a, b) => new Date(b.createdAt || b.timestamp) - new Date(a.createdAt || a.timestamp));

  res.json(new ApiResponse(200, history, 'Leave balance history fetched'));
});

//--- comp off screen -- view the compoffs

export const getCompOffBalanceHistory = asyncHandler(async (req, res) => {
  const balanceDoc = await LeaveBalance.findOne({ employeeId: req.user._id });
  const compOffBalance = balanceDoc?.compOffBalance || 0;
  const now = new Date();

  const history = (balanceDoc?.history || [])
    .filter((item) => item.leaveType === 'CompOff')
    .map((item) => {
      let status = 'Available';
      if (item.type === 'CompOffCredit' || item.type === 'Addition' || item.type === 'Accrual') {
        if (item.isUsed) status = 'Used';
        else if (item.expiryDate && new Date(item.expiryDate) < now) status = 'Expired';
      } else {
        status = 'Deduction';
      }

      return {
        _id: item._id,
        type: item.type,
        amount: item.amount,
        earnedDate: item.earnedDate || item.createdAt || item.timestamp,
        expiryDate: item.expiryDate,
        status: status,
        usedDate: item.usedDate,
        remarks: item.remarks,
        timestamp: item.createdAt || item.timestamp,
        newBalance: item.newBalance,
      };
    })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  res.json(new ApiResponse(200, { history, currentBalance: compOffBalance }, 'Comp-Off balance history fetched'));
});

/**
 * Manually adjust leave balance (Admin/HR only)
 */
export const adjustLeaveBalance = asyncHandler(async (req, res) => {
  const { employeeId, leaveType, amount, remarks } = req.body;

  if (!employeeId || !leaveType || amount === undefined) {
    throw new ApiError(400, 'employeeId, leaveType, and amount are required');
  }

  let balanceDoc = await LeaveBalance.findOne({ employeeId });
  if (!balanceDoc) {
    balanceDoc = new LeaveBalance({ employeeId });
  }

  const isPaidLeave = ['Paid', 'Casual', 'Sick', 'Earned'].includes(leaveType);
  const isCompOff = leaveType === 'CompOff';
  const balanceField = isPaidLeave ? 'paidLeaveBalance' : 'compOffBalance';
  const prevBalance = balanceDoc[balanceField] || 0;
  const newBalance = Math.max(0, prevBalance + Number(amount));

  balanceDoc[balanceField] = newBalance;
  const historyLeaveType = isCompOff ? 'CompOff' : 'Paid';
  balanceDoc.history.push({
    type: 'Adjustment',
    leaveType: historyLeaveType,
    amount: Math.abs(Number(amount)),
    previousBalance: prevBalance,
    newBalance: newBalance,
    remarks: remarks || 'Administrative adjustment',
    updatedBy: req.user._id,
    timestamp: new Date(),
  });

  await balanceDoc.save();

  res.json(new ApiResponse(200, balanceDoc, `Balance adjusted successfully. New ${leaveType} balance: ${newBalance}`));
});