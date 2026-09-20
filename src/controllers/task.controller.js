import { Task } from '../models/Task.model.js';
import { Attendance } from '../models/Attendance.model.js';
import { Employee } from '../models/Employee.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  getOfficeStartOfDay,
  getOfficeEndOfDay,
  DEFAULT_TIMEZONE,
} from '../utils/dateHelper.js';

const MANAGEMENT_ROLES = ['SuperUser', 'HR', 'Manager', 'Director', 'VP', 'GM'];

// ─── CREATE TASK ─────────────────────────────────────────────────────────────

export const createTask = asyncHandler(async (req, res) => {
  const {
    title,
    description = '',
    priority = 'Medium',
    dueTime,
    notes = '',
    employeeId: targetEmployeeId,
    status = 'Assigned',
  } = req.body;

  if (!title || !title.trim()) {
    throw new ApiError(400, 'Task title is required');
  }

  const currentUser = req.user;
  const isManager = MANAGEMENT_ROLES.includes(currentUser.role);

  let targetEmployee = currentUser;
  let isSelfAssigned = true;
  let isAdminAssigned = false;

  if (targetEmployeeId && targetEmployeeId.toString() !== currentUser._id.toString()) {
    if (!isManager) {
      throw new ApiError(403, 'Only managers and HR can assign tasks to other employees');
    }
    const foundEmp = await Employee.findById(targetEmployeeId);
    if (!foundEmp) throw new ApiError(404, 'Assigned employee not found');
    targetEmployee = foundEmp;
    isSelfAssigned = false;
    isAdminAssigned = true;
  }

  const today = getOfficeStartOfDay(new Date(), DEFAULT_TIMEZONE);

  // Find today's attendance record if checked in
  const attendance = await Attendance.findOne({
    employeeId: targetEmployee._id,
    date: today,
  });

  const task = await Task.create({
    employeeId: targetEmployee._id,
    employeeCode: targetEmployee.employeeCode,
    employeeName: targetEmployee.name,
    attendanceId: attendance?._id || null,
    date: today,
    title: title.trim(),
    description: description.trim(),
    priority: ['Low', 'Medium', 'High', 'Urgent'].includes(priority) ? priority : 'Medium',
    status: ['Assigned', 'In Progress', 'Completed', 'Pending'].includes(status) ? status : 'Assigned',
    dueTime: dueTime ? dueTime.trim() : undefined,
    notes: notes.trim(),
    isSelfAssigned,
    isAdminAssigned,
    assignedBy: currentUser._id,
    assignedByName: currentUser.name,
    completedAt: status === 'Completed' ? new Date() : null,
  });

  res.status(201).json(new ApiResponse(201, task, 'Task created successfully'));
});

// ─── GET TODAY'S SESSION TASKS ───────────────────────────────────────────────

export const getTodaySessionTasks = asyncHandler(async (req, res) => {
  const employeeId = req.user._id;
  const todayStart = getOfficeStartOfDay(new Date(), DEFAULT_TIMEZONE);
  const todayEnd = getOfficeEndOfDay(new Date(), DEFAULT_TIMEZONE);

  const tasks = await Task.find({
    employeeId,
    date: { $gte: todayStart, $lte: todayEnd },
  }).sort({ createdAt: -1 });

  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'Completed').length;
  const inProgress = tasks.filter((t) => t.status === 'In Progress').length;
  const pending = tasks.filter((t) => t.status === 'Pending' || t.status === 'Assigned').length;

  res.status(200).json(
    new ApiResponse(
      200,
      {
        tasks,
        summary: {
          total,
          completed,
          inProgress,
          pending,
          completionPercentage: total > 0 ? Math.round((completed / total) * 100) : 0,
        },
      },
      'Today session tasks fetched'
    )
  );
});

// ─── GET TASK HISTORY / MY TASKS ─────────────────────────────────────────────

