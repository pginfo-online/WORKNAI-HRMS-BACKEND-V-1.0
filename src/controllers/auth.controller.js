import { Employee } from '../models/Employee.model.js';
import { LeaveBalance } from '../models/LeaveBalance.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../services/jwt.service.js';
import {
  uploadToCloudinary,
  uploadBase64ToCloudinary,
  getPublicIdFromUrl,
  deleteFromCloudinary,
} from '../services/cloudinary.service.js';
import { upload } from '../middleware/upload.middleware.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
};

const generateTokensForEmployee = async (employee) => {
  const payload = {
    _id: employee._id,
    employeeCode: employee.employeeCode,
    role: employee.role,
    name: employee.name,
  };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken({ _id: employee._id });
  employee.refreshToken = refreshToken;
  await employee.save({ validateBeforeSave: false });
  return { accessToken, refreshToken };
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────

export const login = asyncHandler(async (req, res) => {
  const { employeeCode, password } = req.body;
  if (!employeeCode || !password) throw new ApiError(400, 'Employee code and password are required');

  const code = employeeCode.toUpperCase().trim();
  const user = await Employee.findOne({ employeeCode: code }).select('+password +refreshToken');
  if (!user) throw new ApiError(401, 'Invalid employee code or password');
  if (user.status !== 'Active') throw new ApiError(403, 'Account is deactivated. Contact HR.');

  const isPwdValid = await user.comparePassword(password.trim());
  if (!isPwdValid) throw new ApiError(401, 'Invalid employee code or password');

  const { accessToken, refreshToken } = await generateTokensForEmployee(user);

  // Fetch leave balance separately
  const leaveBalance = await LeaveBalance.findOne({ employeeId: user._id })
    .select('paidLeaveBalance compOffBalance')
    .lean();

  const safeUser = {
    _id: user._id,
    employeeCode: user.employeeCode,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    position: user.position,
    profileImageUrl: user.profileImageUrl || null,
    paidLeaveBalance: leaveBalance?.paidLeaveBalance || 0,
    compOffBalance: leaveBalance?.compOffBalance || 0,
    geoBypass: user.geoBypass || false,
  };

  res
    .status(200)
    .cookie('accessToken', accessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 })
    .cookie('refreshToken', refreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 })
    .json(new ApiResponse(200, { employee: safeUser, accessToken, refreshToken }, 'Login successful'));
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────────

export const logout = asyncHandler(async (req, res) => {
  await Employee.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: 1 } });
  res
    .clearCookie('accessToken', COOKIE_OPTIONS)
    .clearCookie('refreshToken', COOKIE_OPTIONS)
    .json(new ApiResponse(200, null, 'Logged out successfully'));
});

// ─── REFRESH TOKEN ────────────────────────────────────────────────────────────

export const refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body.refreshToken;
  if (!token) throw new ApiError(401, 'Refresh token required');

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const user = await Employee.findById(decoded._id).select('+refreshToken');
  if (!user || user.refreshToken !== token) throw new ApiError(401, 'Invalid refresh token');

  const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await generateTokensForEmployee(user);

  res
    .status(200)
    .cookie('accessToken', newAccessToken, { ...COOKIE_OPTIONS, maxAge: 15 * 60 * 1000 })
    .cookie('refreshToken', newRefreshToken, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 })
    .json(new ApiResponse(200, { accessToken: newAccessToken, refreshToken: newRefreshToken }, 'Token refreshed'));
});

// ─── GET ME ───────────────────────────────────────────────────────────────────

export const getMe = asyncHandler(async (req, res) => {
  const [user, leaveBalance] = await Promise.all([
    Employee.findById(req.user._id).select('-password -refreshToken').lean(),
    LeaveBalance.findOne({ employeeId: req.user._id }).select('paidLeaveBalance compOffBalance').lean(),
  ]);
  if (!user) throw new ApiError(404, 'User not found');

  res.json(new ApiResponse(200, {
    ...user,
    paidLeaveBalance: leaveBalance?.paidLeaveBalance || 0,
    compOffBalance: leaveBalance?.compOffBalance || 0,
  }, 'Profile fetched'));
});

// ─── UPLOAD AVATAR (DEDICATED MEDIA ENDPOINT) ──────────────────────────────────

