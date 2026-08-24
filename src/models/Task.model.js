import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    employeeCode: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    employeeName: {
      type: String,
    },
    attendanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Attendance',
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Task title is required'],
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Urgent'],
      default: 'Medium',
    },
    status: {
      type: String,
      enum: ['Assigned', 'In Progress', 'Completed', 'Pending'],
      default: 'Assigned',
      index: true,
    },
    dueTime: {
      type: String, // e.g. "17:30" or "05:30 PM"
    },
    completedAt: {
      type: Date,
    },
    notes: {
      type: String,
      trim: true,
    },
    isSelfAssigned: {
      type: Boolean,
      default: true,
    },
    isAdminAssigned: {
      type: Boolean,
      default: false,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
    assignedByName: {
      type: String,
    },

    // ── REVIEW FIELDS (for admin/manager review) ──
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
    reviewedByName: {
      type: String,
    },
    reviewNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    reviewedAt: {
      type: Date,
    },
    reviewStatus: {
      type: String,
      enum: ['Pending', 'Reviewed', 'NeedsRevision'],
      default: 'Pending',
    },
  },
  { timestamps: true }
);

taskSchema.index({ employeeId: 1, date: 1 });
taskSchema.index({ employeeId: 1, status: 1 });
taskSchema.index({ date: 1, status: 1 });
taskSchema.index({ employeeCode: 1, date: -1 });

export const Task = mongoose.model('Task', taskSchema);
