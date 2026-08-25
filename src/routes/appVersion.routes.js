import { Router } from 'express';
import {
  checkAppVersion,
  getLatestVersion,
  getAllVersions,
  createVersion,
  updateVersion,
  toggleActiveVersion,
  deleteVersion,
  getVersionAudits,
} from '../controllers/appVersion.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { requireRole, MANAGEMENT_ROLES } from '../middleware/role.middleware.js';

const router = Router();

// ── Public Routes (Mobile App Startup) ──
router.get('/check', checkAppVersion);
router.get('/latest', getLatestVersion);

// ── Admin Routes (Protected) ──
router.use(verifyJWT);
router.use(requireRole(MANAGEMENT_ROLES));

router.get('/admin/all', getAllVersions);
router.get('/admin/audits', getVersionAudits);
router.post('/', createVersion);
router.put('/:id', updateVersion);
router.patch('/:id/toggle-active', toggleActiveVersion);
router.delete('/:id', deleteVersion);

export default router;
