import { Employee } from '../models/Employee.model.js';
import { EmployeeDocument } from '../models/EmployeeDocument.model.js';
import { EmployeeBankDetails } from '../models/EmployeeBankDetails.model.js';
import { LeaveBalance } from '../models/LeaveBalance.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';

// ─── LIST EMPLOYEES ────────────────────────────────────────────────────────────

export const getAllEmployees = asyncHandler(async (req, res) => {
  const { search, status, department, role, page = 1, limit = 20 } = req.query;
  const query = {};

  // Managers only see their direct reports
  if (req.user.role === 'Manager') query.managerIds = req.user._id;

  if (status) query.status = status;
  if (department) query.department = { $regex: department, $options: 'i' };
  if (role) query.role = role;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { employeeCode: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const [employees, total] = await Promise.all([
    Employee.find(query)
      .select('-password -refreshToken')
      .sort({ employeeCode: 1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean(),
    Employee.countDocuments(query),
  ]);

  res.json(new ApiResponse(200, {
    employees,
    data: employees,
    total,
    pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / limit) },
  }, 'Employees fetched'));
});

// ─── GET MANAGEMENT EMPLOYEES ─────────────────────────────────────────────────

export const getManagementEmployees = asyncHandler(async (req, res) => {
  const employees = await Employee.find({
    role: { $in: ['SuperUser', 'HR', 'Manager', 'Director', 'VP', 'GM'] },
    status: 'Active',
  }).select('name employeeCode role profileImageUrl').sort({ name: 1 }).lean();

  res.json(new ApiResponse(200, employees, 'Management employees fetched'));
});

// ─── NEXT CODE ────────────────────────────────────────────────────────────────

export const getNextEmployeeCode = asyncHandler(async (req, res) => {
  const nextCode = await Employee.generateNextCode();
  res.json(new ApiResponse(200, { nextCode }, 'Next employee code generated'));
});

// ─── GET BY ID ────────────────────────────────────────────────────────────────

export const getEmployeeById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const employee = await Employee.findById(id).select('-password -refreshToken').lean();
  if (!employee) throw new ApiError(404, 'Employee not found');

  if (['Employee', 'Intern'].includes(req.user.role) && employee._id.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'Access denied');
  }
  if (req.user.role === 'Manager') {
    const isSelf = employee._id.toString() === req.user._id.toString();
    const isReport = (employee.managerIds || []).some((mId) => mId.toString() === req.user._id.toString());
    if (!isSelf && !isReport) throw new ApiError(403, 'Access denied');
  }

  // Fetch extended info
  const [document, bankDetails, leaveBalance] = await Promise.all([
    EmployeeDocument.findOne({ employeeId: id }).lean(),
    EmployeeBankDetails.findOne({ employeeId: id }).lean(),
    LeaveBalance.findOne({ employeeId: id }).select('paidLeaveBalance compOffBalance').lean(),
  ]);

  res.json(new ApiResponse(200, { ...employee, document, bankDetails, leaveBalance }, 'Employee fetched'));
});

// ─── GET MY PROFILE ────────────────────────────────────────────────────────────

export const getMyProfile = asyncHandler(async (req, res) => {
  const id = req.user._id;
  const [employee, document, bankDetails, leaveBalance] = await Promise.all([
    Employee.findById(id).select('-password -refreshToken').lean(),
    EmployeeDocument.findOne({ employeeId: id }).lean(),
    EmployeeBankDetails.findOne({ employeeId: id }).lean(),
    LeaveBalance.findOne({ employeeId: id }).select('paidLeaveBalance compOffBalance').lean(),
  ]);
  res.json(new ApiResponse(200, { ...employee, document, bankDetails, leaveBalance }, 'Profile fetched'));
});

// ─── CREATE EMPLOYEE (SIMPLIFIED) ────────────────────────────────────────────

export const createEmployee = asyncHandler(async (req, res) => {
  const {
    name, email, mobileNumber, role = 'Employee', department, position,
    joiningDate, salary, password, managerIds, gender, dateOfBirth,
    experienceType, totalExperienceYears, lastCompanyName,
    fatherName, motherName, currentAddress, maritalStatus,
    bloodGroup, emergencyContactName, emergencyContactRelationship, emergencyContactMobile,
  } = req.body;

  // Required fields only
  if (!name || !email || !mobileNumber || !password) {
    throw new ApiError(400, 'name, email, mobileNumber, and password are required');
  }

  const employeeCode = await Employee.generateNextCode();

  // Profile image upload
  let profileImageUrl;
  if (req.files?.profileImage?.[0]) {
    const result = await uploadToCloudinary(req.files.profileImage[0].buffer, {
      folder: `hrms/employees/${employeeCode}`,
      public_id: 'profile',
    });
    profileImageUrl = result.secure_url;
  }

  const employee = await Employee.create({
    employeeCode,
    name, email, mobileNumber, role, department, position,
    joiningDate, salary, password,
    managerIds: managerIds || [],
    gender, dateOfBirth, experienceType,
    totalExperienceYears, lastCompanyName,
    fatherName, motherName, currentAddress, maritalStatus,
    bloodGroup, emergencyContactName, emergencyContactRelationship, emergencyContactMobile,
    profileImageUrl,
    status: 'Active',
  });

  // Create companion documents (empty, to be filled later)
  await Promise.all([
    EmployeeDocument.create({ employeeId: employee._id }),
    EmployeeBankDetails.create({ employeeId: employee._id }),
    LeaveBalance.create({ employeeId: employee._id }),
  ]);

  const safeEmployee = employee.toSafeObject();
  res.status(201).json(new ApiResponse(201, safeEmployee, 'Employee created successfully'));
});

