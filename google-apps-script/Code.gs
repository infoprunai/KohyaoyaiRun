/**
 * =========================================================================
 * งานวิ่งเปิดโลกทะเล เกาะยาวใหญ่ ประจำปีงบประมาณ ๒๕๗๐
 * เทศบาลตำบลพรุใน อำเภอเกาะยาว จังหวัดพังงา
 * 
 * GOOGLE APPS SCRIPT BACKEND (ฟรี 100% เชื่อมต่อ Google Sheets + Google Drive)
 * =========================================================================
 */

// โฟลเดอร์ใน Google Drive สำหรับเก็บสลิปการโอนเงิน
const SLIP_FOLDER_NAME = "KohYaoRun_Slips_2570";
const SHEET_REGISTRATIONS = "Registrations";
const SHEET_SETTINGS = "Settings";

/**
 * 1. ฟังก์ชันตั้งค่าเริ่มต้น (รันครั้งแรกอัตโนมัติ หรือกดรันเองได้)
 */
function initialSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // สร้าง Sheet Registrations
  let sheetReg = ss.getSheetByName(SHEET_REGISTRATIONS);
  if (!sheetReg) {
    sheetReg = ss.insertSheet(SHEET_REGISTRATIONS);
    const headers = [
      "ID", "Status", "Category", "BIB", "FirstName", "LastName",
      "IDCard", "Gender", "BirthDate", "Age", "AgeGroup", "ShirtSize",
      "Phone", "Email", "BloodType", "EmergencyContact", "EmergencyPhone",
      "MedicalConditions", "SlipDriveUrl", "SlipHash", "Amount",
      "CreatedAt", "ApprovedAt", "AdminNotes"
    ];
    sheetReg.appendRow(headers);
    sheetReg.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#0E7490").setFontColor("#FFFFFF");
    sheetReg.setFrozenRows(1);
  }

  // สร้าง Sheet Settings สำหรับเก็บ Sequence BIB
  let sheetSettings = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheetSettings) {
    sheetSettings = ss.insertSheet(SHEET_SETTINGS);
    sheetSettings.appendRow(["Key", "Value"]);
    sheetSettings.appendRow(["SEQ_5K", 0]);
    sheetSettings.appendRow(["SEQ_10K", 0]);
    sheetSettings.appendRow(["QUOTA_5K", 800]);
    sheetSettings.appendRow(["QUOTA_10K", 700]);
    sheetSettings.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#083344").setFontColor("#FFFFFF");
  }

  // สร้าง Folder ใน Drive ถ้ายังไม่มี
  getOrCreateFolder(SLIP_FOLDER_NAME);
}

/**
 * Helper: หาหรือสร้างโฟลเดอร์ใน Google Drive
 */
function getOrCreateFolder(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(folderName);
}

/**
 * 2. จัดการ GET REQUEST (ดึงข้อมูล, ค้นหา, สรุปสถิติ)
 */
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "getStats";
  let responseData = {};

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_REGISTRATIONS);
    if (!sheet) {
      initialSetup();
    }

    if (action === "getStats") {
      responseData = getSummaryStats();
    } else if (action === "search") {
      const keyword = (e.parameter.keyword || "").trim();
      responseData = searchRunners(keyword);
    } else if (action === "getAll") {
      responseData = getAllRunners();
    } else {
      responseData = { success: false, message: "Action not recognized" };
    }
  } catch (err) {
    responseData = { success: false, error: err.toString() };
  }

  return ContentService.createTextOutput(JSON.stringify(responseData))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 3. จัดการ POST REQUEST (สมัครใหม่, อนุมัติสลิปออกบิบ, ปฏิเสธ, แก้ไขข้อมูล)
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  // ล็อกไม่ให้คนกดชนกัน ป้องกัน Race Condition
  lock.tryLock(10000);

  let responseData = {};

  try {
    let payload = {};
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }

    const action = payload.action;

    if (action === "register") {
      responseData = handleNewRegistration(payload);
    } else if (action === "approve") {
      responseData = handleApproveSlip(payload.id, payload.adminNotes);
    } else if (action === "reject") {
      responseData = handleRejectSlip(payload.id, payload.reason);
    } else if (action === "updateProfile") {
      responseData = handleUpdateProfile(payload.id, payload.updates);
    } else if (action === "resubmitSlip") {
      responseData = handleResubmitSlip(payload.id, payload.base64Slip, payload.slipHash);
    } else {
      responseData = { success: false, message: "Unknown action" };
    }

  } catch (err) {
    responseData = { success: false, error: err.toString() };
  } finally {
    lock.releaseLock();
  }

  return ContentService.createTextOutput(JSON.stringify(responseData))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * บันทึกการสมัครใหม่ (สถานะ PENDING_PAYMENT, ยังไม่มีเลข BIB)
 */
