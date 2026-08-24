import express from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import {
  listOffices,
  getActiveOfficeSettings,
  createOffice,
  updateOffice,
  deleteOffice,
  listWorkingHours,
  createWorkingHours,
  updateWorkingHours,
  deleteWorkingHours,
} from '../controllers/office.controller.js';

const router = express.Router();

// All routes require auth
router.use(verifyJWT);

// ── OFFICE ──
router.get('/', listOffices);
router.get('/active', getActiveOfficeSettings);
router.post('/', requireRole(['SuperUser', 'HR']), createOffice);
router.put('/:id', requireRole(['SuperUser', 'HR']), updateOffice);
router.delete('/:id', requireRole(['SuperUser']), deleteOffice);

// ── WORKING HOURS (nested under /office-settings) ──
router.get('/working-hours', listWorkingHours);
router.post('/working-hours', requireRole(['SuperUser', 'HR']), createWorkingHours);
router.put('/working-hours/:id', requireRole(['SuperUser', 'HR']), updateWorkingHours);
router.delete('/working-hours/:id', requireRole(['SuperUser']), deleteWorkingHours);

export default router;
