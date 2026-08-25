import mongoose from 'mongoose';

const appVersionSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: ['android', 'ios'],
      required: [true, 'Platform is required'],
      index: true,
    },
    version: {
      type: String,
      required: [true, 'Version string is required'],
      trim: true,
    },
    versionCode: {
      type: Number,
      default: 1,
    },
    minVersion: {
      type: String,
      default: '1.0.0',
      trim: true,
    },
    priority: {
      type: String,
      enum: ['optional', 'recommended', 'important', 'critical'],
      default: 'optional',
    },
    updateLink: {
      type: String,
      required: [true, 'Update link is required'],
      trim: true,
    },
    title: {
      type: String,
      default: 'New Update Available',
      trim: true,
    },
    description: {
      type: String,
      default: 'A new version of the app is available with performance improvements and bug fixes.',
      trim: true,
    },
    releaseNotes: [
      {
        type: String,
        trim: true,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
    maintenanceMessage: {
      type: String,
      default: 'The app is currently undergoing scheduled maintenance. Please check back shortly.',
      trim: true,
    },
    rolloutPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 100,
    },
    releaseDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

appVersionSchema.index({ platform: 1, version: 1 });
appVersionSchema.index({ platform: 1, isActive: 1 });

export const AppVersion = mongoose.model('AppVersion', appVersionSchema);
