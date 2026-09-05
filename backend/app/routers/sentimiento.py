from fastapi import APIRouter, HTTPException, Query

from .. import config, data_loader

router = APIRouter()


@router.get(
    "/sentimiento/fuentes",
    summary="Plataformas de opinión disponibles (filtro obligatorio por contrato Rol4)",
)
def fuentes_disponibles():
    df = data_loader.cargar_opinion_global()
    conteo = df.groupby("source")["n_reviews"].sum().sort_values(ascending=False)
    return {"fuentes": [{"source": s, "n_reviews": int(n)} for s, n in conteo.items()]}


@router.get("/sentimiento/mapa", summary="Sentimiento por CCAA, general o por aspecto, para una plataforma")
def mapa_sentimiento(
    source: str = Query(..., description="Plataforma obligatoria (ver /api/sentimiento/fuentes). Ej: booking"),
    aspecto: str | None = Query(default=None, description="key de uno de los 11 aspectos. Si se omite, es el sentimiento general."),
    periodo: str | None = Query(default=None, description="AAAA-MM. Por defecto, el último periodo disponible para esa fuente."),
):
    if aspecto:
        if aspecto not in config.ASPECTO_KEYS:
            raise HTTPException(400, f"aspecto debe ser uno de {config.ASPECTO_KEYS}")
        df = data_loader.cargar_opinion_aspecto()
        df = df[(df["source"] == source) & (df["aspecto"] == aspecto)]
    else:
        df = data_loader.cargar_opinion_global()
        df = df[df["source"] == source]

    if df.empty:
        detalle = f"source='{source}'" + (f", aspecto='{aspecto}'" if aspecto else "")
        raise HTTPException(404, f"no hay datos de opinión para {detalle}")

    periodo_usado = periodo or df["period"].max()
    df = df[(df["period"] == periodo_usado) & (df["indicator_id"] == "positive_share")]

    filas = [
        {
            "ccaa": r["ccaa"],
            "ccaa_geojson": data_loader.geojson_de_ccaa(r["ccaa"]),
            "pct_positivo": round(float(r["value"]), 4),
            "n_reviews": int(r["n_reviews"]),
            "evidencia_suficiente": bool(r["support_ge_30"]),
        }
        for _, r in df.iterrows()
    ]

    return {
        "source": source,
        "aspecto": aspecto,
        "periodo": periodo_usado,
        "unidad": "proporción [0,1] de reseñas positivas",
        "regla_evidencia": f"evidencia_suficiente=false con menos de {config.MIN_SUPPORT_OPINION} reseñas de soporte (contrato Rol4): ocultar o marcar la celda.",
        "ccaa": filas,
    }
