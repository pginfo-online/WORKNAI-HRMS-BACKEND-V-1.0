import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from './config/db.js';
import { Employee } from './models/Employee.model.js';
import { LeaveBalance } from './models/LeaveBalance.model.js';
import { logger } from './utils/logger.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WORKNAI HRMS — ADMIN & SUPERUSER SEEDER
 * ─────────────────────────────────────────────────────────────────────────────
 * Seeding specifications based on Employee.model.js schema requirements:
 *  - employeeCode: Uppercase, format /^[A-Z]{2}\d{5}$/ (e.g. WA00001)
 *  - password: Plaintext password assigned; pre('save') hook handles bcrypt hashing (cost factor 12)
 *  - role: Valid enum ['SuperUser', 'HR', 'Manager', 'Director', 'VP', 'GM', 'Employee', 'Intern']
 *  - status: ['Active', 'Inactive']
 *  - geoBypass: Set to true for SuperUsers and Core Admins to ensure unrestrained administrative access
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DEFAULT_SUPERUSER_PASSWORD = process.env.SEED_SUPERUSER_PASSWORD || 'SuperUser@123';
const DEFAULT_HR_PASSWORD = process.env.SEED_HR_PASSWORD || 'HRAdmin@123';

const adminAccountsToSeed = [
  // ── 3 SUPERUSER ACCOUNTS ──
  {
    employeeCode: 'WA00001',
    name: 'Primary Super Admin',
    email: 'superuser1@worknai.com',
    mobileNumber: '9999900001',
    password: DEFAULT_SUPERUSER_PASSWORD,
    role: 'SuperUser',
    status: 'Active',
    gender: 'Male',
    department: 'Executive SuperUser',
    position: 'Chief Platform SuperUser',
    joiningDate: new Date('2024-01-01'),
    salary: 250000,
    geoBypass: true,
    experienceType: 'Experienced',
    totalExperienceYears: 10,
  },
  {
    employeeCode: 'WA00002',
    name: 'Technical Super Admin',
    email: 'superuser2@worknai.com',
    mobileNumber: '9999900002',
    password: DEFAULT_SUPERUSER_PASSWORD,
    role: 'SuperUser',
    status: 'Active',
    gender: 'Male',
    department: 'Engineering & Infrastructure',
    position: 'Lead Systems SuperUser',
    joiningDate: new Date('2024-01-01'),
    salary: 220000,
    geoBypass: true,
    experienceType: 'Experienced',
    totalExperienceYears: 8,
  },
  {
    employeeCode: 'WA00003',
    name: 'Operations Super Admin',
    email: 'superuser3@worknai.com',
    mobileNumber: '9999900003',
    password: DEFAULT_SUPERUSER_PASSWORD,
    role: 'SuperUser',
    status: 'Active',
    gender: 'Female',
    department: 'Security & Operations',
    position: 'Operations & Audit SuperUser',
    joiningDate: new Date('2024-01-01'),
    salary: 210000,
    geoBypass: true,
    experienceType: 'Experienced',
    totalExperienceYears: 7,
  },

  // ── HR ADMIN & EXECUTIVE ROLES ──
  {
    employeeCode: 'WA00004',
    name: 'HR Lead Administrator',
    email: 'hr@worknai.com',
    mobileNumber: '9999900004',
    password: DEFAULT_HR_PASSWORD,
    role: 'HR',
    status: 'Active',
    gender: 'Female',
    department: 'Human Resources',
    position: 'Chief HR Officer',
    joiningDate: new Date('2024-01-01'),
    salary: 150000,
    geoBypass: true,
    experienceType: 'Experienced',
    totalExperienceYears: 6,
  },
  {
    employeeCode: 'WA00005',
    name: 'Executive Director',
    email: 'director@worknai.com',
    mobileNumber: '9999900005',
    password: DEFAULT_SUPERUSER_PASSWORD,
    role: 'Director',
    status: 'Active',
    gender: 'Male',
    department: 'Executive',
    position: 'Managing Director',
    joiningDate: new Date('2024-01-01'),
    salary: 280000,
    geoBypass: true,
    experienceType: 'Experienced',
    totalExperienceYears: 12,
  },
  {
    employeeCode: 'WA00006',
    name: 'General Manager',
    email: 'gm@worknai.com',
    mobileNumber: '9999900006',
    password: DEFAULT_SUPERUSER_PASSWORD,
    role: 'GM',
    status: 'Active',
    gender: 'Male',
    department: 'General Management',
    position: 'General Manager',
    joiningDate: new Date('2024-01-01'),
    salary: 180000,
    geoBypass: true,
    experienceType: 'Experienced',
    totalExperienceYears: 9,
  },
];

export const seedAdminRoles = async () => {
  logger.info('🚀 Starting Administrative & SuperUser Seeding Process...');

  const summary = [];

  for (const accountData of adminAccountsToSeed) {
    let employee = await Employee.findOne({
      $or: [{ employeeCode: accountData.employeeCode }, { email: accountData.email }],
    });

    let action = 'CREATED';

    if (employee) {
      action = 'UPDATED';
      logger.info(`ℹ️ Account ${accountData.employeeCode} (${accountData.email}) exists. Updating record...`);
      Object.assign(employee, accountData);
      employee.password = accountData.password; // Triggers pre('save') re-hashing
      await employee.save();
    } else {
      logger.info(`✨ Creating new account ${accountData.employeeCode} [${accountData.role}]...`);
      employee = new Employee(accountData);
      await employee.save();
    }

    // Ensure associated LeaveBalance record exists for flawless dashboard integration
    let leaveBalance = await LeaveBalance.findOne({ employeeId: employee._id });
    if (!leaveBalance) {
      await LeaveBalance.create({
        employeeId: employee._id,
        paidLeaveBalance: 24,
        compOffBalance: 0,
        history: [],
      });
      logger.info(`  └─ Initialized LeaveBalance for ${employee.employeeCode}`);
    }

    summary.push({
      Action: action,
      Code: employee.employeeCode,
      Name: employee.name,
      Email: employee.email,
      Role: employee.role,
      Department: employee.department,
      Password: accountData.password,
    });
  }

  logger.info('✅ SuperUser and Administrative Seeding Completed Successfully!\n');
  console.table(summary);
};

const runSeeder = async () => {
  try {
    await connectDB();
    await seedAdminRoles();
    await mongoose.disconnect();
    logger.info('🔌 Database connection cleanly closed.');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Seeding process failed with error:', error);
    process.exit(1);
  }
};

// Execute if run directly from command line
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  runSeeder();
}
