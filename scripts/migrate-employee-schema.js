/**
 * migrate-employee-schema.js
 *
 * Migration script to split the old monolithic Employee document into:
 *   1. LeaveBalance    — paidLeaveBalance, compOffBalance, leaveBalanceHistory
 *   2. EmployeeDocument — all document URL / verification fields
 *   3. EmployeeBankDetails — bank account info
 *
 * Usage:
 *   node backend/scripts/migrate-employee-schema.js
 *
 * IMPORTANT: Take a full MongoDB backup before running.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { config } from '../src/config/index.js';

// ── Import models directly (not via app.js to avoid side effects) ──
import { Employee } from '../src/models/Employee.model.js';
import { LeaveBalance } from '../src/models/LeaveBalance.model.js';
import { EmployeeDocument } from '../src/models/EmployeeDocument.model.js';
import { EmployeeBankDetails } from '../src/models/EmployeeBankDetails.model.js';

const log = (msg) => console.log(`[Migration] ${msg}`);

async function migrate() {
  log('Connecting to MongoDB...');
  await mongoose.connect(config.mongoUri);
  log('Connected. Starting migration...\n');

  // Query old employees with raw driver to access old fields
  const db = mongoose.connection.db;
  const employeesCollection = db.collection('employees');

  const employees = await employeesCollection.find({}).toArray();
  log(`Found ${employees.length} employees to process`);

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const emp of employees) {
    const empId = emp._id;
    try {
      const results = await Promise.allSettled([

        // ── 1. LeaveBalance ──
        (async () => {
          const exists = await LeaveBalance.findOne({ employeeId: empId });
          if (exists) return 'skipped';

          const history = (emp.leaveBalanceHistory || []).map((h) => ({
            type: h.type || 'Addition',
            leaveType: h.leaveType || 'Paid',
            amount: h.amount || 0,
            previousBalance: h.previousBalance || 0,
            newBalance: h.newBalance || 0,
            remarks: h.remarks || '',
            earnedDate: h.earnedDate,
            expiryDate: h.expiryDate,
            isUsed: h.isUsed || false,
            usedDate: h.usedDate,
            createdAt: h.timestamp || new Date(),
          }));

          await LeaveBalance.create({
            employeeId: empId,
            paidLeaveBalance: emp.paidLeaveBalance || 0,
            compOffBalance: emp.compOffBalance || 0,
            history,
          });
          return 'created';
        })(),

        // ── 2. EmployeeDocument ──
        (async () => {
          const exists = await EmployeeDocument.findOne({ employeeId: empId });
          if (exists) return 'skipped';

          await EmployeeDocument.create({
            employeeId: empId,
            aadhaarNumber: emp.aadhaarNumber,
            panNumber: emp.panNumber,
            aadhaarFileUrl: emp.aadhaarFileUrl,
            panFileUrl: emp.panFileUrl,
            passbookFileUrl: emp.passbookFileUrl,
            tenthMarksheetUrl: emp.tenthMarksheetUrl,
            twelfthMarksheetUrl: emp.twelfthMarksheetUrl,
            graduationMarksheetUrl: emp.graduationMarksheetUrl,
            postGraduationMarksheetUrl: emp.postGraduationMarksheetUrl,
            medicalDocumentUrl: emp.medicalDocumentUrl,
            experienceCertificateUrl: emp.experienceCertificateUrl,
            aadhaarVerified: emp.aadhaarVerified || false,
            panVerified: emp.panVerified || false,
          });
          return 'created';
        })(),

        // ── 3. EmployeeBankDetails ──
        (async () => {
          const exists = await EmployeeBankDetails.findOne({ employeeId: empId });
          if (exists) return 'skipped';

          await EmployeeBankDetails.create({
            employeeId: empId,
            accountHolderName: emp.accountHolderName,
            bankName: emp.bankName,
            accountNumber: emp.accountNumber,
            ifsc: emp.ifsc,
            branch: emp.branch,
            bankVerified: emp.bankVerified || false,
            bankVerifiedDate: emp.bankVerifiedDate,
          });
          return 'created';
        })(),
      ]);

      const [lbResult, docResult, bankResult] = results;
      const hasError = results.some((r) => r.status === 'rejected');

      if (hasError) {
        errorCount++;
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            log(`  ERROR [${emp.employeeCode}] operation ${i}: ${r.reason.message}`);
          }
        });
      } else {
        successCount++;
        log(`  ✓ ${emp.employeeCode} (${emp.name}) — LeaveBalance: ${lbResult.value}, Doc: ${docResult.value}, Bank: ${bankResult.value}`);
      }
    } catch (err) {
      errorCount++;
      log(`  ✗ FATAL ERROR for ${emp.employeeCode}: ${err.message}`);
    }
  }

  console.log('\n─── MIGRATION COMPLETE ───');
  console.log(`✓ Processed: ${successCount}`);
  console.log(`⊘ Skipped (already exists): ${skipCount}`);
  console.log(`✗ Errors: ${errorCount}`);
  console.log('\nNext steps:');
  console.log('1. Verify data in LeaveBalance, EmployeeDocuments, EmployeeBankDetails collections');
  console.log('2. Run: db.employees.updateMany({}, { $unset: { paidLeaveBalance:1, compOffBalance:1, leaveBalanceHistory:1, lastLeaveAccrualDate:1, aadhaarNumber:1, panNumber:1, aadhaarFileUrl:1, panFileUrl:1, passbookFileUrl:1, tenthMarksheetUrl:1, twelfthMarksheetUrl:1, graduationMarksheetUrl:1, postGraduationMarksheetUrl:1, medicalDocumentUrl:1, experienceCertificateUrl:1, accountHolderName:1, bankName:1, accountNumber:1, ifsc:1, branch:1, bankVerified:1, bankVerifiedDate:1, fcmToken:1 } })');

  await mongoose.disconnect();
  log('Done. Disconnected.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
