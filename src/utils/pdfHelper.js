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
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(d));
  };

  const fromStr = formatUTC(payroll.fromDate);
  const toStr = formatUTC(payroll.toDate);
  const targetMonthName = months[(payroll.month || 1) - 1] || '';
  const targetYear = payroll.year || new Date().getFullYear();

  const titleText = `${fromStr} - ${toStr} : PAYSLIP FOR THE MONTH OF ${targetMonthName.toUpperCase()} ${targetYear}`;

  // --- BRANDING & LOGO (Top-Center with strict bounding box) ---
  const logoPathBack = path.join(__dirname, '../assets/logo.png');
  const logoPathFront = path.join(__dirname, '../../../frontend/src/assets/logo.png');
  let logoToUse = null;
  if (fs.existsSync(logoPathBack)) logoToUse = logoPathBack;
  else if (fs.existsSync(logoPathFront)) logoToUse = logoPathFront;

  if (logoToUse) {
    try {
      // Use fit to preserve aspect ratio within a 160x55 box without vertical spillover
      // A4 page width = 595.28. Centered X = (595.28 - 160) / 2 = 217.64
      doc.image(logoToUse, 217.6, 20, { fit: [160, 55], align: 'center', valign: 'center' });
    } catch (err) {
      console.warn('Could not render logo in PDF:', err.message);
    }
  }

  // --- SALARY SLIP TITLE BAR (Fixed Y at 85 to prevent any logo overlap) ---
  const titleY = 85;
  doc.rect(40, titleY, 515, 24).fill('#f1f5f9');
  doc.fillColor('#0f172a').fontSize(9.5).font('Helvetica-Bold')
     .text(titleText.toUpperCase(), 40, titleY + 7, { align: 'center', width: 515 });

  // --- EMPLOYEE SUMMARY SECTION ---
  const startY = 120;
  const col1 = 45;
  const col2 = 145;
  const col3 = 310;
  const col4 = 410;

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
  const accountNumber = emp.accountNumber || 'N/A';

  // Row 1
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#475569').text('Employee Name:', col1, startY);
  doc.font('Helvetica-Bold').fillColor('#0f172a').text(empName, col2, startY);

  doc.font('Helvetica-Bold').fillColor('#475569').text('Employee ID:', col3, startY);
  doc.font('Helvetica-Bold').fillColor('#0f172a').text(empCode, col4, startY);

  // Row 2
  doc.font('Helvetica-Bold').fillColor('#475569').text('Designation:', col1, startY + 16);
  doc.font('Helvetica').fillColor('#1e293b').text(position, col2, startY + 16);

  doc.font('Helvetica-Bold').fillColor('#475569').text('Department:', col3, startY + 16);
  doc.font('Helvetica').fillColor('#1e293b').text(department, col4, startY + 16);

  // Row 3
  doc.font('Helvetica-Bold').fillColor('#475569').text('Joining Date:', col1, startY + 32);
  doc.font('Helvetica').fillColor('#1e293b').text(joiningDate, col2, startY + 32);

  doc.font('Helvetica-Bold').fillColor('#475569').text('PAN No:', col3, startY + 32);
  doc.font('Helvetica').fillColor('#1e293b').text(panNumber, col4, startY + 32);

  // Row 4
  doc.font('Helvetica-Bold').fillColor('#475569').text('Bank Name:', col1, startY + 48);
  doc.font('Helvetica').fillColor('#1e293b').text(bankName, col2, startY + 48);

  doc.font('Helvetica-Bold').fillColor('#475569').text('Account No:', col3, startY + 48);
  doc.font('Helvetica').fillColor('#1e293b').text(accountNumber, col4, startY + 48);

  // --- ATTENDANCE SUMMARY BOX ---
  const attY = startY + 70;
  doc.rect(40, attY, 515, 42).lineWidth(0.75).stroke('#cbd5e1');

  doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#64748b');
  doc.text('Total Days', 48, attY + 7);
  doc.text('Paid Days', 115, attY + 7);
  doc.text('Present Days', 185, attY + 7);
  doc.text('Half Days', 260, attY + 7);
  doc.text('Paid Leaves', 330, attY + 7);
  doc.text('Hols / WOs', 405, attY + 7);
  doc.text('Absent / LWP', 475, attY + 7);

  doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#0f172a');
  doc.text(`${payroll.totalDaysInMonth || 0}`, 48, attY + 22);
  doc.text(`${payroll.paidDays || 0}`, 115, attY + 22);
  doc.text(`${payroll.presentDays || 0}`, 185, attY + 22);
  doc.text(`${payroll.halfDays || 0}`, 260, attY + 22);
  doc.text(`${payroll.paidLeavesTaken || 0}`, 330, attY + 22);
  doc.text(`${(payroll.holidays || 0) + (payroll.weekOffs || 0)}`, 405, attY + 22);
  doc.text(`${payroll.absentDays || payroll.unpaidLeavesTaken || 0}`, 475, attY + 22);

  // --- EARNINGS & DEDUCTIONS TABLE ---
  const tableY = attY + 54;
  const tableHeight = 120;

  // Table Headers
  doc.rect(40, tableY, 515, 20).fillAndStroke('#e2e8f0', '#cbd5e1');
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

  doc.text('Basic Salary (Fixed)', 50, rowY);
  doc.text(`${baseSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 210, rowY, { width: 80, align: 'right' });

  doc.text('Gross Earned (Paid Days)', 50, rowY + 16);
  doc.text(`${currentGross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 210, rowY + 16, { width: 80, align: 'right' });

  // Deductions Rows
  const pt = parseFloat(payroll.professionalTax || 0);
  const otherDed = parseFloat(payroll.otherDeductions || 0);

  doc.text('Professional Tax (PT)', 310, rowY);
  doc.text(`${pt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 465, rowY, { width: 80, align: 'right' });

  if (otherDed > 0) {
    doc.text(payroll.otherDeductionRemarks || 'Other Deductions', 310, rowY + 16);
    doc.text(`${otherDed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 465, rowY + 16, { width: 80, align: 'right' });
  }

  // Draw Total separator
  doc.moveTo(40, tableY + tableHeight - 24).lineTo(555, tableY + tableHeight - 24).stroke('#cbd5e1');

  // Totals Line (Using 'Rs.' to avoid win-ansi Rupee symbol character corruption)
  doc.font('Helvetica-Bold');
  const totEY = tableY + tableHeight - 18;
  doc.text('Total Gross Earnings', 50, totEY);
  doc.text(`Rs. ${currentGross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 200, totEY, { width: 90, align: 'right' });

  const totDed = pt + otherDed;
  doc.text('Total Deductions', 310, totEY);
  doc.text(`Rs. ${totDed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 455, totEY, { width: 90, align: 'right' });

  // --- NET SALARY HIGHLIGHT BOX ---
  const netY = tableY + tableHeight + 14;
  doc.rect(40, netY, 515, 32).fillAndStroke('#ecfdf5', '#a7f3d0');
  doc.fillColor('#065f46').fontSize(10).font('Helvetica-Bold');
  doc.text('Net Amount Payable:', 50, netY + 10);
  doc.fontSize(12).text(
    `Rs. ${parseFloat(payroll.netSalary || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    350,
    netY + 9,
    { width: 195, align: 'right' }
  );

  // --- NET SALARY IN WORDS ---
  const wordsY = netY + 42;
  doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(8.5);
  doc.text('Amount in Words: ', 40, wordsY, { continued: true });
  doc.font('Helvetica').text(`Rupees ${convertNumberToWords(Math.round(payroll.netSalary || 0))} Only`);

  // --- NOTES / SANDWICH DEDUCTIONS ---
  let noteY = wordsY + 16;
  if (payroll.sandwichDeductions > 0) {
    doc.fillColor('#dc2626').font('Helvetica-Bold').fontSize(8);
    doc.text(`Note: ${payroll.sandwichDeductions} day(s) of Sandwich Leave Deduction applied in this period.`, 40, noteY);
    noteY += 14;
  }

  // --- FOOTER & DISCLAIMER ---
  const footY = Math.max(noteY + 20, 750);
  doc.moveTo(40, footY).lineTo(555, footY).lineWidth(0.5).stroke('#e2e8f0');
  doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8');
  doc.text('This is a computer-generated salary slip and does not require a physical signature.', 40, footY + 8, { align: 'center', width: 515 });
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
