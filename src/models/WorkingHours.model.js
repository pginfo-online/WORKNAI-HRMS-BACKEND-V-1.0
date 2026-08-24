import mongoose from 'mongoose';

/**
 * WorkingHours — one shift per office.
 * Replaces all hardcoded time thresholds in the application.
 */
const workingHoursSchema = new mongoose.Schema(
  {
    officeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Office',
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      default: 'Standard Shift',
    },

    // ── TIMES (HH:MM 24-hour format) ──
    checkInTime: {
      type: String,
      required: true,
      match: /^\d{2}:\d{2}$/,
      default: '09:30',
    },
    checkOutTime: {
      type: String,
      required: true,
      match: /^\d{2}:\d{2}$/,
      default: '18:30',
    },

    // Grace period before marking late (minutes after checkInTime)
    lateGraceMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Minimum minutes of work to count as a half-day
    halfDayMinutes: {
      type: Number,
      default: 240, // 4 hours
    },

    // Minimum minutes of work to count as a full day
    fullDayMinutes: {
      type: Number,
      default: 480, // 8 hours
    },

    // Work days: 0=Sunday, 1=Monday … 6=Saturday
    workDays: {
      type: [Number],
      default: [1, 2, 3, 4, 5], // Mon–Fri
      validate: {
        validator: (arr) => arr.every((d) => d >= 0 && d <= 6),
        message: 'workDays must be 0–6',
      },
    },

    isDefault: {
      type: Boolean,
      default: false,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
  },
  { timestamps: true }
);

// Ensure only one default shift at a time
workingHoursSchema.index({ officeId: 1, isDefault: 1 });

export const WorkingHours = mongoose.model('WorkingHours', workingHoursSchema);
