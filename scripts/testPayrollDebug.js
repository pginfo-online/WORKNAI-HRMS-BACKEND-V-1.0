import 'dotenv/config';
import mongoose from 'mongoose';
import { Employee } from '../src/models/Employee.model.js';
import { Attendance } from '../src/models/Attendance.model.js';
import { processSingleEmployeePayroll } from '../src/controllers/payroll.controller.js';

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const emp = await Employee.findOne({ employeeCode: 'WA00001' });
    console.log('Employee WA00001:', emp ? { id: emp._id, name: emp.name, code: emp.employeeCode, joiningDate: emp.joiningDate } : 'NOT FOUND');

    if (emp) {
      const atts = await Attendance.find({
        $or: [{ employeeId: emp._id }, { employeeCode: emp.employeeCode }]
      }).limit(10).lean();
      console.log('Attendance Records Count:', atts.length);
      console.log('Sample Attendance Records:', atts.map(a => ({ id: a._id, empCode: a.employeeCode, empId: a.employeeId, date: a.date, status: a.status, inTime: a.inTime, outTime: a.outTime, totalHours: a.totalHours, totalMinutes: a.totalMinutes })));

      const fromDate = new Date('2026-08-01T00:00:00Z');
      const toDate = new Date('2026-08-20T23:59:59Z');
      const payroll = await processSingleEmployeePayroll({
        employeeId: emp._id,
        fromDate,
        toDate,
        targetMonth: 8,
        targetYear: 2026,
        processedBy: emp._id
      });
      console.log('Calculated Payroll Result:', {
        totalDays: payroll.totalDaysInMonth,
        presentDays: payroll.presentDays,
        absentDays: payroll.absentDays,
        weekOffs: payroll.weekOffs,
        holidays: payroll.holidays,
        paidLeaves: payroll.paidLeavesTaken,
        sandwichDeductions: payroll.sandwichDeductions,
        paidDays: payroll.paidDays,
        netSalary: payroll.netSalary,
        absentDayDetails: payroll.absentDayDetails,
        presentDayDetails: payroll.presentDayDetails
      });
    }
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await mongoose.disconnect();
  }
};

run();
