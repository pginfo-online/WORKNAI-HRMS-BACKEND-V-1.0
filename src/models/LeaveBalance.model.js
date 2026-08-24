import mongoose from 'mongoose';

/**
 * LeaveBalance — extracted from the Employee monolith.
 * HR manually adds paid leave; compOff is credited via attendance approval.
 * One document per employee.
 */

const leaveHistoryEntrySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Addition', 'Deduction', 'Adjustment', 'Reset', 'CompOffCredit', 'CompOffDeduction'],
      required: true,
    },
    leaveType: {
      type: String,
      enum: ['Paid', 'CompOff'],
      required: true,
    },
    amount: { type: Number, required: true },
    previousBalance: { type: Number, required: true },
    newBalance: { type: Number, required: true },
    remarks: { type: String, trim: true },
    // Who performed this action
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
    // For CompOff tracking
    earnedDate: { type: Date },
    expiryDate: { type: Date },
    isUsed: { type: Boolean, default: false },
    usedDate: { type: Date },
  },
  { timestamps: true, _id: true }
);

const leaveBalanceSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      unique: true,
      index: true,
    },

    paidLeaveBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    compOffBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Full audit trail of all balance changes
    history: {
      type: [leaveHistoryEntrySchema],
      default: [],
    },

    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
  },
  { timestamps: true }
);

export const LeaveBalance = mongoose.model('LeaveBalance', leaveBalanceSchema);
