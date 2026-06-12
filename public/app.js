const state = {
  token: localStorage.getItem("docuconduespol_token") || "",
  user: null,
  departments: [],
  documents: [],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function authHeaders(extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${state.token}`,
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData ? authHeaders(options.headers || {}) : authHeaders({ "Content-Type": "application/json", ...(options.headers || {}) }),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.message || "No se pudo completar la accion.");
  return data;
}

function setMessage(target, message, type = "success") {
  target.textContent = message;
  target.className = `result ${type}`;
  target.classList.remove("hidden");
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("es-EC", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showView(name) {
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === name));
}

function applyRole() {
  const isAdmin = state.user?.role === "admin";
  $$(".admin-only").forEach((item) => item.classList.toggle("hidden", !isAdmin));
  $("#sessionName").textContent = state.user?.username || "";
  $("#sessionRole").textContent = isAdmin ? "Administrador" : "Usuario";
  $("#userChipLabel").textContent = `${state.user?.username || ""} · ${isAdmin ? "Administrador" : state.user?.department}`;
}

function fillDepartments() {
  const options = state.departments.map((department) => `<option>${department.name}</option>`).join("");
  $("#uploadDepartment").innerHTML = options;
  $("#searchDepartment").innerHTML = `<option value="">Todos</option>${options}`;
  $("#newUserDepartment").innerHTML = options;
}

function renderStats(stats) {
  $("#metricDocuments").textContent = stats.documents;
  $("#metricDepartments").textContent = stats.departments;
  $("#metricToday").textContent = stats.uploadedToday;
  $("#metricUsers").textContent = stats.users;
  renderDocuments(stats.recent, $("#recentDocuments"), true);
}

function renderDocuments(rows, target, compact = false) {
  if (!rows.length) {
    target.innerHTML = '<div class="empty">No hay documentos registrados.</div>';
    return;
  }

  target.innerHTML = `
    <div class="row head ${compact ? "compact-row" : ""}">
      <span>Codigo</span><span>Archivo</span><span>Departamento</span><span>Fecha</span><span></span>
    </div>
    ${rows
      .map(
        (doc) => `
        <div class="row ${compact ? "compact-row" : ""}">
          <span>${doc.code}</span>
          <span title="${doc.originalName}">${doc.originalName}</span>
          <span>${doc.department}</span>
          <span>${formatDate(doc.uploadedAt)}</span>
          <a class="download" href="/api/documents/${doc.id}/download?token=${state.token}">Descargar</a>
        </div>
      `,
      )
      .join("")}
  `;
}

async function refreshStats() {
  const stats = await api("/api/stats");
  renderStats(stats);
}

async function refreshDocuments(query = "") {
  const docs = await api(`/api/documents${query}`);
  state.documents = docs;
  renderDocuments(docs, $("#results"));
}

async function refreshUsers() {
  if (state.user?.role !== "admin") return;
  const users = await api("/api/users");
  $("#usersTable").innerHTML = `
    <div class="row user-row head">
      <span>Usuario</span><span>Rol</span><span>Departamento</span><span>Estado</span><span></span>
    </div>
    ${users
      .map(
        (user) => `
        <div class="row user-row">
          <span>${user.username}</span>
          <span>${user.role}</span>
          <span>${user.department}</span>
          <span>${user.active ? "Activo" : "Inactivo"}</span>
          <button class="danger" data-delete-user="${user.username}" ${user.username === "admin" ? "disabled" : ""}>Eliminar</button>
        </div>
      `,
      )
      .join("")}
  `;
}

async function bootstrap() {
  if (!state.token) {
    $("#loginScreen").classList.remove("hidden");
    $("#appShell").classList.add("hidden");
    return;
  }

  try {
    const session = await api("/api/session");
    state.user = session.user;
    state.departments = await api("/api/departments");
    $("#loginScreen").classList.add("hidden");
    $("#appShell").classList.remove("hidden");
    applyRole();
    fillDepartments();
    showView("dashboard");
    await refreshStats();
    await refreshDocuments();
    await refreshUsers();
  } catch {
    localStorage.removeItem("docuconduespol_token");
    state.token = "";
    $("#loginScreen").classList.remove("hidden");
    $("#appShell").classList.add("hidden");
  }
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = $("#loginResult");
  result.classList.add("hidden");
  const form = new FormData(event.currentTarget);

  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
      headers: {},
    });
    state.token = data.token;
    localStorage.setItem("docuconduespol_token", data.token);
    await bootstrap();
  } catch (error) {
    setMessage(result, error.message, "error");
  }
});

$("#logoutButton").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST", body: JSON.stringify({}) });
  } catch {}
  localStorage.removeItem("docuconduespol_token");
  state.token = "";
  state.user = null;
  $("#appShell").classList.add("hidden");
  $("#loginScreen").classList.remove("hidden");
});

$$(".nav-item").forEach((button) => {
  button.addEventListener("click", async () => {
    showView(button.dataset.view);
    if (button.dataset.view === "dashboard") await refreshStats();
    if (button.dataset.view === "search") await refreshDocuments();
    if (button.dataset.view === "users") await refreshUsers();
  });
});

$$(".nav-shortcut").forEach((button) => {
  button.addEventListener("click", async () => {
    showView(button.dataset.view);
    if (button.dataset.view === "search") await refreshDocuments();
  });
});

$("#uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = $("#uploadResult");
  result.classList.add("hidden");
  const form = new FormData(event.currentTarget);

  try {
    const doc = await api("/api/documents", {
      method: "POST",
      body: form,
      headers: {},
    });
    event.currentTarget.reset();
    setMessage(result, `Documento guardado correctamente. Codigo: ${doc.code}`);
    await refreshStats();
    await refreshDocuments();
  } catch (error) {
    setMessage(result, error.message, "error");
  }
});

$("#searchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const params = new URLSearchParams();
  ["code", "q", "department", "from", "to"].forEach((field) => {
    const value = form.get(field);
    if (value) params.set(field, value);
  });
  await refreshDocuments(`?${params.toString()}`);
});

$("#createUserForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = $("#userResult");
  result.classList.add("hidden");
  const form = new FormData(event.currentTarget);

  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
        role: form.get("role"),
        department: form.get("department"),
      }),
      headers: {},
    });
    event.currentTarget.reset();
    setMessage(result, "Usuario creado correctamente.");
    await refreshUsers();
    await refreshStats();
  } catch (error) {
    setMessage(result, error.message, "error");
  }
});

$("#usersTable").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-user]");
  if (!button) return;

  const username = button.dataset.deleteUser;
  const key = prompt(`Clave de administrador para eliminar a ${username}`);
  if (!key) return;

  try {
    await api(`/api/users/${encodeURIComponent(username)}?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
    await refreshUsers();
    await refreshStats();
  } catch (error) {
    alert(error.message);
  }
});

$("#roleSelect").addEventListener("change", (event) => {
  $("#newUserDepartment").disabled = event.target.value === "admin";
});

bootstrap();
  