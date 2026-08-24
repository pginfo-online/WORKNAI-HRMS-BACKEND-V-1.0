import express from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import {
  getMyLeaveBalance,
  getEmployeeLeaveBalance,
  listAllLeaveBalances,
  addPaidLeave,
  adjustLeaveBalance,
} from '../controllers/leaveBalance.controller.js';

const router = express.Router();

router.use(verifyJWT);

// Employee: view own balance
router.get('/me', getMyLeaveBalance);

// HR/Manager: list all employee balances
router.get('/', requireRole(['SuperUser', 'HR', 'Manager', 'Director', 'VP', 'GM']), listAllLeaveBalances);

// HR: add paid leave to employee
router.post('/add', requireRole(['SuperUser', 'HR']), addPaidLeave);

// HR/Manager: view specific employee balance
router.get('/:employeeId', requireRole(['SuperUser', 'HR', 'Manager', 'Director', 'VP', 'GM']), getEmployeeLeaveBalance);

// HR: adjust balance
router.put('/:employeeId', requireRole(['SuperUser', 'HR']), adjustLeaveBalance);

export default router;