export const uploadAvatar = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.user._id);
  if (!employee) throw new ApiError(404, 'Employee not found');

  const base64Image =
    req.body.profileImageBase64 ||
    (typeof req.body.profileImage === 'string' && req.body.profileImage.startsWith('data:')
      ? req.body.profileImage
      : null);

  if (!req.file && !base64Image) {
    throw new ApiError(400, 'Profile image file is required');
  }

  // Remove existing Cloudinary photo if exists
  if (employee.profileImageUrl) {
    const oldPublicId = getPublicIdFromUrl(employee.profileImageUrl);
    if (oldPublicId) await deleteFromCloudinary(oldPublicId).catch(() => {});
  }

  let result;
  if (req.file) {
    result = await uploadToCloudinary(req.file.buffer, {
      folder: `hrms/employees/${employee.employeeCode}`,
      public_id: `profile_${Date.now()}`,
    });
  } else if (base64Image) {
    result = await uploadBase64ToCloudinary(base64Image, {
      folder: `hrms/employees/${employee.employeeCode}`,
      public_id: `profile_${Date.now()}`,
    });
  }

  employee.profileImageUrl = result.secure_url;
  await employee.save();

  res.json(
    new ApiResponse(
      200,
      { profileImageUrl: result.secure_url, employee: employee.toSafeObject() },
      'Profile avatar updated successfully'
    )
  );
});

// ─── UPDATE PROFILE (SELF) ────────────────────────────────────────────────────

export const updateProfile = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.user._id);
  if (!employee) throw new ApiError(404, 'Employee not found');

  const allowedSelfEdit = [
    'mobileNumber',
    'alternateMobileNumber',
    'gender',
    'bloodGroup',
    'maritalStatus',
    'fatherName',
    'motherName',
    'currentAddress',
    'permanentAddress',
    'district',
    'state',
    'pincode',
    'emergencyContactName',
    'emergencyContactRelationship',
    'emergencyContactMobile',
    'emergencyContactAddress',
    'profileImageUrl',
  ];

  allowedSelfEdit.forEach((f) => {
    if (req.body[f] !== undefined) {
      employee[f] = req.body[f];
    }
  });

  const base64Image =
    req.body.profileImageBase64 ||
    (typeof req.body.profileImage === 'string' && req.body.profileImage.startsWith('data:')
      ? req.body.profileImage
      : null);

  if (req.file) {
    if (employee.profileImageUrl) {
      const oldPublicId = getPublicIdFromUrl(employee.profileImageUrl);
      if (oldPublicId) await deleteFromCloudinary(oldPublicId).catch(() => {});
    }
    const result = await uploadToCloudinary(req.file.buffer, {
      folder: `hrms/employees/${employee.employeeCode}`,
      public_id: `profile_${Date.now()}`,
    });
    employee.profileImageUrl = result.secure_url;
  } else if (base64Image) {
    if (employee.profileImageUrl) {
      const oldPublicId = getPublicIdFromUrl(employee.profileImageUrl);
      if (oldPublicId) await deleteFromCloudinary(oldPublicId).catch(() => {});
    }
    const result = await uploadBase64ToCloudinary(base64Image, {
      folder: `hrms/employees/${employee.employeeCode}`,
      public_id: `profile_${Date.now()}`,
    });
    employee.profileImageUrl = result.secure_url;
  }

  await employee.save();

  res.json(new ApiResponse(200, employee.toSafeObject(), 'Profile updated successfully'));
});

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────────

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) throw new ApiError(400, 'Both current and new password are required');
  if (newPassword.length < 6) throw new ApiError(400, 'New password must be at least 6 characters');

  const user = await Employee.findById(req.user._id).select('+password');
  if (!user) throw new ApiError(404, 'User not found');

  const isValid = await user.comparePassword(currentPassword);
  if (!isValid) throw new ApiError(400, 'Current password is incorrect');

  user.password = newPassword;
  await user.save();

  res.json(new ApiResponse(200, null, 'Password changed successfully'));
});

// ─── FORGOT PASSWORD (simple code-based reset) ────────────────────────────────

export const forgotPassword = asyncHandler(async (req, res) => {
  const { employeeCode, newPassword } = req.body;
  if (!employeeCode || !newPassword) throw new ApiError(400, 'Employee code and new password are required');
  if (newPassword.length < 6) throw new ApiError(400, 'Password must be at least 6 characters');

  const user = await Employee.findOne({ employeeCode: employeeCode.toUpperCase().trim() });
  if (!user) throw new ApiError(404, 'Account not found');
  if (user.status !== 'Active') throw new ApiError(403, `Account is ${user.status.toLowerCase()}. Contact HR.`);

  user.password = newPassword;
  await user.save();

  res.json(new ApiResponse(200, null, 'Password reset successfully. You can now sign in.'));
});
