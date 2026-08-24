import { LeaveBalance } from '../models/LeaveBalance.model.js';
import { Employee } from '../models/Employee.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** GET /api/leave-balance/me — employee views own balance */
export const getMyLeaveBalance = asyncHandler(async (req, res) => {
  let balance = await LeaveBalance.findOne({ employeeId: req.user._id }).lean();

  // Auto-create if not exists
  if (!balance) {
    balance = await LeaveBalance.create({ employeeId: req.user._id });
    balance = balance.toObject();
  }

  res.json(new ApiResponse(200, balance, 'Leave balance fetched'));
});

/** GET /api/leave-balance/:employeeId — HR/Manager views any employee's balance */
export const getEmployeeLeaveBalance = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;

  const employee = await Employee.findById(employeeId).select('name employeeCode department').lean();
  if (!employee) throw new ApiError(404, 'Employee not found');

  let balance = await LeaveBalance.findOne({ employeeId }).lean();
  if (!balance) {
    balance = await LeaveBalance.create({ employeeId });
    balance = balance.toObject();
  }

  res.json(new ApiResponse(200, { employee, balance }, 'Leave balance fetched'));
});

/** GET /api/leave-balance — HR lists all employees with balances */
export const listAllLeaveBalances = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, department, search } = req.query;

  const filter = { status: 'Active' };
  if (department) filter.department = department;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { employeeCode: { $regex: search, $options: 'i' } },
    ];
  }

  const employees = await Employee.find(filter)
    .select('name employeeCode department role')
    .sort({ name: 1 })
    .skip((page - 1) * limit)
    .limit(Number(limit))
    .lean();

  const total = await Employee.countDocuments(filter);
  const employeeIds = employees.map((e) => e._id);

  const balances = await LeaveBalance.find({ employeeId: { $in: employeeIds } }).lean();
  const balanceMap = {};
  balances.forEach((b) => {
    balanceMap[b.employeeId.toString()] = b;
  });

  const result = employees.map((emp) => ({
    ...emp,
    leaveBalance: balanceMap[emp._id.toString()] || {
      paidLeaveBalance: 0,
      compOffBalance: 0,
    },
  }));

  res.json(new ApiResponse(200, {
    data: result,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    },
  }, 'Leave balances fetched'));
});

/** POST /api/leave-balance/add — HR adds paid leave to an employee */
export const addPaidLeave = asyncHandler(async (req, res) => {
  const { employeeId, days, remarks } = req.body;

  if (!employeeId || !days) throw new ApiError(400, 'employeeId and days are required');
  if (days <= 0) throw new ApiError(400, 'days must be positive');

  const employee = await Employee.findById(employeeId).select('name employeeCode').lean();
  if (!employee) throw new ApiError(404, 'Employee not found');

  let balance = await LeaveBalance.findOne({ employeeId });
  if (!balance) {
    balance = new LeaveBalance({ employeeId });
  }

  const previousBalance = balance.paidLeaveBalance;
  const newBalance = previousBalance + Number(days);

  balance.paidLeaveBalance = newBalance;
  balance.history.push({
    type: 'Addition',
    leaveType: 'Paid',
    amount: Number(days),
    previousBalance,
    newBalance,
    remarks: remarks || `Added by HR`,
    updatedBy: req.user._id,
  });
  balance.lastUpdatedBy = req.user._id;

  await balance.save();

  res.json(new ApiResponse(200, balance, `${days} paid leave(s) added to ${employee.name}`));
});

/** PUT /api/leave-balance/:employeeId — HR adjusts balance */
export const adjustLeaveBalance = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;
  const { paidLeaveBalance, compOffBalance, remarks } = req.body;

  if (paidLeaveBalance == null && compOffBalance == null) {
    throw new ApiError(400, 'At least one of paidLeaveBalance or compOffBalance must be provided');
  }

  let balance = await LeaveBalance.findOne({ employeeId });
  if (!balance) {
    balance = new LeaveBalance({ employeeId });
  }

  if (paidLeaveBalance != null) {
    const prev = balance.paidLeaveBalance;
    const next = Number(paidLeaveBalance);
    balance.history.push({
      type: 'Adjustment',
      leaveType: 'Paid',
      amount: next - prev,
      previousBalance: prev,
      newBalance: next,
      remarks: remarks || 'Manual adjustment by HR',
      updatedBy: req.user._id,
    });
    balance.paidLeaveBalance = next;
  }

  if (compOffBalance != null) {
    const prev = balance.compOffBalance;
    const next = Number(compOffBalance);
    balance.history.push({
      type: 'Adjustment',
      leaveType: 'CompOff',
      amount: next - prev,
      previousBalance: prev,
      newBalance: next,
      remarks: remarks || 'Manual adjustment by HR',
      updatedBy: req.user._id,
    });
    balance.compOffBalance = next;
  }

  balance.lastUpdatedBy = req.user._id;
  await balance.save();

  res.json(new ApiResponse(200, balance, 'Leave balance adjusted'));
});
