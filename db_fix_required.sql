-- ============================================================
-- KEEP ONLY REQUIRED SYSTEM FIXES
-- 1) Fix employee department/supervisor data
-- 2) Ensure leave balances exist for current year
-- 3) Ensure leave_documents table and fields exist
-- ============================================================

PROMPT =========================================
PROMPT Step 1: Ensure department exists
PROMPT =========================================
MERGE INTO departments d
USING (
    SELECT 'IT' AS department_code, 'แผนกเทคโนโลยีสารสนเทศ' AS department_name
    FROM dual
) src
ON (d.department_code = src.department_code)
WHEN NOT MATCHED THEN
    INSERT (department_code, department_name)
    VALUES (src.department_code, src.department_name);

COMMIT;

PROMPT =========================================
PROMPT Step 2: Ensure required roles exist
PROMPT =========================================
INSERT INTO employees (
    employee_code,
    first_name,
    last_name,
    username,
    password_hash,
    role,
    position_name,
    department_id,
    supervisor_id,
    email,
    is_active
)
SELECT 'EMP006', 'สมชาย', 'ใจดี', 'supervisor01', 'CHANGE_ME_HASH', 'SUPERVISOR', 'หัวหน้างาน',
       (SELECT department_id FROM departments WHERE department_code = 'IT'),
       NULL,
       'supervisor@example.com', 'Y'
FROM dual
WHERE NOT EXISTS (
    SELECT 1 FROM employees WHERE employee_code = 'EMP006'
);

INSERT INTO employees (
    employee_code,
    first_name,
    last_name,
    username,
    password_hash,
    role,
    position_name,
    department_id,
    supervisor_id,
    email,
    is_active
)
SELECT 'EMP007', 'วิชัย', 'มั่นคง', 'manager01', 'CHANGE_ME_HASH', 'DEPARTMENT_MANAGER', 'หัวหน้าแผนก',
       (SELECT department_id FROM departments WHERE department_code = 'IT'),
       NULL,
       'manager@example.com', 'Y'
FROM dual
WHERE NOT EXISTS (
    SELECT 1 FROM employees WHERE employee_code = 'EMP007'
);

INSERT INTO employees (
    employee_code,
    first_name,
    last_name,
    username,
    password_hash,
    role,
    position_name,
    department_id,
    supervisor_id,
    email,
    is_active
)
SELECT 'EMP008', 'สุดา', 'บริหารงาน', 'hr01', 'CHANGE_ME_HASH', 'HR', 'เจ้าหน้าที่ HR',
       (SELECT department_id FROM departments WHERE department_code = 'IT'),
       NULL,
       'hr@example.com', 'Y'
FROM dual
WHERE NOT EXISTS (
    SELECT 1 FROM employees WHERE employee_code = 'EMP008'
);

UPDATE employees e
SET e.supervisor_id = (
    SELECT s.employee_id
    FROM employees s
    WHERE s.role = 'SUPERVISOR'
      AND s.department_id = e.department_id
      AND s.employee_code = 'EMP006'
)
WHERE e.role = 'EMPLOYEE'
  AND (e.supervisor_id IS NULL OR e.supervisor_id NOT IN (
      SELECT employee_id FROM employees WHERE role = 'SUPERVISOR'
  ));

COMMIT;

PROMPT =========================================
PROMPT Step 3: Ensure leave types exist
PROMPT =========================================
INSERT INTO leave_types (
    leave_type_code,
    leave_type_name,
    requires_reason,
    requires_document,
    max_days_per_year,
    is_active
)
SELECT 'SICK', 'ลาป่วย', 'Y', 'N', NULL, 'Y'
FROM dual
WHERE NOT EXISTS (
    SELECT 1 FROM leave_types WHERE leave_type_code = 'SICK'
);

INSERT INTO leave_types (
    leave_type_code,
    leave_type_name,
    requires_reason,
    requires_document,
    max_days_per_year,
    is_active
)
SELECT 'PERSONAL', 'ลากิจ', 'Y', 'N', NULL, 'Y'
FROM dual
WHERE NOT EXISTS (
    SELECT 1 FROM leave_types WHERE leave_type_code = 'PERSONAL'
);

INSERT INTO leave_types (
    leave_type_code,
    leave_type_name,
    requires_reason,
    requires_document,
    max_days_per_year,
    is_active
)
SELECT 'VACATION', 'ลาพักร้อน', 'N', 'N', NULL, 'Y'
FROM dual
WHERE NOT EXISTS (
    SELECT 1 FROM leave_types WHERE leave_type_code = 'VACATION'
);