function handleNewRegistration(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_REGISTRATIONS);
  
  // เช็คบัตร ปชช. ซ้ำ
  const cleanIdCard = (data.idCard || "").trim();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][6]).trim() === cleanIdCard) {
      return { 
        success: false, 
        message: `เลขบัตรประชาชน ${cleanIdCard} เคยลงทะเบียนไว้แล้ว (รหัส: ${values[i][0]})` 
      };
    }
  }

  // เซฟรูปสลิปไป Google Drive
  let slipUrl = "";
  if (data.base64Slip) {
    slipUrl = saveSlipToDrive(data.base64Slip, cleanIdCard);
  }

  const count = values.length; // จำนวนแถว
  const regId = `KYR-2570-${String(count).padStart(3, '0')}`;
  const now = new Date().toISOString();

  const newRow = [
    regId,
    "PENDING_PAYMENT", // สถานะเริ่มต้น (ห้ามออก BIB)
    data.category,
    "",                // BIB เป็นค่าว่าง รอแอดมินตรวจ
    data.firstName,
    data.lastName,
    `'${cleanIdCard}`, // เก็บเป็น text
    data.gender,
    data.birthDate,
    data.age,
    data.ageGroup,
    data.shirtSize,
    `'${data.phone}`,
    data.email || "-",
    data.bloodType || "ไม่ระบุ",
    data.emergencyContact,
    `'${data.emergencyPhone}`,
    data.medicalConditions || "ไม่มี",
    slipUrl,
    data.slipHash || "",
    data.amount,
    now,
    "",                // ApprovedAt
    ""                 // AdminNotes
  ];

  sheet.appendRow(newRow);

  return {
    success: true,
    message: "บันทึกการสมัครเรียบร้อยแล้ว รอเจ้าหน้าที่ตรวจสอบสลิป",
    data: {
      id: regId,
      status: "PENDING_PAYMENT",
      firstName: data.firstName,
      lastName: data.lastName,
      category: data.category,
      slipUrl: slipUrl
    }
  };
}

/**
 * อนุมัติสลิป & ออกเลข BIB ต่อเนื่อง (Sequence Lock)
 */
function handleApproveSlip(regId, adminNotes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_REGISTRATIONS);
  const sheetSettings = ss.getSheetByName(SHEET_SETTINGS);

  const values = sheet.getDataRange().getValues();
  let rowIndex = -1;
  let category = "";
  let currentBib = "";

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === regId) {
      rowIndex = i + 1; // 1-based index
      category = values[i][2];
      currentBib = values[i][3];
      break;
    }
  }

  if (rowIndex === -1) {
    return { success: false, message: "ไม่พบรหัสการสมัครนี้" };
  }

  // ถ้ามีบิบอยู่แล้ว
  if (currentBib) {
    return { success: true, bibNumber: currentBib, message: "ได้รับการอนุมัติอยู่แล้ว" };
  }

  // คำนวณ Sequence
  const is5K = (category === "5K");
  const seqKey = is5K ? "SEQ_5K" : "SEQ_10K";
  const prefix = is5K ? "5K-" : "10K-";

  let nextSeq = 1;
  const setValues = sheetSettings.getDataRange().getValues();
  let setRow = -1;
  for (let s = 1; s < setValues.length; s++) {
    if (setValues[s][0] === seqKey) {
      nextSeq = Number(setValues[s][1]) + 1;
      setRow = s + 1;
      break;
    }
  }

  if (setRow !== -1) {
    sheetSettings.getRange(setRow, 2).setValue(nextSeq);
  }

  const bibNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
  const now = new Date().toISOString();

  // อัปเดตใน Sheet: Column 2 (Status), Column 4 (BIB), Column 23 (ApprovedAt), Column 24 (Notes)
  sheet.getRange(rowIndex, 2).setValue("APPROVED");
  sheet.getRange(rowIndex, 4).setValue(bibNumber);
  sheet.getRange(rowIndex, 23).setValue(now);
  sheet.getRange(rowIndex, 24).setValue(adminNotes || "ตรวจสอบยอดเงินและสลิปเรียบร้อย");

  return {
    success: true,
    id: regId,
    bibNumber: bibNumber,
    status: "APPROVED"
  };
}

/**
 * ปฏิเสธสลิป (REJECTED)
 */
function handleRejectSlip(regId, reason) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_REGISTRATIONS);
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === regId) {
      const row = i + 1;
      sheet.getRange(row, 2).setValue("REJECTED");
      sheet.getRange(row, 4).setValue(""); // Clear BIB
      sheet.getRange(row, 24).setValue(reason || "สลิปไม่ถูกต้อง หรือยอดเงินไม่ตรง");
      return { success: true, id: regId, status: "REJECTED" };
    }
  }
  return { success: false, message: "ไม่พบรหัสการสมัครนี้" };
}

