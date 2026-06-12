require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || 3000);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "uploads");
const publicDir = path.resolve(__dirname, "../public");

fs.mkdirSync(uploadDir, { recursive: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storedName = `${Date.now()}-${safeOriginal}`;
    cb(null, storedName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    next();
  } catch {
    res.status(401).json({ message: "Sesion invalida" });
  }
}

function buildDocumentCode(departmentCode) {
  const year = new Date().getFullYear();
  const sequence = String(Math.floor(Math.random() * 999999)).padStart(6, "0");
  return `${departmentCode}-${year}-${sequence}`;
}
function getFileHash(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query(
    `SELECT users.id, users.username, users.password_hash, users.role, users.must_change_password,
            departments.name AS department_name
       FROM users
       LEFT JOIN departments ON departments.id = users.department_id
      WHERE users.username = $1 AND users.is_active = true`,
    [username],
  );

  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ message: "Credenciales incorrectas" });
  }

  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      department: user.department_name,
    },
    process.env.JWT_SECRET || "dev-secret",
    { expiresIn: "8h" },
  );

  res.json({
    token,
    user: {
      username: user.username,
      role: user.role,
      department: user.department_name,
      mustChangePassword: user.must_change_password,
    },
  });
});

app.get("/api/departments", requireAuth, async (req, res) => {
  const result = await pool.query("SELECT id, name, code FROM departments ORDER BY name");
  res.json(result.rows);
});

app.post("/api/documents", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Archivo requerido" });
  }
  const fileHash = getFileHash(req.file.path);

  const existingFile = await pool.query(
    "SELECT id FROM documents WHERE file_hash = $1",
    [fileHash]
  );

  if (existingFile.rows.length > 0) {
    fs.unlinkSync(req.file.path);
  
    return res.status(400).json({
      message: "Este archivo ya fue subido anteriormente",
    });
  }
  const { departmentId } = req.body;
  const dept = await pool.query("SELECT id, code FROM departments WHERE id = $1", [departmentId]);

  if (!dept.rows[0]) {
    return res.status(400).json({ message: "Departamento invalido" });
  }

  const code = buildDocumentCode(dept.rows[0].code);
  const originalExt = path.extname(req.file.originalname) || path.extname(req.file.filename);
  const storedName = `${code}${originalExt}`;
  const storagePath = path.join(uploadDir, storedName);
  fs.renameSync(req.file.path, storagePath);

  const result = await pool.query(
    `INSERT INTO documents
      (code, original_name, stored_name, mime_type, file_size, storage_path, department_id, uploaded_by, file_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, code, original_name, uploaded_at`,
    [
      code,
      req.file.originalname,
      storedName,
      req.file.mimetype,
      req.file.size,
      storagePath,
      departmentId,
      req.user.id,
      fileHash,
    ],
  );

  await pool.query(
    "INSERT INTO audit_logs (document_id, action, username, details) VALUES ($1, $2, $3, $4)",
    [result.rows[0].id, "upload", req.user.username, { code, originalName: req.file.originalname }],
  );

  res.status(201).json(result.rows[0]);
});

app.get("/api/documents", requireAuth, async (req, res) => {
  const { code, q, departmentId, from, to } = req.query;
  const values = [];
  const where = [];

  if (code) {
    values.push(code);
    where.push(`documents.code = $${values.length}`);
  }

  if (q) {
    values.push(`%${q}%`);
    where.push(`documents.original_name ILIKE $${values.length}`);
  }

  if (departmentId) {
    values.push(departmentId);
    where.push(`documents.department_id = $${values.length}`);
  }

  if (from) {
    values.push(from);
    where.push(`documents.uploaded_at::date >= $${values.length}`);
  }

  if (to) {
    values.push(to);
    where.push(`documents.uploaded_at::date <= $${values.length}`);
  }

  if (req.user.role !== "admin") {
    values.push(req.user.department);
    where.push(`departments.name = $${values.length}`);
  }

  const query = `
    SELECT documents.code,
           documents.original_name,
           documents.mime_type,
           documents.file_size,
           documents.uploaded_at,
           departments.name AS department
      FROM documents
      JOIN departments ON departments.id = documents.department_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY documents.uploaded_at DESC
     LIMIT 100
  `;

  const result = await pool.query(query, values);
  res.json(result.rows);
});

app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
  console.log(`DOCUCONDUESPOL listo en http://localhost:${port}`);
});
