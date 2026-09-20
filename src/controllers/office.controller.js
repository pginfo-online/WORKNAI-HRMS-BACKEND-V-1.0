import { Office } from '../models/Office.model.js';
import { WorkingHours } from '../models/WorkingHours.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { invalidateOfficeCache } from '../services/office.service.js';

// ─── OFFICE CONTROLLERS ───────────────────────────────────────────────────────

export const listOffices = asyncHandler(async (req, res) => {
  const offices = await Office.find()
    .populate('workingHoursId', 'name checkInTime checkOutTime workDays')
    .sort({ isActive: -1, createdAt: -1 })
    .lean();

  res.json(new ApiResponse(200, offices, 'Offices fetched'));
});

export const getActiveOfficeSettings = asyncHandler(async (req, res) => {
  const office = await Office.findOne({ isActive: true })
    .populate('workingHoursId')
    .lean();

  if (!office) throw new ApiError(404, 'No active office configured');
  res.json(new ApiResponse(200, office, 'Active office fetched'));
});

export const createOffice = asyncHandler(async (req, res) => {
  const { name, address, city, state, latitude, longitude, radiusMeters, geoBypassCodes, timezone } = req.body;

  if (!name || latitude == null || longitude == null) {
    throw new ApiError(400, 'name, latitude, and longitude are required');
  }

  const office = await Office.create({
    name,
    address,
    city,
    state,
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    radiusMeters: radiusMeters ? parseInt(radiusMeters) : 200,
    geoBypassCodes: geoBypassCodes || [],
    timezone: timezone || 'Asia/Kolkata',
    createdBy: req.user._id,
  });

  invalidateOfficeCache();
  res.status(201).json(new ApiResponse(201, office, 'Office created'));
});

export const updateOffice = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, address, city, state, latitude, longitude, radiusMeters, workingHoursId, isActive, geoBypassCodes, timezone } = req.body;

  const office = await Office.findById(id);
  if (!office) throw new ApiError(404, 'Office not found');

  if (name) office.name = name;
  if (address !== undefined) office.address = address;
  if (city !== undefined) office.city = city;
  if (state !== undefined) office.state = state;
  if (latitude != null) office.latitude = parseFloat(latitude);
  if (longitude != null) office.longitude = parseFloat(longitude);
  if (radiusMeters != null) office.radiusMeters = parseInt(radiusMeters);
  if (workingHoursId) office.workingHoursId = workingHoursId;
  if (isActive !== undefined) office.isActive = isActive;
  if (geoBypassCodes) office.geoBypassCodes = geoBypassCodes;
  if (timezone) office.timezone = timezone;

  await office.save();
  invalidateOfficeCache();
  res.json(new ApiResponse(200, office, 'Office updated'));
});

export const deleteOffice = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const office = await Office.findByIdAndDelete(id);
  if (!office) throw new ApiError(404, 'Office not found');

  invalidateOfficeCache();
  res.json(new ApiResponse(200, null, 'Office deleted'));
});

// ─── WORKING HOURS CONTROLLERS ────────────────────────────────────────────────

export const listWorkingHours = asyncHandler(async (req, res) => {
  const list = await WorkingHours.find()
    .populate('officeId', 'name')
    .sort({ isDefault: -1, createdAt: -1 })
    .lean();

  res.json(new ApiResponse(200, list, 'Working hours fetched'));
});

export const createWorkingHours = asyncHandler(async (req, res) => {
  const {
    officeId,
    name,
    checkInTime,
    checkOutTime,
    lateGraceMinutes,
    earlyCheckoutGraceMinutes,
    halfDayMinutes,
    fullDayMinutes,
    workDays,
    isDefault,
  } = req.body;

  if (!officeId || !checkInTime || !checkOutTime) {
    throw new ApiError(400, 'officeId, checkInTime, and checkOutTime are required');
  }

  const office = await Office.findById(officeId);
  if (!office) throw new ApiError(404, 'Office not found');

  // If setting as default, unset previous default for this office
  if (isDefault) {
    await WorkingHours.updateMany({ officeId, isDefault: true }, { isDefault: false });
  }

  const wh = await WorkingHours.create({
    officeId,
    name: name || 'Standard Shift',
    checkInTime,
    checkOutTime,
    lateGraceMinutes: lateGraceMinutes != null ? parseInt(lateGraceMinutes) : 0,
    earlyCheckoutGraceMinutes: earlyCheckoutGraceMinutes != null ? parseInt(earlyCheckoutGraceMinutes) : 0,
    halfDayMinutes: halfDayMinutes ? parseInt(halfDayMinutes) : 270,
    fullDayMinutes: fullDayMinutes ? parseInt(fullDayMinutes) : 540,
    workDays: workDays ?? [1, 2, 3, 4, 5, 6],
    isDefault: isDefault ?? false,
    createdBy: req.user._id,
  });

  // Link to office if it's the first/default
  if (isDefault && !office.workingHoursId) {
    office.workingHoursId = wh._id;
    await office.save();
  }

  invalidateOfficeCache();
  res.status(201).json(new ApiResponse(201, wh, 'Working hours created'));
});

export const updateWorkingHours = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const wh = await WorkingHours.findById(id);
  if (!wh) throw new ApiError(404, 'Working hours not found');

  const fields = [
    'name',
    'checkInTime',
    'checkOutTime',
    'lateGraceMinutes',
    'earlyCheckoutGraceMinutes',
    'halfDayMinutes',
    'fullDayMinutes',
    'workDays',
  ];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) wh[f] = req.body[f];
  });

  if (req.body.isDefault === true) {
    await WorkingHours.updateMany({ officeId: wh.officeId, isDefault: true }, { isDefault: false });
    wh.isDefault = true;
    // Update office link
    await Office.findByIdAndUpdate(wh.officeId, { workingHoursId: wh._id });
  }

  await wh.save();
  invalidateOfficeCache();
  res.json(new ApiResponse(200, wh, 'Working hours updated'));
});

export const deleteWorkingHours = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const wh = await WorkingHours.findByIdAndDelete(id);
  if (!wh) throw new ApiError(404, 'Working hours not found');
  invalidateOfficeCache();
  res.json(new ApiResponse(200, null, 'Working hours deleted'));
});
