const selType = document.getElementById("sel-comm-type");
const selComm = document.getElementById("sel-community");
const selFil = document.getElementById("sel-filiere");

const ANIM_DURATION = 550; // Durée de l'animation en millisecondes
const animFrames = new Map();

function fillSelect(selectEl, values, defaultLabel, keepValue = null) {
  selectEl.innerHTML = `<option value="__ALL__">${defaultLabel}</option>`;
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
  if (keepValue && [...selectEl.options].some((o) => o.value === keepValue)) {
    selectEl.value = keepValue;
  } else {
    selectEl.value = "__ALL__";
  }
}

function formatFrenchPct(val) {
  return `${val.toFixed(2).replace(".", ",")}%`;
}

/**
 * Fait défiler un chiffre de 0 jusqu'à targetValue avec une décélération fluide (ease-out).
 */
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

async function refreshFilters(resetChildren = false) {
  const ct = selType.value;
  const cm = resetChildren ? "__ALL__" : selComm.value;
  const params = new URLSearchParams({ comm_type: ct, community: cm });

  const res = await fetch(dataiku.getWebAppBackendUrl(`/api/filters?${params.toString()}`));
  const data = await res.json();

  if (resetChildren) {
    fillSelect(selComm, data.communities, "(All)", null);
    fillSelect(selFil, data.filieres, "(Tout)", null);
  } else {
    fillSelect(selComm, data.communities, "(All)", selComm.value);
    fillSelect(selFil, data.filieres, "(Tout)", selFil.value);
  }
}

function renderStatusText(status) {
  if (status === "on_target") return "On Target ✓";
  if (status === "warning") return "Warning !";
  if (status === "at_risk") return "At Risk ✗";
  return "N/A";
}

async function refreshKpis() {
  const params = new URLSearchParams({
    comm_type: selType.value,
    community: selComm.value,
    filiere: selFil.value,
  });

  const res = await fetch(dataiku.getWebAppBackendUrl(`/api/kpis?${params.toString()}`));
  const data = await res.json();

  Object.entries(data.kpis).forEach(([key, kpi]) => {
    const pctEl = document.getElementById(`pct-${key}`);
    const metaEl = document.getElementById(`meta-${key}`);
    const stEl = document.getElementById(`status-${key}`);
    if (!pctEl) return;

    pctEl.className = `kpi-pct ${kpi.status}`;

    // Animation du pourcentage
    if (kpi.pct !== null && kpi.pct !== undefined) {
      animateNumber(pctEl, Number(kpi.pct), formatFrenchPct, `pct-${key}`);
    } else {
      pctEl.textContent = kpi.pct_display;
    }

    // Animation des compteurs total et sous-compteur (ex. Date defined, assigned, Golden)
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
        Number(kpi.sub_value),
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

  // Animation des totaux de la barre du bas
  ["on_target", "warning", "at_risk"].forEach((sKey) => {
    const el = document.getElementById(`count-${sKey}`);
    if (el) {
      animateNumber(el, Number(data.summary[sKey] || 0), (v) => Math.round(v).toString(), `sum-${sKey}`);
    }
  });
}

// Déclenchement uniquement au changement d'un filtre
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

// Chargement initial de la WebApp
(async function init() {
  const res = await fetch(dataiku.getWebAppBackendUrl("/api/filters"));
  const data = await res.json();
  fillSelect(selType, data.community_types, "(All)", "Business Line");
  await refreshFilters(true);
  await refreshKpis();
})();