import express from 'express';
import { 
  generatePayroll, 
  generateAllPayroll,
  getPayrollList, 
  getSalarySlip,
  getPayrollSettings,
  savePayrollSettings
} from '../controllers/payroll.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles, MANAGEMENT_ROLES, ADMIN_ROLES, ALL_ROLES } from '../middleware/role.middleware.js';

const router = express.Router();

// ── PROTECTED ALL ──
router.use(verifyJWT);

// ── PAYROLL SETTINGS ──
router.get('/settings', authorizeRoles(...MANAGEMENT_ROLES), getPayrollSettings);
router.post('/settings', authorizeRoles(...ADMIN_ROLES), savePayrollSettings);

// ── ADMIN / HR ONLY ──
router.post('/generate-all', authorizeRoles(...MANAGEMENT_ROLES), generateAllPayroll);

// ── ALL ROLES (With Internal Auth Checks) ──
router.post('/generate', authorizeRoles(...ALL_ROLES), generatePayroll);
router.get('/list', authorizeRoles(...ALL_ROLES), getPayrollList);

// ── INDIVIDUAL SALARY SLIP ACCESS ──
router.get('/salary-slip/:id', getSalarySlip);

export default router;