INSERT INTO leave_types (
    leave_type_code,
    leave_type_name,
    requires_reason,
    requires_document,
    max_days_per_year,
    is_active
)
SELECT 'OTHER', 'การลาอื่น ๆ', 'Y', 'N', NULL, 'N'
FROM dual
WHERE NOT EXISTS (
    SELECT 1 FROM leave_types WHERE leave_type_code = 'OTHER'
);

UPDATE leave_types
SET is_active = 'N'
WHERE leave_type_code = 'OTHER'
    AND is_active <> 'N';

COMMIT;

PROMPT =========================================
PROMPT Step 4: Ensure leave balances exist for current year
PROMPT =========================================
INSERT INTO leave_balances (
    employee_id,
    leave_type_id,
    leave_year,
    entitled_days,
    used_days,
    remaining_days
)
SELECT e.employee_id,
       lt.leave_type_id,
       EXTRACT(YEAR FROM SYSDATE) AS leave_year,
       CASE lt.leave_type_code
           WHEN 'SICK' THEN 10
           WHEN 'PERSONAL' THEN 6
           WHEN 'VACATION' THEN 10
           ELSE 0
       END AS entitled_days,
       0,
       CASE lt.leave_type_code
           WHEN 'SICK' THEN 10
           WHEN 'PERSONAL' THEN 6
           WHEN 'VACATION' THEN 10
           ELSE 0
       END AS remaining_days
FROM employees e
CROSS JOIN leave_types lt
WHERE e.role = 'EMPLOYEE'
  AND lt.is_active = 'Y'
  AND NOT EXISTS (
      SELECT 1
      FROM leave_balances b
      WHERE b.employee_id = e.employee_id
        AND b.leave_type_id = lt.leave_type_id
        AND b.leave_year = EXTRACT(YEAR FROM SYSDATE)
  );

COMMIT;

PROMPT =========================================
PROMPT Step 5: Ensure leave_documents table exists with required columns
PROMPT =========================================
DECLARE
    v_exists NUMBER;
BEGIN
    SELECT COUNT(*)
      INTO v_exists
      FROM user_tables
     WHERE table_name = 'LEAVE_DOCUMENTS';

    IF v_exists = 0 THEN
        EXECUTE IMMEDIATE '
            CREATE TABLE leave_documents (
                document_id NUMBER GENERATED BY DEFAULT AS IDENTITY,
                leave_request_id NUMBER NOT NULL,
                file_name VARCHAR2(255) NOT NULL,
                file_path VARCHAR2(500) NOT NULL,
                upload_date TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
                CONSTRAINT pk_leave_documents PRIMARY KEY (document_id),
                CONSTRAINT fk_leave_doc_request FOREIGN KEY (leave_request_id) REFERENCES leave_requests(leave_request_id)
            )
        ';
    END IF;
END;
/

DECLARE
    v_count NUMBER;
BEGIN
    SELECT COUNT(*)
      INTO v_count
      FROM user_tab_columns
     WHERE table_name = 'LEAVE_DOCUMENTS'
       AND column_name = 'FILE_NAME';

    IF v_count = 0 THEN
        EXECUTE IMMEDIATE 'ALTER TABLE leave_documents ADD (file_name VARCHAR2(255) NOT NULL)';
    END IF;

    SELECT COUNT(*)
      INTO v_count
      FROM user_tab_columns
     WHERE table_name = 'LEAVE_DOCUMENTS'
       AND column_name = 'FILE_PATH';

    IF v_count = 0 THEN
        EXECUTE IMMEDIATE 'ALTER TABLE leave_documents ADD (file_path VARCHAR2(500) NOT NULL)';
    END IF;

    SELECT COUNT(*)
      INTO v_count
      FROM user_tab_columns
     WHERE table_name = 'LEAVE_DOCUMENTS'
       AND column_name = 'UPLOAD_DATE';

    IF v_count = 0 THEN
        EXECUTE IMMEDIATE 'ALTER TABLE leave_documents ADD (upload_date TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL)';
    END IF;
END;
/

COMMIT;

PROMPT =========================================
PROMPT Required fixes applied.
PROMPT Only required items 2, 3, and 4 were addressed.
PROMPT =========================================
