import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { authorizeRoles } from '../middleware/role.middleware.js';
import {
  createTask,
  getTodaySessionTasks,
  getMyTasks,
  getTaskById,
  updateTask,
  deleteTask,
  batchSyncSessionTasks,
  getAdminTaskList,
  reviewTask,
} from '../controllers/task.controller.js';

const MANAGEMENT_ROLES = ['SuperUser', 'HR', 'Manager', 'Director', 'VP', 'GM'];

const router = Router();
router.use(verifyJWT);

// ── Employee routes ──
router.post('/', createTask);
router.get('/session/today', getTodaySessionTasks);
router.get('/my', getMyTasks);
router.post('/sync-checkout', batchSyncSessionTasks);

// ── Admin routes ──
router.get('/admin/all', authorizeRoles(...MANAGEMENT_ROLES), getAdminTaskList);

// ── Shared routes (employee owner or manager) ──
router.get('/:id', getTaskById);
router.patch('/:id', updateTask);
router.delete('/:id', deleteTask);
router.patch('/:id/review', authorizeRoles(...MANAGEMENT_ROLES), reviewTask);

export default router;
