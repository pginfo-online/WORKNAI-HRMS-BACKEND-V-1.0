import { Router } from 'express';
import {
  getAllEmployees,
  getManagementEmployees,
  getNextEmployeeCode,
  getEmployeeById,
  getMyProfile,
  createEmployee,
  updateEmployee,
  updateEmployeeDocuments,
  updateBankDetails,
  resetEmployeePassword,
  toggleEmployeeStatus,
} from '../controllers/employee.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { requireRole, CAN_CREATE_EMPLOYEE, CAN_EDIT_EMPLOYEE, MANAGEMENT_ROLES } from '../middleware/role.middleware.js';
import { upload } from '../middleware/upload.middleware.js';

const router = Router();
router.use(verifyJWT);

// ── LISTING ──
router.get('/', requireRole([...MANAGEMENT_ROLES, 'Manager']), getAllEmployees);
router.get('/management', getManagementEmployees);
router.get('/next-code', requireRole(CAN_CREATE_EMPLOYEE), getNextEmployeeCode);

// ── SELF ──
router.get('/me', getMyProfile);

// ── BY ID ──
router.get('/:id', getEmployeeById);

// ── CREATE ──
router.post('/',
  requireRole(CAN_CREATE_EMPLOYEE),
  upload.fields([{ name: 'profileImage', maxCount: 1 }]),
  createEmployee
);

// ── UPDATE BASIC INFO ──
router.put('/:id',
  requireRole(CAN_EDIT_EMPLOYEE),
  upload.fields([{ name: 'profileImage', maxCount: 1 }]),
  updateEmployee
);

// ── UPDATE DOCUMENTS ──
router.patch('/:id/documents',
  requireRole(CAN_EDIT_EMPLOYEE),
  upload.fields([
    { name: 'aadhaarFile', maxCount: 1 },
    { name: 'panFile', maxCount: 1 },
    { name: 'passbookFile', maxCount: 1 },
    { name: 'tenthMarksheet', maxCount: 1 },
    { name: 'twelfthMarksheet', maxCount: 1 },
    { name: 'graduationMarksheet', maxCount: 1 },
    { name: 'postGraduationMarksheet', maxCount: 1 },
    { name: 'medicalDocument', maxCount: 1 },
    { name: 'experienceCertificate', maxCount: 1 },
  ]),
  updateEmployeeDocuments
);

// ── UPDATE BANK ──
router.patch('/:id/bank', requireRole(CAN_EDIT_EMPLOYEE), updateBankDetails);

// ── RESET PASSWORD ──
router.patch('/:id/reset-password', requireRole(MANAGEMENT_ROLES), resetEmployeePassword);

// ── STATUS TOGGLE ──
router.patch('/:id/status', requireRole([...MANAGEMENT_ROLES]), toggleEmployeeStatus);

export default router;
