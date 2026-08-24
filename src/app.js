import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import connectDB from './config/db.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';

import authRoutes from './routes/auth.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';
import employeeRoutes from './routes/employee.routes.js';
import leaveRoutes from './routes/leave.routes.js';
import holidayRoutes from './routes/holiday.routes.js';
import payrollRoutes from './routes/payroll.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import officeRoutes from './routes/office.routes.js';
import leaveBalanceRoutes from './routes/leave-balance.routes.js';
import taskRoutes from './routes/task.routes.js';

import { ApiResponse } from './utils/ApiResponse.js';

const app = express();

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────

const getAllowedOrigins = () => {
  const origins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
    process.env.ADDITIONAL_ALLOWED_ORIGINS,
  ].filter(Boolean);

  // Support comma-separated list in origins and strip trailing slashes
  return origins
    .flatMap((o) => o.split(',').map((s) => s.trim()))
    .map((o) => o.replace(/\/+$/, ''));
};

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    const normalizedOrigin = origin.replace(/\/+$/, '');
    if (getAllowedOrigins().includes(normalizedOrigin)) {
      return callback(null, true);
    }
    logger.warn(`CORS blocked: ${origin}`);
    callback(new Error(`Not allowed by CORS policy: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// ─────────────────────────────────────────────────────────────────────────────
// BODY PARSERS
// ─────────────────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ─────────────────────────────────────────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────

const healthCheckHandler = (req, res) => {
  res.json(
    new ApiResponse(200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'WorknAI HRMS API',
      version: '3.0.0',
      env: process.env.NODE_ENV || 'development',
    }, 'Service healthy')
  );
};

app.get('/health', healthCheckHandler);
app.get('/', healthCheckHandler);

// ─────────────────────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/office-settings', officeRoutes);
app.use('/api/leave-balance', leaveBalanceRoutes);
app.use('/api/tasks', taskRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// NOT FOUND
// ─────────────────────────────────────────────────────────────────────────────

app.use(notFoundHandler);

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLER
// ─────────────────────────────────────────────────────────────────────────────

app.use(errorHandler);

export default app;