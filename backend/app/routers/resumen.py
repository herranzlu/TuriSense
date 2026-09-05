import pandas as pd
from fastapi import APIRouter

from .. import config, data_loader

router = APIRouter()


def _racha_mas_larga(df: pd.DataFrame, min_support: int = config.MIN_SUPPORT_OPINION) -> dict | None:
    """Recorre todas las combinaciones (plataforma, CCAA, aspecto) de opinion_aspecto
    y devuelve la que lleva más meses seguidos empeorando ahora mismo. Mismo criterio
    que /api/tendencia: solo cuentan los meses con evidencia suficiente, y un mes sin
    evidencia corta la búsqueda hacia atrás en vez de saltarse."""
    d = df[(df["indicator_id"] == "negative_share") & (df["support_ge_30"])].sort_values("period")

    mejor = None
    for (source, ccaa, aspecto), g in d.groupby(["source", "ccaa", "aspecto"], observed=True):
        vals = g["value"].tolist()
        racha = 0
        for i in range(len(vals) - 1, 0, -1):
            if vals[i] > vals[i - 1]:
                racha += 1
            else:
                break
        if racha >= 2 and (mejor is None or racha > mejor["racha"]):
            mejor = {
                "source": source,
                "ccaa": ccaa,
                "aspecto": aspecto,
                "racha": racha,
                "valor_actual": vals[-1],
                "periodo": g["period"].iloc[-1],
            }
    return mejor


@router.get("/resumen", summary="Cifras clave y alertas de portada, calculadas a partir de los datos reales")
def resumen():
    perfil = data_loader.cargar_perfil_lugares()
    oportunidad = data_loader.cargar_opportunity_score()

    alertas = []

    # 1) Alianzas comerciales: la CCAA con mayor puntuación de oportunidad y evidencia sólida
    candidatas = oportunidad[oportunidad["evidencia"] == "solid"].sort_values("puntuacion", ascending=False)
    if not candidatas.empty:
        top = candidatas.iloc[0]
        aspecto_txt = config.ASPECTO_LABEL_BY_KEY.get(top["aspecto_motor"], top["aspecto_motor"]).lower()
        alertas.append(
            {
                "categoria": "ALIANZAS COMERCIALES",
                "icono": "🤝",
                "titulo": top["ccaa"],
                "valor": round(float(top["puntuacion"]), 1),
                "valor_sufijo": "/100",
                "barra_pct": round(float(top["puntuacion"]), 1),
                "causa": f"Las quejas por {aspecto_txt} rondan el {top['tasa_negativa'] * 100:.0f}%, muy por encima del resto del país.",
                "accion": f"Renegociar las condiciones con los socios de alojamiento en {top['ccaa']}.",
                "ccaa": top["ccaa"],
                "destacada": True,
            }
        )

    # 2) Marketing: CCAA con alta satisfacción y baja masificación relativa (candidata a campaña)
    def _agg(g: pd.DataFrame) -> pd.Series:
        return pd.Series(
            {
                "satisfaccion": (g["pct_positivo_general"] * g["n_resenas"]).sum() / g["n_resenas"].sum(),
                "volumen_relativo_medio": g["volumen_relativo"].mean(),
                "n_resenas_total": int(g["n_resenas"].sum()),
            }
        )

    agg = perfil.groupby("ccaa").apply(_agg, include_groups=False).reset_index()
    agg = agg[agg["n_resenas_total"] >= config.MIN_SUPPORT_OPINION]
    if not agg.empty:
        candidata_marketing = agg.sort_values(by=["satisfaccion", "volumen_relativo_medio"], ascending=[False, True]).iloc[0]
        alertas.append(
            {
                "categoria": "MARKETING",
                "icono": "📣",
                "titulo": candidata_marketing["ccaa"],
                "valor": round(float(candidata_marketing["satisfaccion"] * 100), 0),
                "valor_sufijo": "%",
                "barra_pct": round(float(candidata_marketing["satisfaccion"] * 100), 0),
                "causa": f"{candidata_marketing['ccaa']} tiene muy buena fama entre los viajeros y todavía poca masificación relativa.",
                "accion": "Buen candidato para priorizar en la próxima campaña de marketing.",
                "ccaa": candidata_marketing["ccaa"],
            }
        )

    # 3) Calidad de producto: aspecto peor valorado a nivel nacional, y en qué % de lugares falla
    peor_aspecto = peor_pct = peor_incidencia = None
    for aspecto in config.ASPECTOS:
        col_pct = f"pct_positivo_{aspecto['col_perfil']}"
        col_n = f"n_menciones_{aspecto['col_perfil']}"
        sub = perfil[perfil[col_n] >= config.MIN_MENCIONES_PERFIL]
        if sub.empty:
            continue
        media = (sub[col_pct] * sub[col_n]).sum() / sub[col_n].sum()
        incidencia = (sub[col_pct] < 0.6).mean()
        if peor_pct is None or media < peor_pct:
            peor_aspecto, peor_pct, peor_incidencia = aspecto, media, incidencia

    if peor_aspecto is not None:
        alertas.append(
            {
                "categoria": "CALIDAD DE PRODUCTO",
                "icono": "🧹",
                "titulo": peor_aspecto["label"],
                "valor": round(float(peor_pct * 100), 0),
                "valor_sufijo": "% positivo",
                "barra_pct": round(float(peor_pct * 100), 0),
                "causa": f"El {peor_incidencia * 100:.0f}% de los alojamientos analizados no llegan ni al aprobado en este aspecto.",
                "accion": "Trasladarlo al equipo de producto: es el aspecto que más frena la valoración general en toda España.",
                "aspecto": peor_aspecto["key"],
            }
        )

    # 4) Tendencia: la combinación CCAA/aspecto/plataforma con la racha de empeoramiento más larga activa ahora mismo
    racha = _racha_mas_larga(data_loader.cargar_opinion_aspecto())
    if racha is not None:
        aspecto_label = config.ASPECTO_LABEL_BY_KEY.get(racha["aspecto"], racha["aspecto"])
        alertas.append(
            {
                "categoria": "TENDENCIA",
                "icono": "📉",
                "titulo": f"{racha['ccaa']} · {aspecto_label}",
                "valor": racha["racha"],
                "valor_sufijo": " meses seguidos",
                "causa": (
                    f"Las quejas por {aspecto_label.lower()} llevan {racha['racha']} meses subiendo sin parar en {racha['source']}, "
                    f"hasta el {racha['valor_actual'] * 100:.0f}% en {racha['periodo']}."
                ),
                "accion": f"Vale la pena revisarlo en {racha['ccaa']} antes de que se note fuera.",
                "ccaa": racha["ccaa"],
            }
        )

    return {
        "n_lugares": int(perfil["entity_id"].nunique()),
        "n_ccaa": int(perfil["ccaa"].nunique()),
        "n_resenas_perfil": int(perfil["n_resenas"].sum()),
        "alertas": alertas,
    }
