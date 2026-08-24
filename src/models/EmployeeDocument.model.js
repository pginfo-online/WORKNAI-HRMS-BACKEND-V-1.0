import mongoose from 'mongoose';

/**
 * EmployeeDocument — extracted from Employee model.
 * Stores all document URLs and verification status.
 * One document per employee.
 */
const employeeDocumentSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      unique: true,
      index: true,
    },

    // ── IDENTITY DOCS ──
    aadhaarNumber: { type: String, trim: true },
    panNumber: { type: String, trim: true },
    aadhaarFileUrl: { type: String }, // Cloudinary URL
    panFileUrl: { type: String }, // Cloudinary URL

    // ── VERIFICATION ──
    aadhaarVerified: { type: Boolean, default: false },
    panVerified: { type: Boolean, default: false },
    aadhaarVerifiedDate: { type: Date },
    panVerifiedDate: { type: Date },
    aadhaarVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    panVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },

    // ── BANK PROOF ──
    passbookFileUrl: { type: String }, // Cloudinary URL

    // ── EDUCATION DOCS ──
    tenthMarksheetUrl: { type: String },
    twelfthMarksheetUrl: { type: String },
    graduationMarksheetUrl: { type: String },
    postGraduationMarksheetUrl: { type: String },

    // ── EXPERIENCE ──
    experienceCertificateUrl: { type: String },

    // ── MEDICAL ──
    medicalDocumentUrl: { type: String },

    // ── OFFER / APPOINTMENT ──
    offerLetterUrl: { type: String },
    appointmentLetterUrl: { type: String },
  },
  { timestamps: true }
);

export const EmployeeDocument = mongoose.model('EmployeeDocument', employeeDocumentSchema);