export const getMyTasks = asyncHandler(async (req, res) => {
  const employeeId = req.user._id;
  const { status, priority, from, to, page = 1, limit = 20 } = req.query;

  const query = { employeeId };

  if (status && status !== 'all') {
    query.status = status;
  }
  if (priority && priority !== 'all') {
    query.priority = priority;
  }
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = getOfficeStartOfDay(new Date(from), DEFAULT_TIMEZONE);
    if (to) query.date.$lte = getOfficeEndOfDay(new Date(to), DEFAULT_TIMEZONE);
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [tasks, total] = await Promise.all([
    Task.find(query).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limitNum),
    Task.countDocuments(query),
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        tasks,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
      'Task history retrieved'
    )
  );
});

// ─── GET SINGLE TASK ─────────────────────────────────────────────────────────

export const getTaskById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isManager = MANAGEMENT_ROLES.includes(req.user.role);

  const filter = { _id: id };
  if (!isManager) {
    filter.employeeId = req.user._id;
  }

  const task = await Task.findOne(filter)
    .populate('reviewedBy', 'name employeeCode')
    .populate('assignedBy', 'name employeeCode')
    .populate('employeeId', 'name employeeCode department');

  if (!task) throw new ApiError(404, 'Task not found');

  res.status(200).json(new ApiResponse(200, task, 'Task fetched'));
});

// ─── UPDATE TASK ─────────────────────────────────────────────────────────────

export const updateTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, description, priority, status, dueTime, notes } = req.body;
  const isManager = MANAGEMENT_ROLES.includes(req.user.role);

  // Employees can only update their own tasks; managers can update any
  const filter = isManager ? { _id: id } : { _id: id, employeeId: req.user._id };
  const task = await Task.findOne(filter);
  if (!task) throw new ApiError(404, 'Task not found');

  if (title !== undefined) task.title = title.trim();
  if (description !== undefined) task.description = description.trim();
  if (priority !== undefined) task.priority = priority;
  if (dueTime !== undefined) task.dueTime = dueTime;
  if (notes !== undefined) task.notes = notes.trim();

  if (status !== undefined && status !== task.status) {
    task.status = status;
    if (status === 'Completed') {
      task.completedAt = new Date();
    } else {
      task.completedAt = null;
    }
  }

  await task.save();

  res.status(200).json(new ApiResponse(200, task, 'Task updated successfully'));
});

// ─── DELETE TASK ─────────────────────────────────────────────────────────────

export const deleteTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isManager = MANAGEMENT_ROLES.includes(req.user.role);
  const filter = isManager ? { _id: id } : { _id: id, employeeId: req.user._id };

  const task = await Task.findOneAndDelete(filter);
  if (!task) throw new ApiError(404, 'Task not found');

  res.status(200).json(new ApiResponse(200, { id }, 'Task deleted successfully'));
});

// ─── BATCH SYNC SESSION TASKS AT CHECKOUT ────────────────────────────────────

export const batchSyncSessionTasks = asyncHandler(async (req, res) => {
  const { tasks = [] } = req.body;
  const employeeId = req.user._id;
  const todayStart = getOfficeStartOfDay(new Date(), DEFAULT_TIMEZONE);
  const todayEnd = getOfficeEndOfDay(new Date(), DEFAULT_TIMEZONE);

  // Find today's attendance record
  const attendance = await Attendance.findOne({
    employeeId,
    date: { $gte: todayStart, $lte: todayEnd },
  });

  if (Array.isArray(tasks) && tasks.length > 0) {
    const validTasks = tasks.filter((t) => t && t._id);
    if (validTasks.length > 0) {
      const updateOps = validTasks.map((t) => {
        const isCompleted = t.status === 'Completed';
        const updateFields = {
          status: isCompleted ? 'Completed' : 'Pending',
          completedAt: isCompleted ? new Date() : null,
        };
        if (t.description !== undefined) {
          updateFields.description = String(t.description).trim();
        }
        if (t.notes !== undefined) {
          updateFields.notes = String(t.notes).trim();
        }
        if (attendance?._id) {
          updateFields.attendanceId = attendance._id;
        }
        return {
          updateOne: {
            filter: { _id: t._id, employeeId },
            update: { $set: updateFields },
          },
        };
      });

      await Task.bulkWrite(updateOps);
    }
  }

  // Refetch updated tasks for today
  const sessionTasks = await Task.find({
    employeeId,
    date: { $gte: todayStart, $lte: todayEnd },
  }).sort({ createdAt: 1 });

  const completedList = sessionTasks.filter((t) => t.status === 'Completed');
  const pendingList = sessionTasks.filter((t) => t.status !== 'Completed');

  const summaryText = completedList
    .map((t, idx) => `${idx + 1}. ${t.title}${t.description ? ` (${t.description})` : ''}`)
    .join('\n');
  const pendingText = pendingList.map((t, idx) => `${idx + 1}. ${t.title}`).join('\n');

  res.status(200).json(
    new ApiResponse(
      200,
      {
        tasks: sessionTasks,
        completedCount: completedList.length,
        pendingCount: pendingList.length,
        summaryText,
        pendingText,
      },
      'Session tasks synced'
    )
  );
});

