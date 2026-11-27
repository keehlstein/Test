const selType = document.getElementById("sel-comm-type");
const selComm = document.getElementById("sel-community");
const selFil = document.getElementById("sel-filiere");

const ANIM_DURATION = 550;
const animFrames = new Map();

function showDebug(msg, isError = true) {
  let box = document.getElementById("webapp-debug-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "webapp-debug-box";
    box.style.cssText =
      "padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:12px;font-family:monospace;";
    const shell = document.querySelector(".app-shell");
    if (shell) shell.prepend(box);
  }
  box.style.background = isError ? "#fdecea" : "#eef6ff";
  box.style.color = isError ? "#8a1c1c" : "#164273";
  box.style.border = isError ? "1px solid #f5c2c7" : "1px solid #b6d4fe";
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
    if (!pctEl) return;

    pctEl.className = `kpi-pct ${kpi.status || ""}`;

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
  try {
    const fData = await fetchJson("api/filters");
    fillSelect(selType, fData.community_types, "(All)", "Business Line");
    await refreshFilters(true);
    await refreshKpis();
    showDebug(
      `Connecté : ${ (fData.community_types || []).length } types, ${ (fData.communities || []).length } communautés.`,
      false
    );
  } catch (e) {
    showDebug(`Erreur au chargement : ${e.message}`, true);
  }
})();
