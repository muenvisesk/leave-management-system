-- ============================================================
-- LEAVE MANAGEMENT SYSTEM - DATABASE CHECK
-- Run this in Oracle SQL Developer or SQL*Plus
-- ============================================================

PROMPT Check existence of required tables
SELECT table_name
FROM user_tables
WHERE table_name IN (
    'DEPARTMENTS',
    'EMPLOYEES',
    'LEAVE_TYPES',
    'LEAVE_BALANCES',
    'LEAVE_REQUESTS',
    'LEAVE_APPROVALS',
    'LEAVE_CANCELLATIONS',
    'NOTIFICATIONS',
    'LEAVE_DOCUMENTS'
)
ORDER BY table_name;

PROMPT Check required columns for EMPLOYEES
SELECT column_name
FROM user_tab_columns
WHERE table_name = 'EMPLOYEES'
ORDER BY column_id;

PROMPT Check required columns for LEAVE_REQUESTS
SELECT column_name
FROM user_tab_columns
WHERE table_name = 'LEAVE_REQUESTS'
ORDER BY column_id;

PROMPT Check required columns for NOTIFICATIONS
SELECT column_name
FROM user_tab_columns
WHERE table_name = 'NOTIFICATIONS'
ORDER BY column_id;

PROMPT Check required columns for LEAVE_DOCUMENTS
SELECT column_name
FROM user_tab_columns
WHERE table_name = 'LEAVE_DOCUMENTS'
ORDER BY column_id;

PROMPT Check employees missing department or supervisor
SELECT e.employee_code,
       e.first_name,
       e.last_name,
       e.department_id,
       e.supervisor_id
FROM employees e
WHERE e.department_id IS NULL
   OR e.supervisor_id IS NULL
ORDER BY e.employee_code;

PROMPT Check invalid role values
SELECT employee_code, role
FROM employees
WHERE role NOT IN ('EMPLOYEE', 'SUPERVISOR', 'DEPARTMENT_MANAGER', 'HR');

PROMPT Check reminder balances for current year
SELECT e.employee_code,
       lt.leave_type_name,
       b.leave_year,
       b.entitled_days,
       b.used_days,
       b.remaining_days
FROM leave_balances b
JOIN employees e ON e.employee_id = b.employee_id
JOIN leave_types lt ON lt.leave_type_id = b.leave_type_id
WHERE b.leave_year = EXTRACT(YEAR FROM SYSDATE)
ORDER BY e.employee_code, lt.leave_type_id;

PROMPT Check employees without a leave balance this year
SELECT e.employee_code,
       e.first_name,
       e.last_name
FROM employees e
WHERE e.role = 'EMPLOYEE'
AND NOT EXISTS (
    SELECT 1
    FROM leave_balances b
    WHERE b.employee_id = e.employee_id
      AND b.leave_year = EXTRACT(YEAR FROM SYSDATE)
);

PROMPT Check leave requests with invalid status
SELECT request_no, status
FROM leave_requests
WHERE status NOT IN (
    'PENDING_SUPERVISOR',
    'PENDING_DEPARTMENT_MANAGER',
    'APPROVED',
    'REJECTED',
    'CANCELLED'
);

PROMPT Check notifications without title or message text
SELECT notification_id, employee_id, title, message_text
FROM notifications
WHERE title IS NULL OR message_text IS NULL;

PROMPT Check leave document mapping
SELECT ld.document_id,
       ld.leave_request_id,
       ld.file_name,
       lr.request_no
FROM leave_documents ld
LEFT JOIN leave_requests lr ON lr.leave_request_id = ld.leave_request_id
WHERE lr.leave_request_id IS NULL;

PROMPT Check sample login users exist
SELECT employee_code, username, role, password_hash
FROM employees
WHERE employee_code IN ('EMP001', 'EMP006', 'EMP007', 'EMP008')
ORDER BY employee_code;

PROMPT Check if sample leave types exist
SELECT leave_type_code, leave_type_name, is_active
FROM leave_types
ORDER BY leave_type_id;
