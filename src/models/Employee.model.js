import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';

/**
 * Employee — core identity, auth, and job information only.
 *
 * Extended data lives in separate models:
 *   - EmployeeDocument   (docs, verification)
 *   - EmployeeBankDetails (bank account)
 *   - LeaveBalance        (paid leave, comp-off)
 */
const employeeSchema = new mongoose.Schema(
  {
    // ── EMPLOYEE CODE ──
    employeeCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: /^[A-Z]{2}\d{5}$/,
      index: true,
    },

    // ── AUTH ──
    password: { type: String, required: true, minlength: 6, select: false },
    refreshToken: { type: String, select: false },

    // ── ACCOUNT ──
    role: {
      type: String,
      required: true,
      enum: ['SuperUser', 'HR', 'Manager', 'Director', 'VP', 'GM', 'Employee', 'Intern'],
      default: 'Employee',
      index: true,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
      index: true,
    },
    deactivateReason: { type: String, trim: true },
    lastWorkingDate: { type: Date },

    // ── CORE PERSONAL ──
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    mobileNumber: { type: String, required: true, trim: true },
    alternateMobileNumber: { type: String, trim: true },
    gender: { type: String, enum: ['Male', 'Female', 'Other'] },
    dateOfBirth: { type: Date },
    bloodGroup: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
    maritalStatus: { type: String, enum: ['Single', 'Married', 'Divorced', 'Widowed'] },

    profileImageUrl: { type: String }, // Cloudinary URL

    // ── OPTIONAL PERSONAL ──
    fatherName: { type: String, trim: true },
    motherName: { type: String, trim: true },
    currentAddress: { type: String, trim: true },
    permanentAddress: { type: String, trim: true },
    district: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },

    // ── EMERGENCY CONTACT ──
    emergencyContactName: { type: String, trim: true },
    emergencyContactRelationship: { type: String, trim: true },
    emergencyContactMobile: { type: String, trim: true },
    emergencyContactAddress: { type: String, trim: true },

    // ── JOB DETAILS ──
    joiningDate: { type: Date },
    department: { type: String, trim: true },
    position: { type: String, trim: true },
    salary: { type: Number, min: 0 },
    reportingManagers: [{ type: String }],
    managerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],

    // ── EXPERIENCE ──
    experienceType: { type: String, enum: ['Fresher', 'Experienced'] },
    totalExperienceYears: { type: Number, min: 0 },
    lastCompanyName: { type: String, trim: true },

    // ── EDUCATION ──
    hscPercent: { type: Number },
    graduationCourse: { type: String, trim: true },
    graduationPercent: { type: Number },
    postGraduationCourse: { type: String, trim: true },
    postGraduationPercent: { type: Number },

    // ── HEALTH (minimal) ──
    hasDisease: { type: String, enum: ['Yes', 'No'], default: 'No' },
    diseaseName: { type: String, trim: true },

    // ── GEO BYPASS ──
    // If true, this employee skips geo validation (set per-employee instead of hardcoded code)
    geoBypass: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ── INDEXES ──
employeeSchema.index({ department: 1 });
employeeSchema.index({ role: 1, status: 1 });

// ── HASH PASSWORD BEFORE SAVE ──
employeeSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ── COMPARE PASSWORD ──
employeeSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ── GENERATE NEXT EMPLOYEE CODE (STATIC) ──
employeeSchema.statics.generateNextCode = async function () {
  const prefix = config.company.prefix;
  const last = await this.findOne({}, { employeeCode: 1 }).sort({ employeeCode: -1 });
  if (!last) return `${prefix}00001`;
  const num = parseInt(last.employeeCode.substring(prefix.length), 10) + 1;
  return `${prefix}${String(num).padStart(5, '0')}`;
};

// ── SAFE OBJECT (no sensitive fields) ──
employeeSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  return obj;
};

export const Employee = mongoose.model('Employee', employeeSchema);