// ─── UPDATE BASIC INFO ────────────────────────────────────────────────────────

export const updateEmployee = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const employee = await Employee.findById(id);
  if (!employee) throw new ApiError(404, 'Employee not found');

  const allowedFields = [
    'name', 'email', 'mobileNumber', 'alternateMobileNumber',
    'gender', 'dateOfBirth', 'bloodGroup', 'maritalStatus',
    'role', 'department', 'position', 'salary', 'joiningDate', 'managerIds',
    'status', 'deactivateReason', 'lastWorkingDate',
    'experienceType', 'totalExperienceYears', 'lastCompanyName',
    'graduationCourse', 'graduationPercent', 'postGraduationCourse', 'postGraduationPercent', 'hscPercent',
    'fatherName', 'motherName', 'currentAddress', 'permanentAddress', 'district', 'state', 'pincode',
    'emergencyContactName', 'emergencyContactRelationship', 'emergencyContactMobile', 'emergencyContactAddress',
    'hasDisease', 'diseaseName', 'geoBypass',
  ];

  allowedFields.forEach((f) => {
    if (req.body[f] !== undefined) employee[f] = req.body[f];
  });

  if (req.files?.profileImage?.[0]) {
    const result = await uploadToCloudinary(req.files.profileImage[0].buffer, {
      folder: `hrms/employees/${employee.employeeCode}`,
      public_id: 'profile',
    });
    employee.profileImageUrl = result.secure_url;
  }

  await employee.save();
  res.json(new ApiResponse(200, employee.toSafeObject(), 'Employee updated'));
});

// ─── UPDATE DOCUMENTS ─────────────────────────────────────────────────────────

export const updateEmployeeDocuments = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const employee = await Employee.findById(id).select('employeeCode').lean();
  if (!employee) throw new ApiError(404, 'Employee not found');

  let doc = await EmployeeDocument.findOne({ employeeId: id });
  if (!doc) doc = new EmployeeDocument({ employeeId: id });

  // Upload files to Cloudinary
  const docFields = [
    { key: 'aadhaarFile', field: 'aadhaarFileUrl', folder: 'aadhaar' },
    { key: 'panFile', field: 'panFileUrl', folder: 'pan' },
    { key: 'passbookFile', field: 'passbookFileUrl', folder: 'passbook' },
    { key: 'tenthMarksheet', field: 'tenthMarksheetUrl', folder: 'education' },
    { key: 'twelfthMarksheet', field: 'twelfthMarksheetUrl', folder: 'education' },
    { key: 'graduationMarksheet', field: 'graduationMarksheetUrl', folder: 'education' },
    { key: 'postGraduationMarksheet', field: 'postGraduationMarksheetUrl', folder: 'education' },
    { key: 'medicalDocument', field: 'medicalDocumentUrl', folder: 'medical' },
    { key: 'experienceCertificate', field: 'experienceCertificateUrl', folder: 'experience' },
  ];

  for (const { key, field, folder } of docFields) {
    if (req.files?.[key]?.[0]) {
      const result = await uploadToCloudinary(req.files[key][0].buffer, {
        folder: `hrms/employees/${employee.employeeCode}/${folder}`,
      });
      doc[field] = result.secure_url;
    }
  }

  // Text fields
  const textFields = ['aadhaarNumber', 'panNumber'];
  textFields.forEach((f) => { if (req.body[f]) doc[f] = req.body[f]; });

  // Verification fields (HR only)
  if (['SuperUser', 'HR'].includes(req.user.role)) {
    ['aadhaarVerified', 'panVerified'].forEach((f) => {
      if (req.body[f] !== undefined) {
        doc[f] = req.body[f];
        if (req.body[f]) doc[`${f.replace('Verified', '')}VerifiedDate`] = new Date();
      }
    });
  }

  await doc.save();
  res.json(new ApiResponse(200, doc, 'Documents updated'));
});

// ─── UPDATE BANK DETAILS ──────────────────────────────────────────────────────

export const updateBankDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!await Employee.findById(id).lean()) throw new ApiError(404, 'Employee not found');

  let bank = await EmployeeBankDetails.findOne({ employeeId: id });
  if (!bank) bank = new EmployeeBankDetails({ employeeId: id });

  const fields = ['accountHolderName', 'bankName', 'accountNumber', 'ifsc', 'branch'];
  fields.forEach((f) => { if (req.body[f]) bank[f] = req.body[f]; });

  if (['SuperUser', 'HR'].includes(req.user.role) && req.body.bankVerified !== undefined) {
    bank.bankVerified = req.body.bankVerified;
    if (req.body.bankVerified) {
      bank.bankVerifiedDate = new Date();
      bank.bankVerifiedBy = req.user._id;
    }
  }

  await bank.save();
  res.json(new ApiResponse(200, bank, 'Bank details updated'));
});

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────

export const resetEmployeePassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters');
  }

  const employee = await Employee.findById(id);
  if (!employee) throw new ApiError(404, 'Employee not found');

  employee.password = newPassword;
  await employee.save();

  res.json(new ApiResponse(200, null, 'Password reset successfully'));
});



// ─── DEACTIVATE / REACTIVATE ──────────────────────────────────────────────────

export const toggleEmployeeStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, deactivateReason, lastWorkingDate } = req.body;

  if (!['Active', 'Inactive'].includes(status)) throw new ApiError(400, 'status must be Active or Inactive');

  const employee = await Employee.findByIdAndUpdate(
    id,
    { status, deactivateReason, lastWorkingDate },
    { new: true }
  ).select('-password -refreshToken');

  if (!employee) throw new ApiError(404, 'Employee not found');
  res.json(new ApiResponse(200, employee, `Employee ${status.toLowerCase()}`));
});