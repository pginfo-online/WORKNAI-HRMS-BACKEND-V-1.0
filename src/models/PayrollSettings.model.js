import mongoose from 'mongoose';

/**
 * PayrollSettings — Company-wide settings for payroll calculations.
 * Allows Admin/HR to configure, enable, or disable Professional Tax (PT) and customize slabs.
 */
const payrollSettingsSchema = new mongoose.Schema(
  {
    // PT master toggle
    ptEnabled: {
      type: Boolean,
      default: true,
    },

    // Female rules
    femaleThreshold: {
      type: Number,
      default: 25000,
      min: 0,
    },
    femalePtAmount: {
      type: Number,
      default: 200,
      min: 0,
    },
    femaleFebPtAmount: {
      type: Number,
      default: 300,
      min: 0,
    },

    // Male & Other rules
    maleMinThreshold: {
      type: Number,
      default: 7500,
      min: 0,
    },
    maleMidThreshold: {
      type: Number,
      default: 10000,
      min: 0,
    },
    maleMidPtAmount: {
      type: Number,
      default: 175,
      min: 0,
    },
    maleMaxPtAmount: {
      type: Number,
      default: 200,
      min: 0,
    },
    maleFebPtAmount: {
      type: Number,
      default: 300,
      min: 0,
    },

    // Metadata
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
  },
  { timestamps: true }
);

// Static helper to get or initialize default settings singleton
payrollSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

export const PayrollSettings = mongoose.model('PayrollSettings', payrollSettingsSchema);
