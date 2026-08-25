import mongoose from 'mongoose';

const appVersionAuditSchema = new mongoose.Schema(
  {
    versionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AppVersion',
      required: false,
    },
    versionString: {
      type: String,
      default: '',
    },
    platform: {
      type: String,
      enum: ['android', 'ios'],
    },
    action: {
      type: String,
      enum: ['create', 'update', 'delete', 'toggle_active'],
      required: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
    performedByName: {
      type: String,
      required: true,
    },
    changes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export const AppVersionAudit = mongoose.model('AppVersionAudit', appVersionAuditSchema);
