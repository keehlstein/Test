const selType = document.getElementById("sel-comm-type");
const selComm = document.getElementById("sel-community");
const selFil = document.getElementById("sel-filiere");

const themeToggleBtn = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");
const themeLabel = document.getElementById("theme-label");

const ANIM_DURATION = 550;
const animFrames = new Map();

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  if (themeIcon) themeIcon.textContent = isDark ? "☀️" : "🌙";
  if (themeLabel) themeLabel.textContent = isDark ? "Light Mode" : "Dark Mode";
  try {
    localStorage.setItem("gcl_dashboard_theme", isDark ? "dark" : "light");
  } catch (e) {}
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

try {
  const savedTheme = localStorage.getItem("gcl_dashboard_theme");
  if (savedTheme === "dark" || savedTheme === "light") {
    applyTheme(savedTheme);
  }
} catch (e) {}

function showDebug(msg, isError = true) {
  let box = document.getElementById("webapp-debug-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "webapp-debug-box";
    box.style.cssText =
      "padding:8px 12px;border-radius:10px;margin-bottom:12px;font-size:12px;font-family:monospace;";
    const shell = document.querySelector(".app-shell");
    if (shell) shell.prepend(box);
  }
  box.style.background = isError ? "rgba(239, 68, 68, 0.14)" : "rgba(59, 130, 246, 0.14)";
  box.style.color = isError ? "#ef4444" : "#3b82f6";
  box.style.border = isError ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid rgba(59, 130, 246, 0.35)";
  box.textContent = msg;
}

function buildBackendUrl(path) {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  if (window.dataiku && typeof dataiku.getWebAppBackendUrl === "function") {
    try {
      return dataiku.getWebAppBackendUrl(cleanPath);
    } catch (e) {
      return cleanPath;
    }
  }
  return cleanPath;
}

async function fetchJson(path) {
  const url = buildBackendUrl(path);
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} (${url}) : ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Réponse non-JSON (${url}) : ${text.slice(0, 200)}`);
  }
}

function fillSelect(selectEl, values, defaultLabel, keepValue = null) {
  const safeValues = Array.isArray(values) ? values : [];
  selectEl.innerHTML = `<option value="__ALL__">${defaultLabel}</option>`;
  safeValues.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = String(v);
    opt.textContent = String(v);
    selectEl.appendChild(opt);
  });
  if (keepValue && [...selectEl.options].some((o) => o.value === String(keepValue))) {
    selectEl.value = String(keepValue);
  } else {
    selectEl.value = "__ALL__";
  }
}

function formatFrenchPct(val) {
  return `${val.toFixed(2).replace(".", ",")}%`;
}

function animateNumber(el, targetValue, formatter, key) {
  if (!el) return;
  if (animFrames.has(key)) {
    cancelAnimationFrame(animFrames.get(key));
  }
  const startTime = performance.now();
  const startValue = 0;

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / ANIM_DURATION, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = startValue + (targetValue - startValue) * eased;
    el.textContent = formatter(current);
    if (progress < 1) {
      animFrames.set(key, requestAnimationFrame(step));
    } else {
      el.textContent = formatter(targetValue);
      animFrames.delete(key);
    }
  }
  animFrames.set(key, requestAnimationFrame(step));
}

function renderStatusText(status) {
  if (status === "on_target") return "On Target ✓";
  if (status === "warning") return "Warning !";
  if (status === "at_risk") return "At Risk ✗";
  return "N/A";
}

async function refreshFilters(resetChildren = false) {
  const ct = selType.value;
  const cm = resetChildren ? "__ALL__" : selComm.value;
  const params = new URLSearchParams({ comm_type: ct, community: cm });
  const data = await fetchJson(`api/filters?${params.toString()}`);

  if (resetChildren) {
    fillSelect(selComm, data.communities, "(All)", null);
    fillSelect(selFil, data.filieres, "(Tout)", null);
  } else {
    fillSelect(selComm, data.communities, "(All)", selComm.value);
    fillSelect(selFil, data.filieres, "(Tout)", selFil.value);
  }
  return data;
}

async function refreshKpis() {
  const params = new URLSearchParams({
    comm_type: selType.value,
    community: selComm.value,
    filiere: selFil.value,
  });
  const data = await fetchJson(`api/kpis?${params.toString()}`);

  Object.entries(data.kpis || {}).forEach(([key, kpi]) => {
    const pctEl = document.getElementById(`pct-${key}`);
    const metaEl = document.getElementById(`meta-${key}`);
    const stEl = document.getElementById(`status-${key}`);
    const accentEl = document.getElementById(`accent-${key}`);
    if (!pctEl) return;

    pctEl.className = `kpi-pct ${kpi.status || ""}`;
    if (accentEl) accentEl.className = `kpi-top-accent ${kpi.status || ""}`;

    if (kpi.pct !== null && kpi.pct !== undefined && !Number.isNaN(Number(kpi.pct))) {
      animateNumber(pctEl, Number(kpi.pct), formatFrenchPct, `pct-${key}`);
    } else {
      pctEl.textContent = kpi.pct_display || "N/A%";
    }

    if (kpi.total !== null && kpi.total !== undefined) {
      metaEl.innerHTML =
        `total: <span id="num-total-${key}">0</span><br/>` +
        `${kpi.sub_label}: <span id="num-sub-${key}">0</span>`;
      animateNumber(
        document.getElementById(`num-total-${key}`),
        Number(kpi.total),
        (v) => Math.round(v).toString(),
        `total-${key}`
      );
      animateNumber(
        document.getElementById(`num-sub-${key}`),
        Number(kpi.sub_value || 0),
        (v) => Math.round(v).toString(),
        `sub-${key}`
      );
    } else {
      metaEl.innerHTML = "";
    }

    if (stEl) {
      stEl.className = `foot-val status-pill ${kpi.status || ""}`;
      stEl.textContent = renderStatusText(kpi.status);
    }
  });

  ["on_target", "warning", "at_risk"].forEach((sKey) => {
    const el = document.getElementById(`count-${sKey}`);
    if (el) {
      animateNumber(
        el,
        Number((data.summary && data.summary[sKey]) || 0),
        (v) => Math.round(v).toString(),
        `sum-${sKey}`
      );
    }
  });
}

selType.addEventListener("change", async () => {
  try {
    await refreshFilters(true);
    await refreshKpis();
  } catch (e) {
    showDebug(e.message, true);
  }
});

selComm.addEventListener("change", async () => {
  try {
    await refreshFilters(false);
    await refreshKpis();
  } catch (e) {
    showDebug(e.message, true);
  }
});

selFil.addEventListener("change", async () => {
  try {
    await refreshKpis();
  } catch (e) {
    showDebug(e.message, true);
  }
});

(async function init() {
  const logoEl = document.getElementById("gdo-logo");
  if (logoEl) logoEl.src = buildBackendUrl("api/logo");

  try {
    const fData = await fetchJson("api/filters");
    fillSelect(selType, fData.community_types, "(All)", "Business Line");
    await refreshFilters(true);
    await refreshKpis();
    showDebug(
      `Connecté : ${(fData.community_types || []).length} types, ${(fData.communities || []).length} communautés.`,
      false
    );
  } catch (e) {
    showDebug(`Erreur au chargement : ${e.message}`, true);
  }
})();
