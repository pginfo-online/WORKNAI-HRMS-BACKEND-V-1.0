import { Router } from 'express';
import {
  checkIn,
  checkOut,
  trackLocation,
  getTodayStatus,
  getMySummary,
  getAttendanceList,
  requestCorrection,
  approveCorrection,
  getPendingCorrections,
  getEmployeeAttendanceSummary,
} from '../controllers/attendance.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { requireRole, MANAGEMENT_ROLES } from '../middleware/role.middleware.js';

const router = Router();

router.use(verifyJWT);

// ── EMPLOYEE SELF-SERVICE ──
router.post('/check-in', checkIn);
router.post('/check-out', checkOut);
router.post('/track', trackLocation);
router.get('/today', getTodayStatus);
router.get('/my-summary', getMySummary);

// ── CORRECTION ──
router.post('/correction', requestCorrection);
router.get('/corrections/pending', requireRole([...MANAGEMENT_ROLES, 'Manager']), getPendingCorrections);
router.patch('/correction/:id', requireRole([...MANAGEMENT_ROLES, 'Manager']), approveCorrection);

// ── ADMIN / HR ──
router.get('/list', requireRole([...MANAGEMENT_ROLES, 'Manager']), getAttendanceList);
router.get('/employee/:employeeId', requireRole([...MANAGEMENT_ROLES, 'Manager']), getEmployeeAttendanceSummary);

export default router;
