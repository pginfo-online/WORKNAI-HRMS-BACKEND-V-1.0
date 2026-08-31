import express from 'express';
import multer from 'multer';
import {
  login,
  logout,
  refreshToken,
  getMe,
  changePassword,
  updateProfile,
  uploadAvatar,
  forgotPassword,
} from '../controllers/auth.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/logout', verifyJWT, logout);

router.get('/me', verifyJWT, getMe);
router.post('/avatar', verifyJWT, upload.single('avatar'), uploadAvatar);
router.put('/profile', verifyJWT, upload.single('profileImage'), updateProfile);
router.patch('/profile', verifyJWT, upload.single('profileImage'), updateProfile);
router.post('/change-password', verifyJWT, changePassword);
router.patch('/change-password', verifyJWT, changePassword);
router.post('/forgot-password', forgotPassword);


export default router;