/**
 * บันทึกรูปสลิปลง Google Drive
 */
function saveSlipToDrive(base64Data, idCard) {
  const folder = getOrCreateFolder(SLIP_FOLDER_NAME);
  const contentType = base64Data.substring(5, base64Data.indexOf(';'));
  const bytes = Utilities.base64Decode(base64Data.substr(base64Data.indexOf('base64,') + 7));
  const filename = `SLIP_${idCard}_${new Date().getTime()}.jpg`;
  const blob = Utilities.newBlob(bytes, contentType, filename);
  
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  return file.getUrl();
}

/**
 * ค้นหานักวิ่ง (Search)
 */
function searchRunners(keyword) {
  const clean = keyword.toLowerCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_REGISTRATIONS);
  if (!sheet) return { success: true, runners: [] };

  const values = sheet.getDataRange().getValues();
  const results = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const id = String(row[0]);
    const idCard = String(row[6]).replace(/'/g, '');
    const phone = String(row[12]).replace(/'/g, '');
    const name = `${row[4]} ${row[5]}`.toLowerCase();
    const bib = String(row[3]).toLowerCase();

    if (idCard.includes(clean) || phone.includes(clean) || id.toLowerCase().includes(clean) || name.includes(clean) || bib.includes(clean)) {
      results.push(mapRowToRunner(row));
    }
  }

  return { success: true, runners: results };
}

/**
 * ดึงสรุปยอดและสถิติ (Summary Stats)
 */
function getSummaryStats() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_REGISTRATIONS);
  if (!sheet) return { total: 0, count5K: 0, count10K: 0 };

  const values = sheet.getDataRange().getValues();
  let count5K = 0, count10K = 0, approved5K = 0, approved10K = 0;
  let totalIncome = 0, pendingIncome = 0;
  let approvedCount = 0, pendingCount = 0, rejectedCount = 0;

  const shirtSizes = { "XS": 0, "S": 0, "M": 0, "L": 0, "XL": 0, "2XL": 0, "3XL": 0 };

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const status = r[1];
    const cat = r[2];
    const size = r[11];
    const amt = Number(r[20]) || 0;

    if (cat === "5K") count5K++;
    if (cat === "10K") count10K++;

    if (status === "APPROVED") {
      approvedCount++;
      totalIncome += amt;
      if (cat === "5K") approved5K++;
      if (cat === "10K") approved10K++;
      if (shirtSizes[size] !== undefined) shirtSizes[size]++;
    } else if (status === "PENDING_PAYMENT") {
      pendingCount++;
      pendingIncome += amt;
    } else if (status === "REJECTED") {
      rejectedCount++;
    }
  }

  return {
    success: true,
    total: values.length - 1,
    approvedCount,
    pendingCount,
    rejectedCount,
    count5K,
    count10K,
    approved5K,
    approved10K,
    remaining5K: Math.max(0, 800 - count5K),
    remaining10K: Math.max(0, 700 - count10K),
    totalIncome,
    pendingIncome,
    shirtSizes
  };
}

/**
 * ดึงรายชื่อทั้งหมด (Admin)
 */
function getAllRunners() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_REGISTRATIONS);
  if (!sheet) return { success: true, runners: [] };

  const values = sheet.getDataRange().getValues();
  const runners = [];
  for (let i = 1; i < values.length; i++) {
    runners.push(mapRowToRunner(values[i]));
  }
  return { success: true, runners: runners };
}

/**
 * แปลงแถว Sheet เป็น Runner Object
 */
function mapRowToRunner(row) {
  return {
    id: String(row[0]),
    status: String(row[1]),
    category: String(row[2]),
    bibNumber: row[3] ? String(row[3]) : null,
    firstName: String(row[4]),
    lastName: String(row[5]),
    idCard: String(row[6]).replace(/'/g, ''),
    gender: String(row[7]),
    birthDate: String(row[8]),
    age: Number(row[9]),
    ageGroup: String(row[10]),
    shirtSize: String(row[11]),
    phone: String(row[12]).replace(/'/g, ''),
    email: String(row[13]),
    bloodType: String(row[14]),
    emergencyContact: String(row[15]),
    emergencyPhone: String(row[16]).replace(/'/g, ''),
    medicalConditions: String(row[17]),
    slipUrl: String(row[18]),
    slipHash: String(row[19]),
    amount: Number(row[20]),
    createdAt: String(row[21]),
    approvedAt: row[22] ? String(row[22]) : null,
    adminNotes: String(row[23] || "")
  };
}
