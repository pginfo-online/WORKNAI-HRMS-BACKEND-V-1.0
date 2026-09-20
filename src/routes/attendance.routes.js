import { Router } from 'express';
import {
  checkIn,
  checkOut,
  getTodayStatus,
  getMySummary,
  getAttendanceList,
  markReportAsRead,
  requestCorrection,
  editCorrection,
  approveCorrection,
  getPendingCorrections,
  getMyCorrectionHistory,
  getEmployeeAttendanceSummary,
} from '../controllers/attendance.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { requireRole, MANAGEMENT_ROLES } from '../middleware/role.middleware.js';

const router = Router();

router.use(verifyJWT);

// ── EMPLOYEE SELF-SERVICE ──
router.post('/check-in', checkIn);
router.post('/check-out', checkOut);
router.get('/today', getTodayStatus);
router.get('/my-summary', getMySummary);
router.get('/my-corrections', getMyCorrectionHistory);
router.get('/correction-history', getMyCorrectionHistory);

// ── CORRECTION ──
router.post('/correction', requestCorrection);
router.post('/correction/:id', requestCorrection);
router.put('/correction/:id', editCorrection);
router.get('/corrections/pending', requireRole([...MANAGEMENT_ROLES, 'Manager']), getPendingCorrections);
router.patch('/correction/:id', requireRole([...MANAGEMENT_ROLES, 'Manager']), approveCorrection);

// ── ADMIN / HR / MANAGEMENT ──
router.get('/list', requireRole([...MANAGEMENT_ROLES, 'Manager']), getAttendanceList);
router.get('/admin', requireRole([...MANAGEMENT_ROLES, 'Manager']), getAttendanceList);
router.get('/employee-attendance', requireRole([...MANAGEMENT_ROLES, 'Manager']), getAttendanceList);
router.patch('/mark-read/:id', requireRole([...MANAGEMENT_ROLES, 'Manager']), markReportAsRead);
router.get('/employee/:employeeId', requireRole([...MANAGEMENT_ROLES, 'Manager']), getEmployeeAttendanceSummary);

export default router;

