import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from .. import config, data_loader

router = APIRouter()

TODAS = "todas"
GENERAL = "general"


def _serie_una_fuente(df: pd.DataFrame, source: str) -> pd.DataFrame:
    return df[df["source"] == source][["period", "value", "n_reviews"]]


def _base_negative_share(aspecto: str) -> pd.DataFrame:
    """Punto de partida ya filtrado a negative_share. 'general' usa la tabla de
    sentimiento global (sin desglose por aspecto); cualquier otro valor filtra la
    tabla de aspectos a ese aspecto en concreto."""
    if aspecto == GENERAL:
        df = data_loader.cargar_opinion_global()
        return df[df["indicator_id"] == "negative_share"]
    df = data_loader.cargar_opinion_aspecto()
    return df[(df["aspecto"] == aspecto) & (df["indicator_id"] == "negative_share")]


def _agregar_por_periodo(df: pd.DataFrame) -> pd.DataFrame:
    """Media ponderada por nº de reseñas, mes a mes, colapsando lo que quede sin fijar
    (todas las plataformas si no se filtró por una, todas las CCAA si no se filtró por
    una). No es "la" tasa de ningún subconjunto en concreto: es el agregado."""

    def _agg(g: pd.DataFrame) -> pd.Series:
        return pd.Series({"value": (g["value"] * g["n_reviews"]).sum() / g["n_reviews"].sum(), "n_reviews": int(g["n_reviews"].sum())})

    return df.groupby("period", as_index=False).apply(_agg, include_groups=False)


def _agregar_todas_combinaciones(base: pd.DataFrame) -> pd.DataFrame:
    """Misma media ponderada que _agregar_por_periodo, pero para las 209 combinaciones
    CCAA x aspecto a la vez, con operaciones vectorizadas de pandas en vez de un
    .groupby().apply() en Python por cada una de las 209 (que es lo que hacía
    /tendencia/alertas antes: unos 17.500 grupos python-level, más de un segundo).
    Mismo resultado numérico, solo cambia cómo se calcula."""
    ponderado = base["value"] * base["n_reviews"]
    agg = (
        base.assign(_ponderado=ponderado)
        .groupby(["ccaa", "aspecto", "period"], observed=True)
        .agg(_suma_ponderada=("_ponderado", "sum"), n_reviews=("n_reviews", "sum"))
        .reset_index()
    )
    agg["value"] = agg["_suma_ponderada"] / agg["n_reviews"]
    return agg[["ccaa", "aspecto", "period", "value", "n_reviews"]]


def _calcular_racha(serie: list[dict]) -> int:
    """Meses consecutivos empeorando, contando solo puntos con evidencia suficiente
    (un mes sin evidencia se salta, nunca se rellena con un valor inventado:
    DICCIONARIO.md, regla 3)."""
    validos = [p for p in serie if p["evidencia_suficiente"]]
    racha = 0
    for i in range(len(validos) - 1, 0, -1):
        if validos[i]["tasa_negativa"] > validos[i - 1]["tasa_negativa"]:
            racha += 1
        else:
            break
    return racha


def _a_serie(df: pd.DataFrame, meses: int) -> list[dict]:
    df = df.sort_values("period").tail(meses)
    return [
        {
            "periodo": r["period"],
            "tasa_negativa": round(float(r["value"]), 4),
            "n_reviews": int(r["n_reviews"]),
            "evidencia_suficiente": r["n_reviews"] >= config.MIN_SUPPORT_OPINION,
        }
        for _, r in df.iterrows()
    ]


