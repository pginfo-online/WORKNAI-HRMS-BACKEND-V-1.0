import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const convertNumberToWords = (amount) => {
  const words = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  if (!amount || amount === 0) return "Zero";
  let word = "";
  let tempAmount = Math.floor(amount);
  if (tempAmount >= 10000000) {
    word += convertNumberToWords(Math.floor(tempAmount / 10000000)) + " Crore ";
    tempAmount %= 10000000;
  }
  if (tempAmount >= 100000) {
    word += convertNumberToWords(Math.floor(tempAmount / 100000)) + " Lakh ";
    tempAmount %= 100000;
  }
  if (tempAmount >= 1000) {
    word += convertNumberToWords(Math.floor(tempAmount / 1000)) + " Thousand ";
    tempAmount %= 1000;
  }
  if (tempAmount >= 100) {
    word += convertNumberToWords(Math.floor(tempAmount / 100)) + " Hundred ";
    tempAmount %= 100;
  }
  if (tempAmount > 0) {
    if (word !== "") word += "and ";
    if (tempAmount < 20) word += words[tempAmount];
    else {
      word += tens[Math.floor(tempAmount / 10)] + " ";
      word += words[tempAmount % 10];
    }
  }
  return word.trim();
};

/**
 * Builds the PDFKit document for a given payroll record with proper pixel coordinates,
 * zero overlaps, clean proportions, and standard PDF fonts.
 * @param {Object} payroll - Populated payroll object
 * @param {PDFDocument} doc - PDFKit document instance
 */
