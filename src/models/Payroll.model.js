import mongoose from 'mongoose';

/**
 * Payroll — payroll period runs 1st to last day of month.
 * Salary payment is due on the 10th of the following month.
 */
const payrollSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    employeeCode: { type: String, required: true, index: true },
    employeeName: { type: String },
    department: { type: String },

    // ── PERIOD ──
    // month: 1–12, year: full year (e.g. 2026)
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true, min: 2020 },
    // Always 1st of the month
    fromDate: { type: Date, required: true },
    // Always last day of the month
    toDate: { type: Date, required: true },
    // Always 10th of the FOLLOWING month
    paymentDueDate: { type: Date, required: true },

    // ── ATTENDANCE SUMMARY ──
    totalDaysInMonth: { type: Number, required: true },
    workingDays: { type: Number, default: 0 },       // actual working days (excl. weekends/holidays)
    presentDays: { type: Number, default: 0 },
    paidLeavesTaken: { type: Number, default: 0 },
    unpaidLeavesTaken: { type: Number, default: 0 },
    halfDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    holidays: { type: Number, default: 0 },
    weekOffs: { type: Number, default: 0 },
    sandwichDeductions: { type: Number, default: 0 },
    compOffsTaken: { type: Number, default: 0 },

    // Detailed date arrays for audit
    presentDayDetails: [{ date: Date, workMode: String }],
    paidLeaveDayDetails: [{ date: Date, leaveId: mongoose.Schema.Types.ObjectId }],
    halfDayDetails: [{ date: Date, reason: String }],
    absentDayDetails: [{ date: Date, reason: String }],
    sandwichDetails: [{ date: Date, reason: String }],

    // Total days for which salary is paid (presentDays + paidLeavesTaken + holidays + (halfDays*0.5) - sandwichDeductions)
    paidDays: { type: Number, required: true },

    // ── SALARY CALCULATIONS ──
    baseSalary: { type: Number, required: true },         // Monthly CTC / fixed
    grossEarnings: { type: Number, required: true },      // (baseSalary / totalDaysInMonth) * paidDays

    // ── DEDUCTIONS ──
    professionalTax: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },
    otherDeductionRemarks: { type: String },

    // ── NET ──
    netSalary: { type: Number, required: true },          // grossEarnings - professionalTax - otherDeductions

    // ── STATUS & DOCS ──
    status: {
      type: String,
      enum: ['Draft', 'Processed', 'Paid'],
      default: 'Draft',
      index: true,
    },
    paymentDate: { type: Date },                          // Actual date salary was transferred
    salarySlipUrl: { type: String },                      // Cloudinary PDF URL
    remarks: { type: String, trim: true },

    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

// ── UNIQUE CONSTRAINT: one payroll per employee per month/year ──
payrollSchema.index({ employeeId: 1, month: 1, year: 1 }, { unique: true });
payrollSchema.index({ month: 1, year: 1 });

// ── PRE-SAVE: enforce payroll period rules ──
payrollSchema.pre('validate', function (next) {
  if (this.month && this.year) {
    // fromDate = 1st of month
    this.fromDate = new Date(this.year, this.month - 1, 1);

    // toDate = last day of month
    this.toDate = new Date(this.year, this.month, 0);

    // paymentDueDate = 10th of following month
    const nextMonth = this.month === 12 ? 1 : this.month + 1;
    const nextYear = this.month === 12 ? this.year + 1 : this.year;
    this.paymentDueDate = new Date(nextYear, nextMonth - 1, 10);
  }
  next();
});

export const Payroll = mongoose.model('Payroll', payrollSchema);