// ─── ADMIN: GET ALL EMPLOYEE TASKS ───────────────────────────────────────────

export const getAdminTaskList = asyncHandler(async (req, res) => {
  const {
    employeeCode,
    search,
    department,
    status,
    priority,
    from,
    to,
    reviewStatus,
    page = 1,
    limit = 25,
  } = req.query;

  const query = {};

  if (status && status !== 'all') {
    if (status === 'Pending') {
      query.status = { $in: ['Pending', 'Assigned', 'In Progress'] };
    } else {
      query.status = status;
    }
  }
  if (priority && priority !== 'all') query.priority = priority;
  if (reviewStatus && reviewStatus !== 'all') query.reviewStatus = reviewStatus;

  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = getOfficeStartOfDay(new Date(from), DEFAULT_TIMEZONE);
    if (to) query.date.$lte = getOfficeEndOfDay(new Date(to), DEFAULT_TIMEZONE);
  } else {
    // Default to today
    query.date = {
      $gte: getOfficeStartOfDay(new Date(), DEFAULT_TIMEZONE),
      $lte: getOfficeEndOfDay(new Date(), DEFAULT_TIMEZONE),
    };
  }

  // Filter by department via employee lookup
  if (department) {
    const emps = await Employee.find({ department }, { _id: 1 }).lean();
    query.employeeId = { $in: emps.map((e) => e._id) };
  }

  const searchTerm = search || employeeCode;
  if (searchTerm) {
    query.$or = [
      { employeeCode: { $regex: searchTerm, $options: 'i' } },
      { employeeName: { $regex: searchTerm, $options: 'i' } },
      { title: { $regex: searchTerm, $options: 'i' } },
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 25));
  const skip = (pageNum - 1) * limitNum;

  const [tasks, total, allFiltered] = await Promise.all([
    Task.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('reviewedBy', 'name employeeCode')
      .populate('attendanceId', 'inTime outTime totalHours totalMinutes workMode status isLate lateMinutes isEarlyCheckout earlyCheckoutMinutes')
      .populate('employeeId', 'name employeeCode department profileImageUrl')
      .lean(),
    Task.countDocuments(query),
    Task.find(query, { status: 1, reviewStatus: 1 }).lean(),
  ]);

  const completed = allFiltered.filter((t) => t.status === 'Completed').length;
  const pending = allFiltered.filter((t) => t.status !== 'Completed').length;
  const reviewed = allFiltered.filter((t) => t.reviewStatus === 'Reviewed').length;

  const summary = {
    total,
    completed,
    pending,
    reviewed,
    completionPercentage: total > 0 ? Math.round((completed / total) * 100) : 0,
  };

  res.status(200).json(
    new ApiResponse(
      200,
      {
        tasks,
        summary,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
      'Admin task list fetched'
    )
  );
});

// ─── ADMIN: REVIEW A TASK ────────────────────────────────────────────────────

export const reviewTask = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reviewNotes, reviewStatus = 'Reviewed' } = req.body;

  if (!['Reviewed', 'NeedsRevision', 'Pending'].includes(reviewStatus)) {
    throw new ApiError(400, 'Invalid review status');
  }

  const task = await Task.findById(id);
  if (!task) throw new ApiError(404, 'Task not found');

  task.reviewedBy = req.user._id;
  task.reviewedByName = req.user.name;
  task.reviewNotes = reviewNotes?.trim() || '';
  task.reviewStatus = reviewStatus;
  task.reviewedAt = new Date();

  await task.save();

  res.status(200).json(new ApiResponse(200, task, 'Task reviewed successfully'));
});
