require("dotenv").config();
const express = require("express");
const cors = require("cors");
const oracledb = require("oracledb");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const ExcelJS = require("exceljs");

const app = express();
app.use(cors());
app.use(express.json());
const frontendDirectory = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendDirectory));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const uploadDirectory = path.join(__dirname, "..", "private_uploads");
const allowedFileTypes = new Map([
  [".pdf", ["application/pdf"]],
  [".jpg", ["image/jpeg"]],
  [".jpeg", ["image/jpeg"]],
  [".png", ["image/png"]],
  [".webp", ["image/webp"]],
  [".gif", ["image/gif"]],
  [".heic", ["image/heic", "image/heif"]],
  [".heif", ["image/heif", "image/heic"]],
  [".doc", ["application/msword"]],
  [".docx", ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
  [".xls", ["application/vnd.ms-excel"]],
  [".xlsx", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]]
]);

fs.mkdirSync(uploadDirectory, { recursive: true });

const leaveDocumentUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, callback) => {
      const extension = path.posix.extname(file.originalname.replace(/\\/g, "/")).toLowerCase();
      callback(null, `${crypto.randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, callback) => {
    const extension = path.posix.extname(file.originalname.replace(/\\/g, "/")).toLowerCase();
    const mimeTypes = allowedFileTypes.get(extension);
    if (!mimeTypes || !mimeTypes.includes(file.mimetype)) {
      return callback(new Error("รองรับเฉพาะรูปภาพ PDF และไฟล์ Word/Excel"));
    }
    callback(null, true);
  }
}).array("documents", 5);

async function removeUploadedFiles(files = []) {
  await Promise.all(files.map(file => fs.promises.unlink(file.path).catch(() => {})));
}

function parseLeaveDocuments(req, res, next) {
  leaveDocumentUpload(req, res, error => {
    if (!error) return next();
    removeUploadedFiles(req.files).finally(() => {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "ไฟล์ต้องมีขนาดไม่เกิน 10 MB"
        : error.code === "LIMIT_FILE_COUNT"
          ? "แนบไฟล์ได้ไม่เกิน 5 ไฟล์"
          : error.message;
      res.status(400).json({ message });
    });
  });
}

let pool;

async function initDb() {
  pool = await oracledb.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING,
    poolMin: 1,
    poolMax: 5,
    poolIncrement: 1
  });
  console.log("Oracle connected:", process.env.DB_CONNECT_STRING);
}

async function query(sql, binds = {}, options = {}) {
  const conn = await pool.getConnection();
  try {
    return await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: false,
      ...options
    });
  } finally {
    await conn.close();
  }
}

async function getEmployee(employeeId) {
  const result = await query(`
    SELECT employee_id, employee_code, first_name, last_name,
           username, role, position_name, department_id,
           supervisor_id, email, is_active
    FROM employees
    WHERE employee_id = :employeeId
  `, { employeeId });
  return result.rows[0];
}

async function canViewApprovalDocuments(requestId, approverId) {
  const result = await query(`
    SELECT a.employee_id AS approver_id, a.role AS approver_role,
           a.department_id AS approver_department_id,
           e.supervisor_id, e.department_id AS employee_department_id,
           lr.status
    FROM leave_requests lr
    JOIN employees e ON e.employee_id = lr.employee_id
    JOIN employees a ON a.employee_id = :approverId
    WHERE lr.leave_request_id = :requestId
  `, { requestId, approverId });
  const scope = result.rows[0];
  if (!scope) return false;

  if (scope.APPROVER_ROLE === "SUPERVISOR") {
    return scope.STATUS === "PENDING_SUPERVISOR" &&
      Number(scope.SUPERVISOR_ID) === Number(scope.APPROVER_ID);
  }
  if (scope.APPROVER_ROLE === "DEPARTMENT_MANAGER") {
    return scope.STATUS === "PENDING_DEPARTMENT_MANAGER" &&
      Number(scope.EMPLOYEE_DEPARTMENT_ID) === Number(scope.APPROVER_DEPARTMENT_ID);
  }
  return false;
}

// ---------- Login ----------
app.post("/api/login", async (req, res) => {
  try {
    const { employeeCode, password } = req.body;
    if (!employeeCode || !password) {
      return res.status(400).json({ message: "กรุณากรอก ID และ Password" });
    }

    const result = await query(`
      SELECT employee_id, employee_code, first_name, last_name,
             username, password_hash, role, position_name,
             department_id, supervisor_id, email, is_active
      FROM employees
      WHERE UPPER(employee_code) = UPPER(:employeeCode)
    `, { employeeCode });

    if (!result.rows.length) {
      return res.status(401).json({ message: "ไม่พบผู้ใช้งาน" });
    }

    const user = result.rows[0];

    if (user.IS_ACTIVE !== "Y") {
      return res.status(403).json({ message: "บัญชีนี้ถูกปิดใช้งาน" });
    }

    // DEMO ONLY:
    // The provided schema uses CHANGE_ME_HASH for sample users.
    // Until real password hashing is added, allow 1234 for that demo value.
    const passwordOk =
      (user.PASSWORD_HASH === "CHANGE_ME_HASH" && password === "1234") ||
      user.PASSWORD_HASH === password;

    if (!passwordOk) {
      return res.status(401).json({ message: "Password ไม่ถูกต้อง" });
    }

    delete user.PASSWORD_HASH;
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ---------- Dashboard ----------
app.get("/api/dashboard/:employeeId", async (req, res) => {
  try {
    const employeeId = Number(req.params.employeeId);
    const employee = await getEmployee(employeeId);
    if (!employee) return res.status(404).json({ message: "ไม่พบพนักงาน" });

    if (employee.ROLE === "SUPERVISOR" || employee.ROLE === "DEPARTMENT_MANAGER") {
      const scope = employee.ROLE === "SUPERVISOR"
        ? "e.supervisor_id = :employeeId AND e.employee_id <> :employeeId"
        : "e.department_id = :departmentId AND e.employee_id <> :employeeId";
      const binds = { employeeId };
      if (employee.ROLE === "DEPARTMENT_MANAGER") binds.departmentId = employee.DEPARTMENT_ID;
      const pendingStatus = employee.ROLE === "SUPERVISOR"
        ? "PENDING_SUPERVISOR"
        : "PENDING_DEPARTMENT_MANAGER";

      const [all, pending, approved, employees, recent, unread] = await Promise.all([
        query(`SELECT COUNT(*) AS CNT FROM leave_requests lr JOIN employees e ON e.employee_id = lr.employee_id WHERE ${scope}`, binds),
        query(`SELECT COUNT(*) AS CNT FROM leave_requests lr JOIN employees e ON e.employee_id = lr.employee_id WHERE ${scope} AND lr.status = :pendingStatus`, { ...binds, pendingStatus }),
        query(`SELECT COUNT(*) AS CNT FROM leave_requests lr JOIN employees e ON e.employee_id = lr.employee_id WHERE ${scope} AND lr.status = 'APPROVED'`, binds),
        query(`SELECT COUNT(*) AS CNT FROM employees e WHERE ${scope} AND e.is_active = 'Y'`, binds),
        query(`
          SELECT * FROM (
            SELECT lr.request_no, e.employee_code, e.first_name, e.last_name,
                   lt.leave_type_name, lr.start_date, lr.end_date, lr.status
            FROM leave_requests lr
            JOIN employees e ON e.employee_id = lr.employee_id
            JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
            WHERE ${scope}
            ORDER BY lr.submitted_at DESC
          ) WHERE ROWNUM <= 5
        `, binds),
        query(`SELECT COUNT(*) AS CNT FROM notifications WHERE employee_id = :employeeId AND is_read = 'N'`, { employeeId })
      ]);

      return res.json({
        employee,
        stats: {
          total: all.rows[0].CNT,
          pending: pending.rows[0].CNT,
          approved: approved.rows[0].CNT,
          employeeCount: employees.rows[0].CNT,
          unread: unread.rows[0].CNT
        },
        recent: recent.rows
      });
    }

    const [all, pending, approved, balance, recent, unread] = await Promise.all([
      query(`SELECT COUNT(*) AS CNT FROM leave_requests WHERE employee_id = :employeeId`, { employeeId }),
      query(`SELECT COUNT(*) AS CNT FROM leave_requests WHERE employee_id = :employeeId AND status LIKE 'PENDING%'`, { employeeId }),
      query(`SELECT COUNT(*) AS CNT FROM leave_requests WHERE employee_id = :employeeId AND status = 'APPROVED'`, { employeeId }),
      query(`SELECT NVL(SUM(remaining_days),0) AS DAYS FROM leave_balances WHERE employee_id = :employeeId AND leave_year = EXTRACT(YEAR FROM SYSDATE)`, { employeeId }),
      query(`
        SELECT * FROM (
          SELECT lr.request_no, lt.leave_type_name,
                 lr.start_date, lr.end_date, lr.leave_days, lr.status
          FROM leave_requests lr
          JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
          WHERE lr.employee_id = :employeeId
          ORDER BY lr.submitted_at DESC
        ) WHERE ROWNUM <= 5
      `, { employeeId }),
      query(`SELECT COUNT(*) AS CNT FROM notifications WHERE employee_id = :employeeId AND is_read = 'N'`, { employeeId })
    ]);

    res.json({
      employee,
      stats: {
        total: all.rows[0].CNT,
        pending: pending.rows[0].CNT,
        approved: approved.rows[0].CNT,
        remainingDays: balance.rows[0].DAYS,
        unread: unread.rows[0].CNT
      },
      recent: recent.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ---------- Leave Status ----------
app.get("/api/leave/status", async (req, res) => {
  try {
    const rawViewerId = String(req.query.viewer_id || req.query.employee_id || "").trim();
    if (!rawViewerId) {
      return res.status(400).json({ message: "กรุณาระบุ viewer_id" });
    }

    let viewerId;
    if (/^\d+$/.test(rawViewerId)) {
      viewerId = Number(rawViewerId);
    } else {
      const emp = await query(`
        SELECT employee_id
        FROM employees
        WHERE UPPER(employee_code) = UPPER(:employeeCode)
      `, { employeeCode: rawViewerId });
      if (!emp.rows.length) {
        return res.status(404).json({ message: "ไม่พบพนักงาน " + rawViewerId });
      }
      viewerId = emp.rows[0].EMPLOYEE_ID;
    }

    const viewerResult = await query(`
      SELECT employee_id, role, department_id
      FROM employees
      WHERE employee_id = :viewerId
    `, { viewerId });
    const viewer = viewerResult.rows[0];
    if (!viewer) return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });

    let scope;
    const binds = { viewerId };
    if (viewer.ROLE === "EMPLOYEE") {
      scope = "lr.employee_id = :viewerId";
    } else if (viewer.ROLE === "SUPERVISOR") {
      scope = "e.supervisor_id = :viewerId AND e.employee_id <> :viewerId";
    } else if (viewer.ROLE === "DEPARTMENT_MANAGER") {
      scope = "e.department_id = :departmentId AND e.employee_id <> :viewerId";
      binds.departmentId = viewer.DEPARTMENT_ID;
    } else if (viewer.ROLE === "HR") {
      scope = "e.employee_id <> :viewerId";
    } else {
      return res.status(403).json({ message: "ไม่มีสิทธิ์ดูสถานะการลา" });
    }

    const result = await query(`
      SELECT
        lr.leave_request_id,
        lr.request_no,
        e.employee_code,
        e.first_name,
        e.last_name,
        lt.leave_type_name,
        lr.start_date,
        lr.end_date,
        lr.leave_days,
        lr.reason,
        lr.status
      FROM leave_requests lr
      JOIN employees e ON e.employee_id = lr.employee_id
      JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
      WHERE ${scope}
      ORDER BY lr.submitted_at DESC
    `, binds);

    res.json(result.rows);
  } catch (err) {
    console.error("Leave Status Error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ---------- Leave Types / Balance ----------
app.get("/api/leave-types", async (req, res) => {
  try {
    const result = await query(`
      SELECT leave_type_id, leave_type_code, leave_type_name,
             requires_reason, requires_document, max_days_per_year
      FROM leave_types
      WHERE is_active = 'Y'
      ORDER BY leave_type_id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/balances/:employeeId", async (req, res) => {
  try {
    const result = await query(`
      SELECT lb.balance_id, lt.leave_type_name,
             lb.leave_year, lb.entitled_days, lb.used_days, lb.remaining_days
      FROM leave_balances lb
      JOIN leave_types lt ON lt.leave_type_id = lb.leave_type_id
      WHERE lb.employee_id = :employeeId
        AND lb.leave_year = EXTRACT(YEAR FROM SYSDATE)
      ORDER BY lb.balance_id
    `, { employeeId: Number(req.params.employeeId) });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------- Employee Leave ----------
app.get("/api/leave-requests/:employeeId", async (req, res) => {
  try {
    const result = await query(`
      SELECT lr.leave_request_id, lr.request_no,
             lt.leave_type_name, lr.start_date, lr.end_date,
             lr.start_time, lr.end_time, lr.leave_days,
             lr.reason, lr.attachment_path, lr.status,
             lr.submitted_at, lr.cancelled_at, lr.cancel_reason
      FROM leave_requests lr
      JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
      WHERE lr.employee_id = :employeeId
      ORDER BY lr.submitted_at DESC
    `, { employeeId: Number(req.params.employeeId) });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/leave-requests", parseLeaveDocuments, async (req, res) => {
  const {
    employeeId, leaveTypeId, startDate, endDate,
    startTime, endTime, leaveDays, reason
  } = req.body;
  const uploadedFiles = req.files || [];
  const attachmentPath = uploadedFiles.length
    ? path.relative(__dirname, uploadedFiles[0].path).split(path.sep).join("/")
    : null;
  let conn;
  try {
    conn = await pool.getConnection();
    const requestNoResult = await conn.execute(`
      SELECT 'LR' || TO_CHAR(SYSDATE, 'YYYY') ||
             LPAD(NVL(MAX(TO_NUMBER(SUBSTR(request_no, 7))), 0) + 1, 4, '0') AS REQUEST_NO
      FROM leave_requests
      WHERE request_no LIKE 'LR' || TO_CHAR(SYSDATE, 'YYYY') || '%'
    `, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    const requestNo = requestNoResult.rows[0].REQUEST_NO;

    await conn.execute(`
      INSERT INTO leave_requests (
        request_no, employee_id, leave_type_id,
        start_date, end_date, start_time, end_time,
        leave_days, reason, attachment_path, status, submitted_at
      ) VALUES (
        :requestNo, :employeeId, :leaveTypeId,
        TO_DATE(:startDate, 'YYYY-MM-DD'),
        TO_DATE(:endDate, 'YYYY-MM-DD'),
        :startTime, :endTime,
        :leaveDays, :reason, :attachmentUrl,
        'PENDING_SUPERVISOR', SYSTIMESTAMP
      )
    `, {
      requestNo, employeeId: Number(employeeId), leaveTypeId: Number(leaveTypeId),
      startDate, endDate,
      startTime: startTime || null, endTime: endTime || null,
      leaveDays: Number(leaveDays), reason: reason || null,
      attachmentUrl: attachmentPath
    });

    if (uploadedFiles.length) {
      const leaveRequestResult = await conn.execute(`
        SELECT leave_request_id
        FROM leave_requests
        WHERE request_no = :requestNo
      `, { requestNo }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

      for (const file of uploadedFiles) {
        const fileName = file.originalname.replace(/\\/g, "/").split("/").pop().slice(0, 255) || "attachment";
        const filePath = path.relative(__dirname, file.path).split(path.sep).join("/");
        await conn.execute(`
          INSERT INTO leave_documents (
            leave_request_id, file_name, file_path
          ) VALUES (
            :leaveRequestId, :fileName, :filePath
          )
        `, {
          leaveRequestId: leaveRequestResult.rows[0].LEAVE_REQUEST_ID,
          fileName,
          filePath
        });
      }
    }

    await conn.execute(`
      INSERT INTO notifications (
        employee_id, leave_request_id, notification_type,
        title, message_text, is_read, created_at
      )
      SELECT supervisor_id, leave_request_id,
             'LEAVE_NEW', 'มีใบลาใหม่',
             'มีใบลาใหม่ ' || request_no || ' รอการอนุมัติ',
             'N', SYSTIMESTAMP
      FROM leave_requests lr
      JOIN employees e ON e.employee_id = lr.employee_id
      WHERE lr.request_no = :requestNo
        AND e.supervisor_id IS NOT NULL
    `, { requestNo });

    await conn.commit();
    res.json({ message: "ส่งใบลาเรียบร้อย", requestNo });
  } catch (err) {
    if (conn) await conn.rollback();
    await removeUploadedFiles(uploadedFiles);
    console.error(err);
    res.status(500).json({ message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});

app.patch("/api/leave-requests/:requestId/cancel", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const employeeId = Number(req.body.employeeId);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      return res.status(400).json({ message: "ไม่พบข้อมูลพนักงานที่ยื่นคำขอยกเลิก" });
    }

    const result = await conn.execute(`
      UPDATE leave_requests
      SET status = 'CANCELLED',
          cancelled_at = SYSTIMESTAMP,
          cancel_reason = :reason
      WHERE leave_request_id = :requestId
        AND employee_id = :employeeId
        AND status LIKE 'PENDING%'
    `, {
      requestId: Number(req.params.requestId),
      employeeId,
      reason: req.body.reason || "ยกเลิกการลา"
    });

    if (result.rowsAffected === 0) {
      await conn.rollback();
      return res.status(400).json({ message: "ยกเลิกไม่ได้ ใบลาอาจไม่ใช่ของคุณหรือไม่ได้อยู่ในสถานะรออนุมัติ" });
    }

    await conn.commit();
    res.json({ message: "ยกเลิกใบลาเรียบร้อย" });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    await conn.close();
  }
});

// ---------- Notifications ----------
app.get("/api/notifications/:employeeId", async (req, res) => {
  try {
    const result = await query(`
      SELECT notification_id, leave_request_id,
             notification_type, title, message_text,
             is_read, created_at
      FROM notifications
      WHERE employee_id = :employeeId
      ORDER BY created_at DESC
    `, { employeeId: Number(req.params.employeeId) });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch("/api/notifications/:id/read", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      UPDATE notifications
      SET is_read = 'Y'
      WHERE notification_id = :id
    `, { id: Number(req.params.id) });
    await conn.commit();
    res.json({ message: "อ่านแล้ว" });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    await conn.close();
  }
});

// ---------- Approvals ----------
app.get("/api/approvals/:employeeId", async (req, res) => {
  try {
    const approver = await getEmployee(Number(req.params.employeeId));
    if (!approver) return res.status(404).json({ message: "ไม่พบผู้อนุมัติ" });

    let where = "";
    let binds = {};

    if (approver.ROLE === "SUPERVISOR") {
      where = `lr.status = 'PENDING_SUPERVISOR' AND e.supervisor_id = :approverId`;
      binds.approverId = approver.EMPLOYEE_ID;
    } else if (approver.ROLE === "DEPARTMENT_MANAGER") {
      where = `lr.status = 'PENDING_DEPARTMENT_MANAGER' AND e.department_id = :departmentId`;
      binds.departmentId = approver.DEPARTMENT_ID;
    } else if (approver.ROLE === "HR") {
      where = `1 = 1`;
    } else {
      return res.json([]);
    }

    const result = await query(`
      SELECT lr.leave_request_id, lr.request_no,
             e.employee_code, e.first_name, e.last_name,
             lt.leave_type_name, lr.start_date, lr.end_date,
              lr.leave_days, lr.reason, lr.status,
              (SELECT COUNT(*) FROM leave_documents ld
          WHERE ld.leave_request_id = lr.leave_request_id) AS document_count
      FROM leave_requests lr
      JOIN employees e ON e.employee_id = lr.employee_id
      JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
      WHERE ${where}
      ORDER BY lr.submitted_at DESC
    `, binds);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/approvals/:requestId/documents", async (req, res) => {
  try {
    const requestId = Number(req.params.requestId);
    const approverId = Number(req.query.approverId);
    if (!await canViewApprovalDocuments(requestId, approverId)) {
      return res.status(403).json({ message: "ไม่มีสิทธิ์ดูเอกสารใบลานี้" });
    }

    const result = await query(`
      SELECT document_id, file_name
      FROM leave_documents
      WHERE leave_request_id = :requestId
      ORDER BY upload_date
    `, { requestId });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/approvals/:requestId/documents/:documentId", async (req, res) => {
  try {
    const requestId = Number(req.params.requestId);
    const documentId = Number(req.params.documentId);
    const approverId = Number(req.query.approverId);
    if (!await canViewApprovalDocuments(requestId, approverId)) {
      return res.status(403).json({ message: "ไม่มีสิทธิ์ดูเอกสารใบลานี้" });
    }

    const result = await query(`
      SELECT file_name, file_path
      FROM leave_documents
      WHERE document_id = :documentId
        AND leave_request_id = :requestId
    `, { documentId, requestId });
    const document = result.rows[0];
    if (!document) return res.status(404).json({ message: "ไม่พบเอกสารแนบ" });

    if (/^https?:\/\//i.test(document.FILE_PATH)) {
      return res.redirect(document.FILE_PATH);
    }

    const filePath = path.resolve(__dirname, document.FILE_PATH);
    const relativePath = path.relative(uploadDirectory, filePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return res.status(404).json({ message: "ไม่พบไฟล์เอกสาร" });
    }

    res.type(filePath);
    res.sendFile(filePath, error => {
      if (error && !res.headersSent) {
        res.status(error.statusCode || 404).json({ message: "ไม่พบไฟล์เอกสาร" });
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/approvals/:requestId", async (req, res) => {
  const { approverId, action, comment } = req.body;
  const requestId = Number(req.params.requestId);

  const conn = await pool.getConnection();
  try {
    const approverResult = await conn.execute(`
      SELECT employee_id, role, department_id
      FROM employees
      WHERE employee_id = :approverId
    `, { approverId: Number(approverId) }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    const approver = approverResult.rows[0];
    if (!approver) return res.status(404).json({ message: "ไม่พบผู้อนุมัติ" });

    const reqResult = await conn.execute(`
      SELECT lr.leave_request_id, lr.employee_id, lr.leave_type_id,
             lr.status, lr.leave_days, e.supervisor_id, e.department_id
      FROM leave_requests lr
      JOIN employees e ON e.employee_id = lr.employee_id
      WHERE lr.leave_request_id = :requestId
      FOR UPDATE
    `, { requestId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    const lr = reqResult.rows[0];
    if (!lr) return res.status(404).json({ message: "ไม่พบใบลา" });

    let level;
    let nextStatus;

    if (approver.ROLE === "SUPERVISOR" &&
        lr.STATUS === "PENDING_SUPERVISOR" &&
        lr.SUPERVISOR_ID === approver.EMPLOYEE_ID) {
      level = 1;
      nextStatus = action === "APPROVED" ? "PENDING_DEPARTMENT_MANAGER" : "REJECTED";
    } else if (approver.ROLE === "DEPARTMENT_MANAGER" &&
               lr.STATUS === "PENDING_DEPARTMENT_MANAGER" &&
               lr.DEPARTMENT_ID === approver.DEPARTMENT_ID) {
      level = 2;
      nextStatus = action === "APPROVED" ? "APPROVED" : "REJECTED";
    } else {
      return res.status(403).json({ message: "ไม่มีสิทธิ์ดำเนินการกับใบลานี้" });
    }

   await conn.execute(`
  INSERT INTO leave_approvals (
    leave_request_id,
    approver_id,
    approval_level,
    action,
    comment_text,
    action_at
  ) VALUES (
    :requestId,
    :approverId,
    :approvalLevel,
    :approvalAction,
    :commentText,
    SYSTIMESTAMP
  )
`, {
  requestId,
  approverId: Number(approverId),
  approvalLevel: level,
  approvalAction: action,
  commentText: comment || null
});

    await conn.execute(`
      UPDATE leave_requests
      SET status = :nextStatus
      WHERE leave_request_id = :requestId
    `, { nextStatus, requestId });

    if (action === "APPROVED" && level === 2) {
      await conn.execute(`
        UPDATE leave_balances
        SET used_days = used_days + :days,
            remaining_days = remaining_days - :days
        WHERE employee_id = :employeeId
          AND leave_type_id = :leaveTypeId
          AND leave_year = EXTRACT(YEAR FROM SYSDATE)
      `, {
        days: Number(lr.LEAVE_DAYS),
        employeeId: lr.EMPLOYEE_ID,
        leaveTypeId: lr.LEAVE_TYPE_ID
      });
    }

    const title = action === "APPROVED" ? "อนุมัติการลา" : "ไม่อนุมัติการลา";
    const msg = action === "APPROVED"
      ? `ใบลาได้รับการอนุมัติ ${level === 1 ? "ขั้นหัวหน้างาน" : "เรียบร้อยแล้ว"}`
      : "ใบลาของคุณไม่ได้รับการอนุมัติ";

   await conn.execute(`
  INSERT INTO notifications (
    employee_id,
    leave_request_id,
    notification_type,
    title,
    message_text,
    is_read,
    created_at
  ) VALUES (
    :employeeId,
    :requestId,
    :notificationType,
    :notificationTitle,
    :notificationMessage,
    'N',
    SYSTIMESTAMP
  )
`, {
  employeeId: lr.EMPLOYEE_ID,
  requestId,
  notificationType:
    action === "APPROVED"
      ? "LEAVE_APPROVED"
      : "LEAVE_REJECTED",
  notificationTitle: title,
  notificationMessage: msg
});

    await conn.commit();
    res.json({ message: "บันทึกผลการอนุมัติแล้ว", status: nextStatus });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: err.message });
  } finally {
    await conn.close();
  }
});

// ---------- HR ----------
app.get("/api/hr/summary", async (req, res) => {
  try {
    const [employees, pending, approved, rejected, cancelled] = await Promise.all([
      query(`SELECT COUNT(*) AS CNT FROM employees WHERE is_active = 'Y'`),
      query(`SELECT COUNT(*) AS CNT FROM leave_requests WHERE status LIKE 'PENDING%'`),
      query(`SELECT COUNT(*) AS CNT FROM leave_requests WHERE status = 'APPROVED'`),
      query(`SELECT COUNT(*) AS CNT FROM leave_requests WHERE status = 'REJECTED'`),
      query(`SELECT COUNT(*) AS CNT FROM leave_requests WHERE status = 'CANCELLED'`)
    ]);
    res.json({
      employees: employees.rows[0].CNT,
      pending: pending.rows[0].CNT,
      approved: approved.rows[0].CNT,
      rejected: rejected.rows[0].CNT,
      cancelled: cancelled.rows[0].CNT
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/hr/employees", async (req, res) => {
  try {
    const result = await query(`
      SELECT employee_id, employee_code, first_name, last_name,
             department_id, role, is_active
      FROM employees
      WHERE is_active = 'Y'
      ORDER BY department_id, employee_code
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/hr/balances", async (req, res) => {
  try {
    const result = await query(`
      SELECT e.employee_id, e.employee_code, e.first_name, e.last_name,
             e.department_id, lb.leave_year, lt.leave_type_name,
             lb.entitled_days, lb.used_days, lb.remaining_days
      FROM leave_balances lb
      JOIN employees e ON e.employee_id = lb.employee_id
      JOIN leave_types lt ON lt.leave_type_id = lb.leave_type_id
      WHERE e.is_active = 'Y'
        AND lb.leave_year = EXTRACT(YEAR FROM SYSDATE)
      ORDER BY e.department_id, e.employee_code, lt.leave_type_id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/hr/requests", async (req, res) => {
  try {
    const result = await query(`
      SELECT lr.leave_request_id, lr.request_no, e.employee_id,
             e.employee_code, e.first_name, e.last_name,
             e.department_id, lt.leave_type_name,
             lr.start_date, lr.end_date, lr.leave_days,
             lr.reason, lr.status, lr.submitted_at,
             (SELECT comment_text
                FROM (
                  SELECT la.comment_text
                  FROM leave_approvals la
                  WHERE la.leave_request_id = lr.leave_request_id
                    AND la.action = 'REJECTED'
                  ORDER BY la.action_at DESC
                )
               WHERE ROWNUM = 1) AS rejection_reason
      FROM leave_requests lr
      JOIN employees e ON e.employee_id = lr.employee_id
      JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
      ORDER BY lr.submitted_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/hr/export", async (req, res) => {
  try {
    const where = [];
    const binds = {};
    if (req.query.department && req.query.department !== "ALL") {
      const departmentId = Number(req.query.department);
      if (!Number.isInteger(departmentId) || departmentId <= 0) {
        return res.status(400).json({ message: "รหัสแผนกไม่ถูกต้อง" });
      }
      where.push("e.department_id = :departmentId");
      binds.departmentId = departmentId;
    }
    if (req.query.employee && req.query.employee !== "ALL") {
      const employeeId = Number(req.query.employee);
      if (!Number.isInteger(employeeId) || employeeId <= 0) {
        return res.status(400).json({ message: "รหัสพนักงานไม่ถูกต้อง" });
      }
      where.push("e.employee_id = :employeeId");
      binds.employeeId = employeeId;
    }

    const result = await query(`
      SELECT lr.request_no, e.employee_code, e.first_name, e.last_name,
             e.department_id, lt.leave_type_name,
             TO_CHAR(lr.start_date, 'YYYY-MM-DD') AS start_date,
             TO_CHAR(lr.end_date, 'YYYY-MM-DD') AS end_date,
             lr.leave_days, lr.status
      FROM leave_requests lr
      JOIN employees e ON e.employee_id = lr.employee_id
      JOIN leave_types lt ON lt.leave_type_id = lr.leave_type_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY lr.submitted_at DESC
    `, binds);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Leave Management System";
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet("รายงานการลา", {
      views: [{ state: "frozen", ySplit: 1 }]
    });
    worksheet.columns = [
      { header: "เลขที่ใบลา", key: "requestNo", width: 20 },
      { header: "พนักงาน", key: "employee", width: 34 },
      { header: "แผนก", key: "department", width: 12 },
      { header: "ประเภท", key: "leaveType", width: 20 },
      { header: "วันที่เริ่ม", key: "startDate", width: 16, style: { numFmt: "dd/mm/yyyy" } },
      { header: "วันที่สิ้นสุด", key: "endDate", width: 16, style: { numFmt: "dd/mm/yyyy" } },
      { header: "จำนวนวัน", key: "leaveDays", width: 14, style: { numFmt: "0.##" } },
      { header: "สถานะ", key: "status", width: 24 }
    ];

    const statusLabels = {
      PENDING_SUPERVISOR: "รอหัวหน้างาน",
      PENDING_DEPARTMENT_MANAGER: "รอหัวหน้าแผนก",
      APPROVED: "อนุมัติแล้ว",
      REJECTED: "ไม่อนุมัติ",
      CANCELLED: "ยกเลิก"
    };
    result.rows.forEach(row => {
      worksheet.addRow({
        requestNo: row.REQUEST_NO,
        employee: `${row.EMPLOYEE_CODE} ${row.FIRST_NAME} ${row.LAST_NAME}`.trim(),
        department: row.DEPARTMENT_ID,
        leaveType: row.LEAVE_TYPE_NAME,
        startDate: row.START_DATE ? new Date(`${row.START_DATE}T00:00:00.000Z`) : null,
        endDate: row.END_DATE ? new Date(`${row.END_DATE}T00:00:00.000Z`) : null,
        leaveDays: Number(row.LEAVE_DAYS),
        status: statusLabels[row.STATUS] || row.STATUS
      });
    });

    const header = worksheet.getRow(1);
    header.height = 26;
    header.eachCell(cell => {
      cell.font = { name: "Leelawadee UI", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF514235" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, worksheet.rowCount), column: worksheet.columnCount }
    };
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      row.height = 22;
      row.eachCell(cell => {
        cell.font = { name: "Leelawadee UI", size: 10, color: { argb: "FF463A30" } };
        cell.alignment = { vertical: "middle" };
        cell.border = { bottom: { style: "hair", color: { argb: "FFE8DFD4" } } };
        if (rowNumber % 2 === 0) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAF7F1" } };
        }
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="hr_leave_report.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Excel export failed:", err);
    res.status(500).json({ message: "ส่งออกไฟล์ Excel ไม่สำเร็จ" });
  }
});

// ---------- Fallback ----------
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDirectory, "index.html"));
});

initDb()
  .then(() => app.listen(PORT, HOST, () => {
    console.log(`Leave Management System: http://localhost:${PORT}`);
    console.log(`Network access: http://0.0.0.0:${PORT}`);
  }))
  .catch(err => {
    console.error("Database connection failed:", err);
    process.exit(1);
  });
