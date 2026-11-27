const selType = document.getElementById("sel-comm-type");
const selComm = document.getElementById("sel-community");
const selFil = document.getElementById("sel-filiere");

const themeToggleBtn = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");
const themeLabel = document.getElementById("theme-label");

const ANIM_DURATION = 600;
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
  return JSON.parse(text);
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
    const eased = 1 - Math.pow(1 - progress, 4);
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
    const gaugeEl = document.getElementById(`gauge-${key}`);
    if (!pctEl) return;

    pctEl.className = `kpi-pct ${kpi.status || ""}`;
    if (accentEl) accentEl.className = `kpi-top-accent ${kpi.status || ""}`;

    if (kpi.pct !== null && kpi.pct !== undefined && !Number.isNaN(Number(kpi.pct))) {
      const numPct = Number(kpi.pct);
      animateNumber(pctEl, numPct, formatFrenchPct, `pct-${key}`);
      if (gaugeEl) {
        gaugeEl.className = `gauge-fill ${kpi.status || ""}`;
        requestAnimationFrame(() => {
          gaugeEl.style.width = `${Math.max(0, Math.min(100, numPct))}%`;
        });
      }
    } else {
      pctEl.textContent = kpi.pct_display || "N/A%";
      if (gaugeEl) {
        gaugeEl.className = "gauge-fill na";
        gaugeEl.style.width = "0%";
      }
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
  await refreshFilters(true);
  await refreshKpis();
});

selComm.addEventListener("change", async () => {
  await refreshFilters(false);
  await refreshKpis();
});

selFil.addEventListener("change", async () => {
  await refreshKpis();
});

(async function init() {
  const logoEl = document.getElementById("gdo-logo");
  if (logoEl) logoEl.src = buildBackendUrl("api/logo");

  const fData = await fetchJson("api/filters");
  fillSelect(selType, fData.community_types, "(All)", "Business Line");
  await refreshFilters(true);
  await refreshKpis();
})();
