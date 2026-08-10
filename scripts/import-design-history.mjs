import fs from 'node:fs/promises';
import path from 'node:path';
import { db, initializeDatabase, makeId, nowIso } from '../server/dist/db.js';

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!inputPath) {
  console.error('用法：npm run import:design-history -- /absolute/path/derived-records.json');
  process.exit(1);
}

initializeDatabase();
const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const sourceRecords = Array.isArray(input.records) ? input.records : [];
const designerNames = [...new Set(sourceRecords.map((record) => String(record.designer ?? '').trim()).filter(Boolean))];
const employeeQuery = db.prepare('SELECT id, name FROM employee WHERE name = ? AND COALESCE(is_active, 1) = 1 LIMIT 1');
const employees = new Map();
const missingEmployees = [];
for (const name of designerNames) {
  const employee = employeeQuery.get(name);
  if (employee) employees.set(name, employee);
  else missingEmployees.push(name);
}
if (missingEmployees.length > 0) {
  throw new Error(`以下设计部人员未在平台通讯录中找到：${missingEmployees.join('、')}`);
}

const exists = db.prepare('SELECT 1 FROM design_work_record WHERE source = ? AND source_reference = ? LIMIT 1');
const insert = db.prepare(
  `INSERT INTO design_work_record
   (id, employee_id, input_by, project_case_id, work_type_id, association_scope, start_date, end_date,
    work_days, work_content, source, source_sheet, source_reference, record_status, created_at, updated_at)
   VALUES (?, ?, ?, null, null, 'none', ?, ?, null, ?, 'excel_import', ?, ?, 'active', ?, ?)`
);
const sourceSheet = '2026年埃弗尔设计部工作记录.xls';
let insertedRecords = 0;
let skippedRecords = 0;
const importedAt = nowIso();

const transaction = db.transaction(() => {
  for (const record of sourceRecords) {
    const employee = employees.get(String(record.designer ?? '').trim());
    if (!employee) continue;
    const text = String(record.text ?? '').trim();
    if (!text || text === '休息日' || /星期[天日]/.test(text)) continue;
    const sourceReference = `history-2026:${record.designer}:${record.cell}`;
    if (exists.get('excel_import', sourceReference)) {
      skippedRecords += 1;
      continue;
    }
    insert.run(
      makeId('DWR'), employee.id, employee.id,
      record.startDate, record.endDate, text,
      sourceSheet, sourceReference, importedAt, importedAt
    );
    insertedRecords += 1;
  }
});

transaction();
console.log(JSON.stringify({
  source: sourceSheet,
  designers: designerNames.length,
  inserted_records: insertedRecords,
  skipped_existing_records: skippedRecords,
  association_scope: 'none',
  work_days: null
}, null, 2));
