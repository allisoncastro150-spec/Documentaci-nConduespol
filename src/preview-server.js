const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const port = Number(process.env.PORT || 3000);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(rootDir, "data");
const uploadDir = path.join(rootDir, "uploads");
const dbPath = path.join(dataDir, "app-db.json");
const adminDeleteKey = process.env.ADMIN_DELETE_KEY || "ADMINISTRADOR_Eliminar";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
};

const sessions = new Map();

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function initialDb() {
  return {
    departments: [
      { id: "sg", name: "Secretaria General", code: "SG" },
      { id: "af", name: "Activos Fijos", code: "AF" },
      { id: "ec", name: "Educacion Continua", code: "EC" },
      { id: "ti", name: "TICS", code: "TI" },
      { id: "co", name: "Comercio", code: "CO" },
      { id: "cc", name: "CallCenter", code: "CC" },
    ],
    users: [
      {
        id: crypto.randomUUID(),
        username: "admin",
        passwordHash: hashPassword("admin2026"),
        role: "admin",
        department: "TODOS",
        active: true,
      },
      {
        id: crypto.randomUUID(),
        username: "secretaria01",
        passwordHash: hashPassword("Temp2026"),
        role: "user",
        department: "Secretaria General",
        active: true,
      },
    ],
    documents: [],
    counters: {},
  };
}

function readDb() {
  if (!fs.existsSync(dbPath)) {
    const db = initialDb();
    writeDb(db);
    return db;
  }

  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) {
      reject(new Error("No multipart boundary"));
      return;
    }

    const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const fields = {};
      let file = null;
      let offset = body.indexOf(boundary);

      while (offset !== -1) {
        offset += boundary.length;
        if (body.slice(offset, offset + 2).toString() === "--") break;
        if (body.slice(offset, offset + 2).toString() === "\r\n") offset += 2;

        const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), offset);
        if (headerEnd === -1) break;

        const headerText = body.slice(offset, headerEnd).toString("utf8");
        const nextBoundary = body.indexOf(boundary, headerEnd + 4);
        if (nextBoundary === -1) break;

        let content = body.slice(headerEnd + 4, nextBoundary);
        if (content.slice(-2).toString() === "\r\n") content = content.slice(0, -2);

        const nameMatch = headerText.match(/name="([^"]+)"/);
        const filenameMatch = headerText.match(/filename="([^"]*)"/);
        const typeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
        const name = nameMatch ? nameMatch[1] : "";

        if (filenameMatch && filenameMatch[1]) {
          file = {
            field: name,
            originalName: path.basename(filenameMatch[1]),
            mimeType: typeMatch ? typeMatch[1].trim() : "application/octet-stream",
            buffer: content,
            size: content.length,
          };
        } else if (name) {
          fields[name] = content.toString("utf8");
        }

        offset = nextBoundary;
      }

      resolve({ fields, file });
    });
    req.on("error", reject);
  });
}

function currentUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : new URL(req.url, `http://localhost:${port}`).searchParams.get("token");
  return token ? sessions.get(token) : null;
}

function requireAuth(req, res) {
  const user = currentUser(req);
  if (!user) {
    sendJson(res, 401, { message: "Inicia sesion para continuar." });
    return null;
  }
  return user;
}

function nextCode(db, departmentName) {
  const department = db.departments.find((item) => item.name === departmentName) || db.departments[0];
  const year = new Date().getFullYear();
  const key = `${department.code}-${year}`;
  db.counters[key] = (db.counters[key] || 0) + 1;
  return `${key}-${String(db.counters[key]).padStart(6, "0")}`;
}

function visibleDocuments(db, user) {
  if (user.role === "admin") return db.documents;
  return db.documents.filter((doc) => doc.department === user.department);
}