@router.get("/tendencia", summary="Serie mensual de tasa negativa de un aspecto (o del sentimiento general), en una CCAA (o toda España), para una plataforma (o todas)")
def tendencia(
    ccaa: str = Query(..., description=f"Nombre de una CCAA, o '{TODAS}' para agregarlas todas (España completa)."),
    aspecto: str = Query(..., description=f"Uno de los 11 aspectos, o '{GENERAL}' para el sentimiento general (sin desglosar por aspecto)."),
    source: str = Query(default=TODAS, description=f"Nombre de una plataforma, o '{TODAS}' para agregarlas todas (ponderado por nº de reseñas)."),
    meses: int = Query(default=24, ge=3, le=84),
):
    if aspecto != GENERAL and aspecto not in config.ASPECTO_KEYS:
        raise HTTPException(400, f"aspecto debe ser '{GENERAL}' o uno de {config.ASPECTO_KEYS}")

    base = _base_negative_share(aspecto)

    es_todas_fuente = not source or source.lower() == TODAS
    de_la_fuente = base if es_todas_fuente else base[base["source"] == source]

    es_todas_ccaa = not ccaa or ccaa.lower() == TODAS
    de_la_ccaa = de_la_fuente if es_todas_ccaa else de_la_fuente[de_la_fuente["ccaa"] == ccaa]

    # Si queda algo sin fijar (la plataforma, la CCAA, o ambas) hay que volver a agregar
    # esas filas mes a mes; si ambas están fijadas, la tabla ya trae una fila por mes.
    necesita_agregar = es_todas_fuente or es_todas_ccaa
    df = _agregar_por_periodo(de_la_ccaa) if necesita_agregar else _serie_una_fuente(de_la_ccaa, source)
    serie = _a_serie(df, meses)

    # Media nacional de la misma plataforma (o todas) y el mismo aspecto, para comparar
    # esta CCAA contra el resto de España en la misma gráfica. Si ya se pidió España
    # entera (ccaa=todas), esta serie es idéntica a la principal: el frontend no
    # dibuja la línea de comparación en ese caso.
    df_nacional = _agregar_por_periodo(de_la_fuente)
    serie_nacional = _a_serie(df_nacional, meses)

    ccaa_resp = TODAS if es_todas_ccaa else ccaa

    if not serie:
        return {
            "ccaa": ccaa_resp,
            "aspecto": aspecto,
            "source": TODAS if es_todas_fuente else source,
            "serie": [],
            "serie_nacional": serie_nacional,
            "aviso": "sin datos para esta combinación",
        }

    return {
        "ccaa": ccaa_resp,
        "aspecto": aspecto,
        "source": TODAS if es_todas_fuente else source,
        "serie": serie,
        "serie_nacional": serie_nacional,
        "meses_consecutivos_empeorando": _calcular_racha(serie),
        "nota": (
            "tasa_negativa = proporción de reseñas negativas ese mes"
            + (", agregada entre todas las plataformas y ponderada por nº de reseñas" if es_todas_fuente else "")
            + (", agregada entre las 19 CCAA y ponderada por nº de reseñas" if es_todas_ccaa else "")
            + ". Los meses sin evidencia suficiente (<30 reseñas) no se rellenan, se dejan vacíos."
        ),
    }


@router.get(
    "/tendencia/alertas",
    summary="Las combinaciones CCAA/aspecto con la racha de empeoramiento más larga activa ahora mismo, en toda España",
)
def alertas_tendencia(top_n: int = Query(default=6, ge=1, le=20)):
    base = data_loader.cargar_opinion_aspecto()
    base = base[base["indicator_id"] == "negative_share"]
    agregado = _agregar_todas_combinaciones(base)

    resultados = []
    for (ccaa, aspecto), grupo in agregado.groupby(["ccaa", "aspecto"], observed=True):
        # Misma agregación, misma ventana (24 meses) y el mismo cálculo de racha que
        # /api/tendencia con source=todas por defecto: si no, una alerta puede anunciar
        # una racha que ni se ve en la propia gráfica que se abre al pincharla.
        serie = _a_serie(grupo, meses=24)
        racha = _calcular_racha(serie)
        if racha < 2:
            continue

        ultimo_valido = next(p for p in reversed(serie) if p["evidencia_suficiente"])
        resultados.append(
            {
                "ccaa": ccaa,
                "aspecto": aspecto,
                "etiqueta_aspecto": config.ASPECTO_LABEL_BY_KEY.get(aspecto, aspecto),
                "meses_consecutivos_empeorando": racha,
                "tasa_negativa_actual": ultimo_valido["tasa_negativa"],
                "periodo": ultimo_valido["periodo"],
                "n_reviews": ultimo_valido["n_reviews"],
            }
        )

    resultados.sort(key=lambda r: (-r["meses_consecutivos_empeorando"], -r["tasa_negativa_actual"]))
    return {"alertas": resultados[:top_n], "total_combinaciones_con_racha": len(resultados)}
