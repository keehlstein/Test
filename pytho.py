import dataiku
import pandas as pd
from flask import request, jsonify, Response

# Chargement de la dataset gcl_data depuis le flow Dataiku
dataset = dataiku.Dataset("gcl_data")
df_raw = dataset.get_dataframe()

# Folder et fichier logo GDO formaté
LOGO_FOLDER_ID = "oJeEdZgy"
LOGO_FILENAME = "logo_gdo_formatted.png"
LOGO_MIMETYPE = "image/png"

# Noms des colonnes de gcl_data (à adapter si besoin)
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


def get_col(df: pd.DataFrame, key: str):
    """Récupère une colonne en toute sécurité même si le nom n'existe pas."""
    col_name = COLS.get(key)
    if col_name and col_name in df.columns:
        return df[col_name]
    return None


def is_true_series(s: pd.Series) -> pd.Series:
    """Renvoie True uniquement quand la valeur représente 'True' (booléen, texte ou 1)."""
    if s.dtype == bool:
        return s.fillna(False)
    return s.astype(str).str.strip().str.lower().isin(["true", "1", "yes"])


def series_true_or_false(df: pd.DataFrame, key: str) -> pd.Series:
    """Retourne une série booléenne indexée sur df, ou False partout si colonne absente."""
    s = get_col(df, key)
    if s is None:
        return pd.Series(False, index=df.index)
    return is_true_series(s)


def nunique_assets(df: pd.DataFrame) -> int:
    """Compte le nombre d'asset_id distincts (hors valeurs nulles)."""
    s = get_col(df, "asset_id")
    if df.empty or s is None:
        return 0
    return int(s.dropna().nunique())


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


@app.route("/api/logo", methods=["GET"])
def get_logo():
    """Sert l'image du logo GDO depuis le Managed Folder Dataiku."""
    try:
        folder = dataiku.Folder(LOGO_FOLDER_ID)
        with folder.get_download_stream(LOGO_FILENAME) as f:
            img_bytes = f.read()
        return Response(img_bytes, mimetype=LOGO_MIMETYPE)
    except Exception as e:
        return jsonify({"error": str(e)}), 404


@app.route("/api/filters", methods=["GET"])
def get_filters():
    """Retourne les valeurs possibles des 3 filtres en fonction de la sélection."""
    df = df_raw.copy()
    comm_type = request.args.get("comm_type", "")
    community = request.args.get("community", "")

    s_type = get_col(df, "comm_type")
    types = sorted(s_type.dropna().unique().tolist()) if s_type is not None else []

    df_t = df
    if comm_type and comm_type != "__ALL__" and s_type is not None:
        df_t = df_t[get_col(df_t, "comm_type") == comm_type]

    s_comm = get_col(df_t, "community")
    communities = sorted(s_comm.dropna().unique().tolist()) if s_comm is not None else []

    df_c = df_t
    if community and community != "__ALL__" and s_comm is not None:
        df_c = df_c[get_col(df_c, "community") == community]

    s_fil = get_col(df_c, "filiere")
    filieres = sorted(s_fil.dropna().unique().tolist()) if s_fil is not None else []

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

    if comm_type and comm_type != "__ALL__" and get_col(df, "comm_type") is not None:
        df = df[get_col(df, "comm_type") == comm_type]
    if community and community != "__ALL__" and get_col(df, "community") is not None:
        df = df[get_col(df, "community") == community]
    if filiere and filiere != "__ALL__" and get_col(df, "filiere") is not None:
        df = df[get_col(df, "filiere") == filiere]

    # Périmètre global filtré
    df_global = df

    # Périmètre labellisation : uniquement Applicability Labes == True
    if get_col(df, "app_label_flag") is not None:
        df_label_scope = df[series_true_or_false(df, "app_label_flag")]
    else:
        df_label_scope = df.iloc[0:0]

    s_label_scope_final = get_col(df_label_scope, "final_label")
    if s_label_scope_final is not None:
        final_clean = s_label_scope_final.astype(str).str.strip()
        assigned_mask = (
            s_label_scope_final.notna()
            & (final_clean != "")
            & (final_clean.str.lower() != "nan")
            & (final_clean.str.lower() != "none")
        )
        df_label_assigned = df_label_scope[assigned_mask]
        golden_mask = final_clean == "Golden"
    else:
        df_label_assigned = df_label_scope.iloc[0:0]
        golden_mask = pd.Series(False, index=df_label_scope.index)

    kpis = {
        "smvd": compute_kpi(
            df_global,
            df_global[series_true_or_false(df_global, "smvd_flag")],
            "Senior Management Missing Validation",
            "Date defined",
        ),
        "ddm": compute_kpi(
            df_global,
            df_global[series_true_or_false(df_global, "ddm_flag")],
            "DDM Unassigned",
            "assigned",
        ),
        "missing_dqr": compute_kpi(
            df_global,
            df_global[series_true_or_false(df_global, "dqr_flag")],
            "Missing Data Quality Rules",
            "defined",
        ),
        "labelling_unassigned": compute_kpi(
            df_label_scope,
            df_label_assigned,
            "Labelling Unassigned",
            "assigned",
        ),
        "missing_labelling_req": compute_kpi(
            df_label_scope,
            df_label_scope[series_true_or_false(df_label_scope, "dqr_flag")],
            "Missing Labelling Requirements",
            "defined",
        ),
        "golden_not_reached": compute_kpi(
            df_label_scope,
            df_label_scope[golden_mask],
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

    summary = {"on_target": 0, "warning": 0, "at_risk": 0}
    for item in kpis.values():
        if item["status"] in summary:
            summary[item["status"]] += 1

    return jsonify({"kpis": kpis, "summary": summary})