function sameDay(dateA, dateB) {
  return dateA.slice(0, 10) === dateB.slice(0, 10);
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await parseJsonBody(req);
    const db = readDb();
    const user = db.users.find((item) => item.username === body.username && item.active);

    if (!user || user.passwordHash !== hashPassword(body.password)) {
      sendJson(res, 401, { message: "Credenciales incorrectas." });
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const safeUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      department: user.department,
    };
    sessions.set(token, safeUser);
    sendJson(res, 200, { token, user: safeUser });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token) sessions.delete(token);
    sendJson(res, 200, { ok: true });
    return;
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method === "GET" && url.pathname === "/api/session") {
    sendJson(res, 200, { user });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/departments") {
    sendJson(res, 200, readDb().departments);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stats") {
    const db = readDb();
    const docs = visibleDocuments(db, user);
    const today = new Date().toISOString();
    sendJson(res, 200, {
      documents: docs.length,
      departments: db.departments.length,
      uploadedToday: docs.filter((doc) => sameDay(doc.uploadedAt, today)).length,
      users: db.users.filter((item) => item.active).length,
      recent: docs.slice().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).slice(0, 8),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/documents") {
    const db = readDb();
    const code = (url.searchParams.get("code") || "").toLowerCase();
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const department = url.searchParams.get("department") || "";
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";

    const docs = visibleDocuments(db, user).filter((doc) => {
      const docDate = doc.uploadedAt.slice(0, 10);
      return (
        (!code || doc.code.toLowerCase().includes(code)) &&
        (!q || doc.originalName.toLowerCase().includes(q) || (doc.description || "").toLowerCase().includes(q)) &&
        (!department || doc.department === department) &&
        (!from || docDate >= from) &&
        (!to || docDate <= to)
      );
    });

    sendJson(res, 200, docs.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/documents") {
    const db = readDb();
    const { fields, file } = await parseMultipart(req);

    if (!file) {
      sendJson(res, 400, { message: "Selecciona un archivo." });
      return;
    }
    const existingDocument = db.documents.find(
      (doc) =>
        doc.originalName.toLowerCase() === file.originalName.toLowerCase()
    );
    
    if (existingDocument) {
      sendJson(res, 400, {
        message: "Este archivo ya fue subido anteriormente."
      });
      return;
    }

    const department = user.role === "admin" ? fields.department : user.department;
    if (!db.departments.some((item) => item.name === department)) {
      sendJson(res, 400, { message: "Departamento invalido." });
      return;
    }

    const code = nextCode(db, department);
    const ext = path.extname(file.originalName) || "";
    const storedName = `${code}${ext}`;
    const storagePath = path.join(uploadDir, storedName);
    fs.writeFileSync(storagePath, file.buffer);

    const document = {
      id: crypto.randomUUID(),
      code,
      originalName: file.originalName,
      storedName,
      mimeType: file.mimeType,
      fileSize: file.size,
      department,
      description: fields.description || "",
      uploadedBy: user.username,
      uploadedAt: new Date().toISOString(),
    };

    db.documents.push(document);
    writeDb(db);
    sendJson(res, 201, document);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/documents/") && url.pathname.endsWith("/download")) {
    const id = url.pathname.split("/")[3];
    const db = readDb();
    const doc = visibleDocuments(db, user).find((item) => item.id === id);
    if (!doc) {
      res.writeHead(404);
      res.end("No encontrado");
      return;
    }

    const filePath = path.join(uploadDir, doc.storedName);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Archivo no encontrado");
      return;
    }

    res.writeHead(200, {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.originalName)}"`,
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/users") {
    if (user.role !== "admin") {
      sendJson(res, 403, { message: "Solo el administrador puede ver usuarios." });
      return;
    }
    const db = readDb();
    sendJson(
      res,
      200,
      db.users.map(({ passwordHash, ...item }) => item),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    if (user.role !== "admin") {
      sendJson(res, 403, { message: "Solo el administrador puede crear usuarios." });
      return;
    }

    const body = await parseJsonBody(req);
    const db = readDb();
    if (!body.username || !body.password || !body.department || !body.role) {
      sendJson(res, 400, { message: "Completa usuario, clave, rol y departamento." });
      return;
    }
    if (db.users.some((item) => item.username === body.username)) {
      sendJson(res, 400, { message: "Ese usuario ya existe." });
      return;
    }

    db.users.push({
      id: crypto.randomUUID(),
      username: body.username,
      passwordHash: hashPassword(body.password),
      role: body.role === "admin" ? "admin" : "user",
      department: body.role === "admin" ? "TODOS" : body.department,
      active: true,
    });
    writeDb(db);
    sendJson(res, 201, { ok: true });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/users/")) {
    if (user.role !== "admin") {
      sendJson(res, 403, { message: "Solo el administrador puede eliminar usuarios." });
      return;
    }

    const username = decodeURIComponent(url.pathname.split("/")[3] || "");
    const key = url.searchParams.get("key") || "";
    if (key !== adminDeleteKey) {
      sendJson(res, 403, { message: "Clave de administrador incorrecta." });
      return;
    }
    if (username === "admin") {
      sendJson(res, 400, { message: "No se puede eliminar el usuario admin principal." });
      return;
    }

    const db = readDb();
    db.users = db.users.filter((item) => item.username !== username);
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { message: "Ruta no encontrada." });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requested));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(publicDir, "index.html"), (fallbackErr, fallback) => {
        if (fallbackErr) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fallback);
      });
      return;
    }

    res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { message: error.message || "Error interno" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`DOCUCONDUESPOL listo en http://localhost:${port}`);
});