export const renderSalarySlipDoc = (payroll, doc) => {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Format dates strictly using UTC
  const formatUTC = (d) => {
    if (!d) return 'N/A';
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(d));
  };

  const fromStr = formatUTC(payroll.fromDate);
  const toStr = formatUTC(payroll.toDate);
  const targetMonthName = months[(payroll.month || 1) - 1] || '';
  const targetYear = payroll.year || new Date().getFullYear();

  // --- BRANDING & CORPORATE HEADER ---
  const logoPathBack = path.join(__dirname, '../assets/logo.png');
  const logoPathFront = path.join(__dirname, '../../../frontend/src/assets/logo.png');
  let logoToUse = null;
  if (fs.existsSync(logoPathBack)) logoToUse = logoPathBack;
  else if (fs.existsSync(logoPathFront)) logoToUse = logoPathFront;

  // Header layout: Logo on left, Company details on right
  if (logoToUse) {
    try {
      doc.image(logoToUse, 40, 24, { fit: [130, 48], align: 'left', valign: 'center' });
    } catch (err) {
      console.warn('Could not render logo in PDF:', err.message);
    }
  }

  // Company Corporate Details (Right Aligned Header)
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#0f172a')
     .text('Worknai Technologies Pvt. Ltd.', 200, 24, { align: 'right', width: 355 });
  doc.fontSize(7.5).font('Helvetica').fillColor('#475569')
     .text('Corporate Office: Baner IT Park, Pune, Maharashtra - 411045', 200, 39, { align: 'right', width: 355 })
     .text('CIN: U72900MH2024PTC123456 | GSTIN: 27AABCU9603R1ZM', 200, 49, { align: 'right', width: 355 })
     .text('Contact: payroll@worknai.com | https://worknai.com', 200, 59, { align: 'right', width: 355 });

  // Divider below company header
  doc.moveTo(40, 75).lineTo(555, 75).lineWidth(1).stroke('#cbd5e1');

  // --- SALARY SLIP TITLE BANNER ---
  const titleY = 82;
  doc.rect(40, titleY, 515, 26).fill('#f8fafc');
  doc.rect(40, titleY, 515, 26).lineWidth(0.5).stroke('#e2e8f0');
  
  const titleLeft = `PAYSLIP FOR ${targetMonthName.toUpperCase()} ${targetYear}`;
  const titleRight = `Pay Period: ${fromStr} to ${toStr}`;
  
  doc.fillColor('#0f172a').fontSize(9.5).font('Helvetica-Bold')
     .text(titleLeft, 50, titleY + 8);
  doc.fillColor('#64748b').fontSize(8.5).font('Helvetica')
     .text(titleRight, 250, titleY + 9, { align: 'right', width: 295 });

  // --- EMPLOYEE & STATUTORY PROFILE MATRIX ---
  const startY = 118;
  const col1 = 48;
  const col2 = 145;
  const col3 = 310;
  const col4 = 405;

  const formatDateShort = (dateString) =>
    dateString
      ? new Intl.DateTimeFormat('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(dateString))
      : 'N/A';

  const emp = payroll.employeeId || {};
  const empName = payroll.employeeName || emp.name || 'N/A';
  const empCode = payroll.employeeCode || emp.employeeCode || 'N/A';
  const position = emp.position || 'N/A';
  const department = payroll.department || emp.department || 'N/A';
  const joiningDate = formatDateShort(emp.joiningDate);
  const panNumber = emp.panNumber || 'N/A';
  const bankName = emp.bankName || 'N/A';
  const rawAccount = emp.accountNumber || '';
  const maskedAccount = rawAccount && rawAccount !== 'N/A' && rawAccount.length > 4
    ? `XXXX-XXXX-${rawAccount.slice(-4)}`
    : (rawAccount || 'N/A');
  const ifsc = emp.ifsc || 'N/A';

  // Profile Card Box
  doc.rect(40, startY - 6, 515, 82).fill('#ffffff');
  doc.rect(40, startY - 6, 515, 82).lineWidth(0.75).stroke('#e2e8f0');

  // Row 1
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b').text('Employee Name:', col1, startY);
  doc.font('Helvetica-Bold').fillColor('#0f172a').text(empName, col2, startY);

  doc.font('Helvetica-Bold').fillColor('#64748b').text('Employee Code:', col3, startY);
  doc.font('Helvetica-Bold').fillColor('#0f172a').text(empCode, col4, startY);

  // Row 2
  doc.font('Helvetica-Bold').fillColor('#64748b').text('Designation:', col1, startY + 15);
  doc.font('Helvetica').fillColor('#1e293b').text(position, col2, startY + 15);

  doc.font('Helvetica-Bold').fillColor('#64748b').text('Department:', col3, startY + 15);
  doc.font('Helvetica').fillColor('#1e293b').text(department, col4, startY + 15);

  // Row 3
  doc.font('Helvetica-Bold').fillColor('#64748b').text('Date of Joining:', col1, startY + 30);
  doc.font('Helvetica').fillColor('#1e293b').text(joiningDate, col2, startY + 30);

  doc.font('Helvetica-Bold').fillColor('#64748b').text('PAN Number:', col3, startY + 30);
  doc.font('Helvetica').fillColor('#1e293b').text(panNumber, col4, startY + 30);

  // Row 4
  doc.font('Helvetica-Bold').fillColor('#64748b').text('Bank Name:', col1, startY + 45);
  doc.font('Helvetica').fillColor('#1e293b').text(bankName, col2, startY + 45);

  doc.font('Helvetica-Bold').fillColor('#64748b').text('Bank Account No:', col3, startY + 45);
  doc.font('Helvetica').fillColor('#1e293b').text(maskedAccount, col4, startY + 45);

  // Row 5
  doc.font('Helvetica-Bold').fillColor('#64748b').text('Bank IFSC Code:', col1, startY + 60);
  doc.font('Helvetica').fillColor('#1e293b').text(ifsc, col2, startY + 60);

  doc.font('Helvetica-Bold').fillColor('#64748b').text('Payment Mode:', col3, startY + 60);
  doc.font('Helvetica').fillColor('#1e293b').text('Direct Bank Transfer', col4, startY + 60);

  // --- ATTENDANCE SUMMARY BOX ---
  const attY = startY + 86;
  doc.rect(40, attY, 515, 44).fill('#f1f5f9');
  doc.rect(40, attY, 515, 44).lineWidth(0.75).stroke('#cbd5e1');

  doc.fontSize(7).font('Helvetica-Bold').fillColor('#64748b');
  doc.text('TOTAL DAYS', 48, attY + 8);
  doc.text('PAID DAYS', 115, attY + 8);
  doc.text('PRESENT', 185, attY + 8);
  doc.text('HALF DAYS', 255, attY + 8);
  doc.text('PAID LEAVES', 325, attY + 8);
  doc.text('HOLS / WOs', 400, attY + 8);
  doc.text('ABSENT / LWP', 472, attY + 8);

  doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a');
  doc.text(`${payroll.totalDaysInMonth || 0}`, 48, attY + 23);
  doc.fillColor('#059669').text(`${payroll.paidDays || 0}`, 115, attY + 23);
  doc.fillColor('#0f172a').text(`${payroll.presentDays || 0}`, 185, attY + 23);
  doc.text(`${payroll.halfDays || 0}`, 255, attY + 23);
  doc.text(`${payroll.paidLeavesTaken || 0}`, 325, attY + 23);
  doc.text(`${Math.max(0, (payroll.holidays || 0) + (payroll.weekOffs || 0) - (payroll.sandwichDeductions || 0))}`, 400, attY + 23);
  doc.fillColor(payroll.absentDays > 0 ? '#dc2626' : '#0f172a').text(`${payroll.absentDays || payroll.unpaidLeavesTaken || 0}`, 472, attY + 23);

  // --- EARNINGS & DEDUCTIONS TABLE ---
  const tableY = attY + 54;
  const tableHeight = 126;

  // Table Headers
  doc.rect(40, tableY, 258, 20).fillAndStroke('#e2e8f0', '#cbd5e1');
  doc.rect(298, tableY, 257, 20).fillAndStroke('#e2e8f0', '#cbd5e1');

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.5);
  doc.text('EARNINGS', 50, tableY + 6);
  doc.text('AMOUNT (INR)', 210, tableY + 6, { width: 80, align: 'right' });
  doc.text('DEDUCTIONS', 310, tableY + 6);
  doc.text('AMOUNT (INR)', 465, tableY + 6, { width: 80, align: 'right' });

  // Draw outer borders and columns
  doc.rect(40, tableY, 515, tableHeight).stroke('#cbd5e1'); // Outer box
  doc.moveTo(298, tableY).lineTo(298, tableY + tableHeight).stroke('#cbd5e1'); // Mid vertical
  doc.moveTo(205, tableY).lineTo(205, tableY + tableHeight).stroke('#e2e8f0'); // Earnings inner
  doc.moveTo(460, tableY).lineTo(460, tableY + tableHeight).stroke('#e2e8f0'); // Deductions inner

  const rowY = tableY + 26;
  doc.font('Helvetica').fontSize(8.5).fillColor('#1e293b');

  // Earnings Rows
  const currentGross = parseFloat(payroll.grossEarnings || 0);
  const baseSalary = parseFloat(payroll.baseSalary || 0);

  doc.text('Basic Salary (Fixed CTC)', 50, rowY);
  doc.text(`${baseSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 210, rowY, { width: 80, align: 'right' });

  doc.text(`Gross Earned (${payroll.paidDays || 0} Paid Days)`, 50, rowY + 18);
  doc.font('Helvetica-Bold').text(`${currentGross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 210, rowY + 18, { width: 80, align: 'right' });

  // Deductions Rows
  doc.font('Helvetica');
  const pt = parseFloat(payroll.professionalTax || 0);
  const otherDed = parseFloat(payroll.otherDeductions || 0);

  doc.text('Professional Tax (PT)', 310, rowY);
  doc.text(`${pt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 465, rowY, { width: 80, align: 'right' });

  let curDedY = rowY + 18;
  if (otherDed > 0) {
    doc.text(payroll.otherDeductionRemarks || 'Other Deductions', 310, curDedY);
    doc.text(`${otherDed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 465, curDedY, { width: 80, align: 'right' });
    curDedY += 18;
  }

  if (payroll.sandwichDeductions > 0) {
    doc.text(`Sandwich Deductions (${payroll.sandwichDeductions} day(s))`, 310, curDedY);
    doc.text('Included in Gross', 430, curDedY, { width: 115, align: 'right' });
  }

  // Draw Total separator
  doc.moveTo(40, tableY + tableHeight - 24).lineTo(555, tableY + tableHeight - 24).stroke('#cbd5e1');

  // Totals Line (Using 'Rs.' for win-ansi font compatibility)
  doc.font('Helvetica-Bold');
  const totEY = tableY + tableHeight - 17;
  doc.text('Total Gross Earnings', 50, totEY);
  doc.fillColor('#059669').text(`Rs. ${currentGross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 200, totEY, { width: 90, align: 'right' });

  const totDed = pt + otherDed;
  doc.fillColor('#0f172a').text('Total Deductions', 310, totEY);
  doc.fillColor(totDed > 0 ? '#dc2626' : '#0f172a').text(`Rs. ${totDed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 455, totEY, { width: 90, align: 'right' });

  // --- NET SALARY HIGHLIGHT BANNER ---
  const netY = tableY + tableHeight + 14;
  doc.rect(40, netY, 515, 36).fillAndStroke('#ecfdf5', '#10b981');
  doc.fillColor('#065f46').fontSize(9.5).font('Helvetica-Bold');
  doc.text('NET TAKE-HOME SALARY:', 52, netY + 12);
  doc.fontSize(13).text(
    `Rs. ${parseFloat(payroll.netSalary || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    340,
    netY + 11,
    { width: 205, align: 'right' }
  );

  // --- NET SALARY IN WORDS ---
  const wordsY = netY + 44;
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.5);
  doc.text('Amount in Words: ', 40, wordsY, { continued: true });
  doc.font('Helvetica').fillColor('#334155').text(`Rupees ${convertNumberToWords(Math.round(payroll.netSalary || 0))} Only`);

  // --- NOTES / COMPLIANCE ---
  let noteY = wordsY + 16;
  if (payroll.sandwichDeductions > 0) {
    doc.fillColor('#dc2626').font('Helvetica-Bold').fontSize(8);
    doc.text(`* Statutory Notice: ${payroll.sandwichDeductions} day(s) of Sandwich Leave Deduction applied in this cycle.`, 40, noteY);
    noteY += 14;
  }

  // --- FOOTER & DISCLAIMER ---
  const footY = Math.max(noteY + 22, 755);
  doc.moveTo(40, footY).lineTo(555, footY).lineWidth(0.5).stroke('#cbd5e1');
  doc.font('Helvetica').fontSize(7.5).fillColor('#64748b');
  doc.text('This is a computer-generated salary slip and does not require a physical signature.', 40, footY + 7, { align: 'center', width: 515 });
  doc.fontSize(6.5).fillColor('#94a3b8')
     .text(`Confidential • Issued by Worknai HRMS • Generated on ${new Date().toLocaleDateString('en-GB')}`, 40, footY + 18, { align: 'center', width: 515 });
};

/**
 * Generates a PDF buffer for a payroll record.
 * @param {Object} payroll - Populated payroll object
 * @returns {Promise<Buffer>}
 */
export const generateSalarySlipPdfBuffer = (payroll) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers = [];

      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
      doc.on('error', (err) => reject(err));

      renderSalarySlipDoc(payroll, doc);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
