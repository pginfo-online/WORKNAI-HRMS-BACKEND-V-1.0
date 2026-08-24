import mongoose from 'mongoose';

/**
 * Office — replaces hardcoded OFFICE_LATITUDE/LONGITUDE/RADIUS_METERS in config.
 * HR/Admin can manage offices via API.
 */
const officeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    state: {
      type: String,
      trim: true,
    },

    // ── GEO ──
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    // Radius in metres within which office check-in is valid
    radiusMeters: {
      type: Number,
      required: true,
      default: 200,
      min: 10,
    },

    // Reference to working hours configuration
    workingHoursId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkingHours',
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Allow certain employees to bypass geo-check (by employeeCode)
    geoBypassCodes: {
      type: [String],
      default: [],
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
  },
  { timestamps: true }
);

export const Office = mongoose.model('Office', officeSchema);
