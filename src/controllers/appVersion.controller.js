import { AppVersion } from '../models/AppVersion.model.js';
import { AppVersionAudit } from '../models/AppVersionAudit.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ── Semver Parser & Comparison Helper ─────────────────────────────────────────
export const parseSemver = (v = '0.0.0') => {
  const clean = String(v).replace(/[^0-9.]/g, '');
  const parts = clean.split('.').map((p) => parseInt(p, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
};

export const compareSemver = (v1, v2) => {
  const [a1, b1, c1] = parseSemver(v1);
  const [a2, b2, c2] = parseSemver(v2);
  if (a1 !== a2) return a1 > a2 ? 1 : -1;
  if (b1 !== b2) return b1 > b2 ? 1 : -1;
  if (c1 !== c2) return c1 > c2 ? 1 : -1;
  return 0;
};

// ── Deterministic Device ID Rollout Bucket (0 to 99) ─────────────────────────
export const getRolloutBucket = (deviceId = '') => {
  if (!deviceId) return 0;
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) {
    const char = deviceId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash) % 100;
};

// ── Helper to log audits ──────────────────────────────────────────────────────
const logAudit = async ({ versionId, versionString, platform, action, req, changes }) => {
  try {
    await AppVersionAudit.create({
      versionId: versionId || null,
      versionString: versionString || '',
      platform: platform || 'android',
      action,
      performedBy: req.user._id,
      performedByName: req.user.name || req.user.employeeCode || 'Admin',
      changes: changes || {},
    });
  } catch (err) {
    console.error('[AppVersionAudit] Log error:', err);
  }
};

// ── Public: Check Version Status ──────────────────────────────────────────────
export const checkAppVersion = asyncHandler(async (req, res) => {
  const platform = (req.query.platform || 'android').toLowerCase();
  const clientVersion = req.query.version || '1.0.0';
  const deviceId = req.query.deviceId || '';

  // 1. Fetch active version configs for platform
  const activeVersions = await AppVersion.find({ platform, isActive: true })
    .sort({ createdAt: -1 })
    .lean();

  if (!activeVersions || activeVersions.length === 0) {
    return res.status(200).json(
      new ApiResponse(200, {
        updateRequired: false,
        message: 'No active version policy configured for platform.',
      })
    );
  }

  // 2. Check for Maintenance Mode on any active config
  const maintenanceConfig = activeVersions.find((v) => v.maintenanceMode);
  if (maintenanceConfig) {
    return res.status(200).json(
      new ApiResponse(200, {
        updateRequired: true,
        updateType: 'maintenance',
        title: 'App Under Maintenance',
        description: maintenanceConfig.maintenanceMessage || 'The application is currently undergoing scheduled maintenance.',
        maintenanceMode: true,
        updateLink: maintenanceConfig.updateLink,
      })
    );
  }

  // 3. Get the latest active config
  const latestConfig = activeVersions[0];

  // 4. Check if client version is less than minimum required version -> Critical Block
  if (latestConfig.minVersion && compareSemver(clientVersion, latestConfig.minVersion) < 0) {
    return res.status(200).json(
      new ApiResponse(200, {
        updateRequired: true,
        updateType: 'critical',
        title: latestConfig.title || 'Critical Update Required',
        description: latestConfig.description || 'You must update the app to the latest version to continue.',
        updateLink: latestConfig.updateLink,
        releaseNotes: latestConfig.releaseNotes || [],
        minVersion: latestConfig.minVersion,
        latestVersion: latestConfig.version,
        versionCode: latestConfig.versionCode,
        maintenanceMode: false,
      })
    );
  }

  // 5. Check if client version is older than latest release
  if (compareSemver(clientVersion, latestConfig.version) < 0) {
    // Determine rollout eligibility based on deterministic device ID bucket
    const bucket = getRolloutBucket(deviceId);
    const rolloutPercentage = latestConfig.rolloutPercentage ?? 100;

    if (bucket < rolloutPercentage) {
      return res.status(200).json(
        new ApiResponse(200, {
          updateRequired: true,
          updateType: latestConfig.priority || 'recommended',
          title: latestConfig.title || 'New Version Available',
          description: latestConfig.description || 'An update with performance fixes is available.',
          updateLink: latestConfig.updateLink,
          releaseNotes: latestConfig.releaseNotes || [],
          latestVersion: latestConfig.version,
          versionCode: latestConfig.versionCode,
          maintenanceMode: false,
        })
      );
    }
  }

  // 6. Up-to-date or not in rollout group
  res.status(200).json(
    new ApiResponse(200, {
      updateRequired: false,
      latestVersion: latestConfig.version,
      maintenanceMode: false,
    })
  );
});

// ── Public: Get Latest Config ────────────────────────────────────────────────
export const getLatestVersion = asyncHandler(async (req, res) => {
  const platform = (req.query.platform || 'android').toLowerCase();
  const latest = await AppVersion.findOne({ platform, isActive: true })
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json(new ApiResponse(200, latest || null, 'Latest version retrieved'));
});

// ── Admin: Get All Versions ───────────────────────────────────────────────────
export const getAllVersions = asyncHandler(async (req, res) => {
  const versions = await AppVersion.find({}).sort({ createdAt: -1 }).lean();
  res.status(200).json(new ApiResponse(200, versions, 'All versions fetched'));
});

// ── Admin: Create Version Config ──────────────────────────────────────────────
export const createVersion = asyncHandler(async (req, res) => {
  const {
    platform,
    version,
    versionCode,
    minVersion,
    priority,
    updateLink,
    title,
    description,
    releaseNotes,
    isActive,
    maintenanceMode,
    maintenanceMessage,
    rolloutPercentage,
  } = req.body;

  if (!platform || !version || !updateLink) {
    throw new ApiError(400, 'Platform, version, and updateLink are required fields');
  }

  const newVersion = await AppVersion.create({
    platform: platform.toLowerCase(),
    version: version.trim(),
    versionCode: versionCode || 1,
    minVersion: minVersion ? minVersion.trim() : '1.0.0',
    priority: priority || 'optional',
    updateLink: updateLink.trim(),
    title: title ? title.trim() : 'New Update Available',
    description: description ? description.trim() : '',
    releaseNotes: Array.isArray(releaseNotes) ? releaseNotes : [],
    isActive: isActive !== undefined ? Boolean(isActive) : true,
    maintenanceMode: Boolean(maintenanceMode),
    maintenanceMessage: maintenanceMessage ? maintenanceMessage.trim() : '',
    rolloutPercentage: rolloutPercentage !== undefined ? Number(rolloutPercentage) : 100,
  });

  await logAudit({
    versionId: newVersion._id,
    versionString: newVersion.version,
    platform: newVersion.platform,
    action: 'create',
    req,
    changes: newVersion.toObject(),
  });

  res.status(201).json(new ApiResponse(201, newVersion, 'App version created successfully'));
});

// ── Admin: Update Version Config ──────────────────────────────────────────────
export const updateVersion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await AppVersion.findById(id);

  if (!existing) throw new ApiError(404, 'Version config not found');

  const oldData = existing.toObject();

  const fields = [
    'platform',
    'version',
    'versionCode',
    'minVersion',
    'priority',
    'updateLink',
    'title',
    'description',
    'releaseNotes',
    'isActive',
    'maintenanceMode',
    'maintenanceMessage',
    'rolloutPercentage',
  ];

  fields.forEach((f) => {
    if (req.body[f] !== undefined) {
      existing[f] = req.body[f];
    }
  });

  const updated = await existing.save();

  // Diff comparison for audit
  const diffs = {};
  fields.forEach((f) => {
    if (JSON.stringify(oldData[f]) !== JSON.stringify(updated[f])) {
      diffs[f] = { before: oldData[f], after: updated[f] };
    }
  });

  await logAudit({
    versionId: updated._id,
    versionString: updated.version,
    platform: updated.platform,
    action: 'update',
    req,
    changes: diffs,
  });

  res.status(200).json(new ApiResponse(200, updated, 'Version updated successfully'));
});

