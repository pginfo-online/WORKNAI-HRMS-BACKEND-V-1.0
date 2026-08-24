import mongoose from 'mongoose';

/**
 * EmployeeBankDetails — extracted from Employee model.
 * One document per employee.
 */
const employeeBankDetailsSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      unique: true,
      index: true,
    },

    accountHolderName: { type: String, trim: true },
    bankName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    ifsc: { type: String, trim: true, uppercase: true },
    branch: { type: String, trim: true },

    bankVerified: { type: Boolean, default: false },
    bankVerifiedDate: { type: Date },
    bankVerifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
  },
  { timestamps: true }
);

export const EmployeeBankDetails = mongoose.model('EmployeeBankDetails', employeeBankDetailsSchema);
