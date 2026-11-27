import dataiku
import pandas as pd
from flask import request, jsonify

# 1. Chargement de la dataset gcl_data depuis le flow Dataiku
dataset = dataiku.Dataset("gcl_data")
df_raw = dataset.get_dataframe()

# 2. Noms des colonnes de gcl_data (à adapter si besoin)
COLS = {
    "asset_id": "asset_id",
    "comm_type": "Community type",
    "community": "Community",
    "filiere": "filiere",
    "smvd_flag": "SMVD flag",
    "ddm_flag": "data domain manager flag",
    "dqr_flag": "DQR LABEL flag",
    "label_flag": "labelization flag",
    "app_label_flag": "Applicability Labes",
    "final_label": "final label",
}


def is_true_series(s: pd.Series) -> pd.Series:
    """Renvoie True uniquement quand la valeur représente 'True' (booléen, texte ou 1)."""
    if s.dtype == bool:
        return s.fillna(False)
    return s.astype(str).str.strip().str.lower().isin(["true", "1", "yes"])


def nunique_assets(df: pd.DataFrame) -> int:
    """Compte le nombre d'asset_id distincts (hors valeurs nulles)."""
    col = COLS["asset_id"]
    if df.empty or col not in df.columns:
        return 0
    return int(df[col].dropna().nunique())


def compute_kpi(df_scope: pd.DataFrame, df_flag_true: pd.DataFrame, label: str, sub_label: str):
    """
    Calcule :
      total = count distinct asset_id sur df_scope
      ok_count = count distinct asset_id où le flag / condition est True
      missing_count = total - ok_count
      pct = (missing_count / total) * 100
    """
    total = nunique_assets(df_scope)
    if total == 0:
        return {
            "label": label,
            "pct": None,
            "pct_display": "N/A%",
            "total": 0,
            "sub_label": sub_label,
            "sub_value": 0,
            "status": "na",
        }

    ok_count = nunique_assets(df_flag_true)
    missing_count = max(total - ok_count, 0)
    pct = (missing_count / total) * 100.0

    # Seuils de statut : On Target (0-5%), Warning (6-10%), At Risk (>10%)
    if pct <= 5.0:
        status = "on_target"
    elif pct <= 10.0:
        status = "warning"
    else:
        status = "at_risk"

    return {
        "label": label,
        "pct": round(pct, 2),
        "pct_display": f"{pct:.2f}%".replace(".", ","),
        "total": total,
        "sub_label": sub_label,
        "sub_value": ok_count,
        "status": status,
    }


@app.route("/api/filters", methods=["GET"])
def get_filters():
    """Retourne les valeurs possibles des 3 filtres en fonction de la sélection."""
    df = df_raw.copy()
    comm_type = request.args.get("comm_type", "")
    community = request.args.get("community", "")

    types = (
        sorted(df[COLS["comm_type"]].dropna().unique().tolist())
        if COLS["comm_type"] in df.columns
        else []
    )

    df_t = df
    if comm_type and comm_type != "__ALL__" and COLS["comm_type"] in df.columns:
        df_t = df_t[df_t[COLS["comm_type"]] == comm_type]

    communities = (
        sorted(df_t[COLS["community"]].dropna().unique().tolist())
        if COLS["community"] in df_t.columns
        else []
    )

    df_c = df_t
    if community and community != "__ALL__" and COLS["community"] in df_t.columns:
        df_c = df_c[df_c[COLS["community"]] == community]

    filieres = (
        sorted(df_c[COLS["filiere"]].dropna().unique().tolist())
        if COLS["filiere"] in df_c.columns
        else []
    )

    return jsonify({
        "community_types": types,
        "communities": communities,
        "filieres": filieres,
    })


@app.route("/api/kpis", methods=["GET"])
def get_kpis():
    """Calcule tous les KPIs après application des filtres sélectionnés."""
    df = df_raw.copy()
    comm_type = request.args.get("comm_type", "")
    community = request.args.get("community", "")
    filiere = request.args.get("filiere", "")

    # Application des 3 filtres de la barre latérale droite
    if comm_type and comm_type != "__ALL__" and COLS["comm_type"] in df.columns:
        df = df[df[COLS["comm_type"]] == comm_type]
    if community and community != "__ALL__" and COLS["community"] in df.columns:
        df = df[df[COLS["community"]] == community]
    if filiere and filiere != "__ALL__" and COLS["filiere"] in df.columns:
        df = df[df[COLS["filiere"]] == filiere]

    # Périmètre global filtré (pour Governance et Data Quality Rules)
    df_global = df

    # Périmètre labellisation : uniquement Applicability Labes == True,
    # en excluant 'No label - Other Reasons' du dénominateur
    if COLS["app_label_flag"] in df.columns:
        df_app = df[is_true_series(df[COLS["app_label_flag"]])]
    else:
        df_app = df.iloc[0:0]

    if COLS["final_label"] in df_app.columns:
        df_label_scope = df_app[
            df_app[COLS["final_label"]].astype(str).str.strip() != "No label - Other Reasons"
        ]
    else:
        df_label_scope = df_app

    kpis = {
        "smvd": compute_kpi(
            df_global,
            df_global[is_true_series(df_global[COLS["smvd_flag"]])],
            "Senior Management Missing Validation",
            "Date defined",
        ),
        "ddm": compute_kpi(
            df_global,
            df_global[is_true_series(df_global[COLS["ddm_flag"]])],
            "DDM Unassigned",
            "assigned",
        ),
        "missing_dqr": compute_kpi(
            df_global,
            df_global[is_true_series(df_global[COLS["dqr_flag"]])],
            "Missing Data Quality Rules",
            "defined",
        ),
        "labelling_unassigned": compute_kpi(
            df_label_scope,
            df_label_scope[is_true_series(df_label_scope[COLS["label_flag"]])],
            "Labelling Unassigned",
            "assigned",
        ),
        "missing_labelling_req": compute_kpi(
            df_label_scope,
            df_label_scope[is_true_series(df_label_scope[COLS["dqr_flag"]])],
            "Missing Labelling Requirements",
            "defined",
        ),
        "golden_not_reached": compute_kpi(
            df_label_scope,
            df_label_scope[df_label_scope[COLS["final_label"]].astype(str).str.strip() == "Golden"],
            "Golden Label not reached",
            "Golden",
        ),
        "dqi_not_updated": {
            "pct": None,
            "pct_display": "N/A%",
            "total": None,
            "sub_label": "",
            "sub_value": None,
            "status": "na",
        },
    }

    # Comptage des statuts pour la barre du bas
    summary = {"on_target": 0, "warning": 0, "at_risk": 0}
    for item in kpis.values():
        if item["status"] in summary:
            summary[item["status"]] += 1

    return jsonify({"kpis": kpis, "summary": summary})