// ── Admin: Toggle Active (Instant Rollback) ──────────────────────────────────
export const toggleActiveVersion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const version = await AppVersion.findById(id);

  if (!version) throw new ApiError(404, 'Version config not found');

  const oldStatus = version.isActive;
  version.isActive = !oldStatus;
  await version.save();

  await logAudit({
    versionId: version._id,
    versionString: version.version,
    platform: version.platform,
    action: 'toggle_active',
    req,
    changes: { isActive: { before: oldStatus, after: version.isActive } },
  });

  res.status(200).json(
    new ApiResponse(
      200,
      version,
      `Version ${version.version} is now ${version.isActive ? 'active' : 'disabled (rolled back)'}`
    )
  );
});

// ── Admin: Delete Version Config ──────────────────────────────────────────────
export const deleteVersion = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const version = await AppVersion.findByIdAndDelete(id);

  if (!version) throw new ApiError(404, 'Version config not found');

  await logAudit({
    versionId: version._id,
    versionString: version.version,
    platform: version.platform,
    action: 'delete',
    req,
    changes: version.toObject(),
  });

  res.status(200).json(new ApiResponse(200, null, 'Version deleted successfully'));
});

// ── Admin: Get Audit History ─────────────────────────────────────────────────
export const getVersionAudits = asyncHandler(async (req, res) => {
  const audits = await AppVersionAudit.find({})
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  res.status(200).json(new ApiResponse(200, audits, 'Version audit history fetched'));
});
