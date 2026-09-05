import pandas as pd
from fastapi import APIRouter, Query

from .. import data_loader

router = APIRouter()

INDICADORES_DEFECTO = [
    "frontur_tourists_per_1000_residents",
    "egatur_spend_per_nonresident_tourist_eur",
    "regulated_overnights_per_1000_residents",
    "hotel_occupancy_capacity_pct",
    "aena_passengers_per_1000_residents",
    "regulated_beds_per_1000_residents",
]

# Estos cuatro son tasas por 1.000 residentes: una cifra correcta pero poco intuitiva
# para alguien que no piensa en términos demográficos. Reconstruimos también la cifra
# absoluta nacional (tasa x población / 1.000, sumada entre las 19 CCAA) para que se
# lea de un vistazo: "turistas x", no solo "x por 1.000 habitantes".
UNIDAD_ABSOLUTA_POR_INDICADOR = {
    "frontur_tourists_per_1000_residents": "turistas internacionales",
    "aena_passengers_per_1000_residents": "pasajeros en vuelos",
    "regulated_beds_per_1000_residents": "plazas regladas",
    "regulated_overnights_per_1000_residents": "pernoctaciones",
}

MESES_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def _poblacion_por_ccaa(anual: pd.DataFrame, anio: int) -> pd.DataFrame:
    poblacion = anual[anual["year"] == anio][["ccaa", "population_midyear"]]
    if poblacion.empty:
        poblacion = anual.sort_values("year").groupby("ccaa").tail(1)[["ccaa", "population_midyear"]]
    return poblacion


def _media_ponderada(grupo: pd.DataFrame, columna: str) -> tuple[float | None, bool]:
    con_poblacion = grupo.dropna(subset=["population_midyear", columna])
    if con_poblacion.empty or con_poblacion["population_midyear"].sum() == 0:
        serie = grupo[columna].dropna()
        return (float(serie.mean()) if not serie.empty else None, False)
    media = (con_poblacion[columna] * con_poblacion["population_midyear"]).sum() / con_poblacion["population_midyear"].sum()
    return float(media), True


@router.get("/contexto", summary="Contexto turístico oficial: indicadores mensuales nacionales, ponderados por población")
def contexto(
    periodo: str | None = Query(default=None, description="AAAA-MM. Por defecto, el último periodo disponible."),
    ccaa: str | None = Query(default=None, description="Si se indica, añade a cada indicador su lectura para esa CCAA (valor, puesto entre las CCAA con dato y variación interanual propia)."),
):
    oficial = data_loader.cargar_oficial_mensual()
    anual = data_loader.cargar_contexto_anual()

    periodo_usado = periodo or oficial["period"].max()
    mes = oficial[(oficial["period"] == periodo_usado) & (oficial["indicator_id"].isin(INDICADORES_DEFECTO))]
    mes = mes.merge(_poblacion_por_ccaa(anual, int(periodo_usado[:4])), on="ccaa", how="left")

    indicadores_por_id = {}
    for ind_id, grupo in mes.groupby("indicator_id"):
        media_nacional, ponderado = _media_ponderada(grupo, "value")
        variacion, _ = _media_ponderada(grupo, "yoy_change")
        fila = grupo.iloc[0]

        valor_absoluto, unidad_absoluta = None, UNIDAD_ABSOLUTA_POR_INDICADOR.get(ind_id)
        if unidad_absoluta:
            con_poblacion = grupo.dropna(subset=["population_midyear", "value"])
            if not con_poblacion.empty:
                valor_absoluto = round(float((con_poblacion["value"] * con_poblacion["population_midyear"] / 1000).sum()))

        # Lectura propia de una CCAA (opcional): puesto calculado directamente sobre las
        # CCAA con dato ese mes para este indicador, no un percentil aparte precalculado.
        valor_ccaa = puesto_ccaa = total_ccaa_con_dato = variacion_ccaa = None
        if ccaa:
            con_dato = grupo.dropna(subset=["value"]).sort_values("value", ascending=False).reset_index()
            fila_ccaa = con_dato[con_dato["ccaa"] == ccaa]
            if not fila_ccaa.empty:
                valor_ccaa = round(float(fila_ccaa.iloc[0]["value"]), 2)
                puesto_ccaa = int(fila_ccaa.index[0]) + 1
                total_ccaa_con_dato = int(len(con_dato))
                yoy_ccaa = fila_ccaa.iloc[0]["yoy_change"]
                variacion_ccaa = round(float(yoy_ccaa), 1) if pd.notna(yoy_ccaa) else None

        indicadores_por_id[ind_id] = {
            "indicator_id": ind_id,
            "etiqueta": fila["indicator_label"],
            "unidad": fila["unit"],
            "fuente": fila["source_organization"],
            "valor_nacional": round(media_nacional, 2) if media_nacional is not None else None,
            "valor_absoluto_nacional": valor_absoluto,
            "unidad_absoluta": unidad_absoluta,
            "variacion_interanual_pct": round(variacion, 1) if variacion is not None else None,
            "ponderado_por_poblacion": ponderado,
            "provisional": bool(grupo["provisional_flag"].any()),
            "n_ccaa_con_dato": int(grupo["ccaa"].nunique()),
            "valor_ccaa": valor_ccaa,
            "puesto_ccaa": puesto_ccaa,
            "total_ccaa_con_dato": total_ccaa_con_dato,
            "variacion_interanual_pct_ccaa": variacion_ccaa,
        }
    # en el orden narrativo de INDICADORES_DEFECTO, no el alfabético que da groupby
    indicadores = [indicadores_por_id[i] for i in INDICADORES_DEFECTO if i in indicadores_por_id]

    # Fuentes institucionales reales de ESTA sección: se derivan de source_organization
    # de los propios indicadores mostrados (algunos vienen combinados, p.ej. "INE / EGATUR
    # / FRONTUR / Dataestur"), nunca de una lista escrita a mano que pueda quedarse
    # desactualizada si cambia el indicador por defecto.
    fuentes = sorted({tok.strip() for ind in indicadores for tok in ind["fuente"].split("/") if tok.strip()})

    resumen = None
    turistas = indicadores_por_id.get("frontur_tourists_per_1000_residents")
    if turistas and turistas["valor_absoluto_nacional"] is not None:
        mes_nombre = MESES_ES[int(periodo_usado[5:7]) - 1]
        numero_es = f"{turistas['valor_absoluto_nacional']:,}".replace(",", ".")
        variacion_txt = ""
        if turistas["variacion_interanual_pct"] is not None:
            v = turistas["variacion_interanual_pct"]
            variacion_txt = f", un {abs(v):.1f}% {'más' if v >= 0 else 'menos'} que en {mes_nombre} del año anterior"
        resumen = f"España recibió {numero_es} turistas internacionales en {mes_nombre} de {periodo_usado[:4]}{variacion_txt}."

    anio = int(periodo_usado[:4])
    anio_anterior = anio - 1
    estructural = anual[anual["year"] == anio_anterior]
    if estructural.empty:
        estructural = anual[anual["year"] == anual["year"].max()]
    anio_estructural_usado = int(estructural["year"].iloc[0]) if not estructural.empty else None
    pernoctaciones_totales = float(estructural["regulated_overnights_annual_total"].sum()) if not estructural.empty else None
    ocupacion_media, _ = _media_ponderada(estructural, "hotel_occupancy_annual_weighted_pct") if not estructural.empty else (None, False)

    return {
        "periodo": periodo_usado,
        "resumen": resumen,
        "fuentes": fuentes,
        "indicadores_mensuales": indicadores,
        "contexto_estructural_anual": {
            "anio": anio_estructural_usado,
            "pernoctaciones_regladas_totales_espana": pernoctaciones_totales,
            "ocupacion_hotelera_media_ponderada_pct": round(ocupacion_media, 2) if ocupacion_media is not None else None,
            "aviso": "Dato ANUAL: no confundir con la serie mensual de arriba (regla del contrato Rol4: 'no presentar datos anuales como mensuales').",
        },
    }


@router.get(
    "/contexto/historico",
    summary="Serie histórica 2019-2025: pernoctaciones nacionales mes a mes, estacionalidad y benchmark de CCAA",
)
def contexto_historico():
    """Reconstruye las pernoctaciones nacionales absolutas mes a mes (no vienen
    así en ningún fichero): oficial_mensual trae la tasa por 1.000 residentes, y
    contexto_anual trae la población de cada CCAA cada año. El cruce de las dos
    permite ver la serie completa 2019-2025 a nivel país: la caída del COVID, la
    recuperación, y si 2025 ya iguala o supera 2019."""
    oficial = data_loader.cargar_oficial_mensual()
    anual = data_loader.cargar_contexto_anual()

    serie = oficial[oficial["indicator_id"] == "regulated_overnights_per_1000_residents"][
        ["ccaa", "period", "year", "month", "value", "provisional_flag"]
    ].copy()
    poblacion_anual = anual[["ccaa", "year", "population_midyear"]]
    serie = serie.merge(poblacion_anual, on=["ccaa", "year"], how="left")
    serie["pernoctaciones"] = serie["value"] * serie["population_midyear"] / 1000

    mensual = (
        serie.dropna(subset=["pernoctaciones"])
        .groupby("period", as_index=False)
        .agg(pernoctaciones=("pernoctaciones", "sum"), provisional=("provisional_flag", "any"), year=("year", "first"), month=("month", "first"))
        .sort_values("period")
    )

    serie_mensual = [
        {
            "periodo": r["period"],
            "pernoctaciones": round(float(r["pernoctaciones"])),
            "provisional": bool(r["provisional"]),
        }
        for _, r in mensual.iterrows()
    ]

    anual_nacional = mensual.groupby("year", as_index=False).agg(pernoctaciones=("pernoctaciones", "sum"))
    serie_anual = [
        {"anio": int(r["year"]), "pernoctaciones": round(float(r["pernoctaciones"]))} for _, r in anual_nacional.iterrows()
    ]

    # "Año completo" = tiene los 12 meses presentes en la serie reconstruida, no simplemente
    # "no es el último": algunos años recientes ya están completos aunque parte del dato sea provisional.
    cobertura_por_anio = mensual.groupby("year")["month"].nunique()
    anios_completos = cobertura_por_anio[cobertura_por_anio == 12].index
    ultimo_anio_completo = anios_completos.max() if len(anios_completos) else anual_nacional["year"].max()

    baseline_2019 = next((a["pernoctaciones"] for a in serie_anual if a["anio"] == 2019), None)
    ultimo_valor = next((a["pernoctaciones"] for a in serie_anual if a["anio"] == int(ultimo_anio_completo)), None) if pd.notna(ultimo_anio_completo) else None

    hallazgo = None
    if baseline_2019 and ultimo_valor and int(ultimo_anio_completo) != 2019:
        variacion = (ultimo_valor / baseline_2019 - 1) * 100
        if variacion >= 0:
            hallazgo = (
                f"España ya superó su nivel pre-pandemia: en {int(ultimo_anio_completo)} hubo un {variacion:.0f}% más "
                f"de pernoctaciones regladas que en 2019."
            )
        else:
            hallazgo = (
                f"España todavía no recupera su nivel pre-pandemia: en {int(ultimo_anio_completo)} hubo un "
                f"{abs(variacion):.0f}% menos de pernoctaciones regladas que en 2019."
            )

    # Estacionalidad nacional real: qué mes concentra más pernoctaciones, de media, entre 2019 y el
    # último año completo (se excluye 2020 por ser un año atípico que distorsiona el patrón habitual).
    patron = mensual[mensual["year"].between(2019, int(ultimo_anio_completo) if pd.notna(ultimo_anio_completo) else 2025)]
    patron = patron[patron["year"] != 2020]
    por_mes = patron.groupby("month")["pernoctaciones"].mean().sort_values(ascending=False)
    mes_pico = MESES_ES[int(por_mes.index[0]) - 1] if not por_mes.empty else None
    top3_share = float(por_mes.head(3).sum() / por_mes.sum()) if not por_mes.empty and por_mes.sum() else None

    # Benchmark de CCAA: escala (cuánto turismo) x intensidad (cuánto respecto a su población),
    # ya calculado por Rol 4 (percentiles entre las 19 CCAA), del último año disponible.
    anio_benchmark = int(anual["year"].max())
    bench = anual[anual["year"] == anio_benchmark]
    benchmark_ccaa = [
        {
            "ccaa": r["ccaa"],
            "escala_percentil": round(float(r["regulated_scale_percentile"]), 3) if pd.notna(r["regulated_scale_percentile"]) else None,
            "intensidad_percentil": round(float(r["regulated_intensity_percentile"]), 3) if pd.notna(r["regulated_intensity_percentile"]) else None,
            "cuadrante": r["scale_intensity_quadrant"],
            "mes_pico": r["regulated_overnights_peak_month_label"],
            "concentracion_top3_meses_pct": round(float(r["regulated_overnights_top3_share"]) * 100, 1) if pd.notna(r["regulated_overnights_top3_share"]) else None,
        }
        for _, r in bench.iterrows()
    ]

    return {
        "serie_mensual": serie_mensual,
        "serie_anual": serie_anual,
        "anio_benchmark": anio_benchmark,
        "hallazgo": hallazgo,
        "estacionalidad_nacional": {
            "mes_pico": mes_pico,
            "concentracion_top3_meses_pct": round(top3_share * 100, 1) if top3_share is not None else None,
            "nota": "Media 2019-" + str(int(ultimo_anio_completo) if pd.notna(ultimo_anio_completo) else 2025) + ", excluyendo 2020 por ser un año atípico (COVID).",
        },
        "benchmark_ccaa": benchmark_ccaa,
        "cuadrante_definicion": {
            "escala_alta__intensidad_alta": "Mucho turismo en volumen y mucho respecto a su población: mercados maduros, foco en gestión de la masificación.",
            "escala_alta__intensidad_moderada": "Mucho turismo en volumen, pero repartido entre más población: margen de crecimiento antes de saturar.",
            "escala_moderada__intensidad_alta": "Menos volumen, pero muy concentrado respecto a su población: presión alta en un territorio pequeño.",
            "escala_moderada__intensidad_moderada": "Ni el volumen ni la presión relativa destacan: mercados en desarrollo.",
        },
        "nota": "Pernoctaciones reconstruidas cruzando la tasa mensual por 1.000 residentes (oficial_mensual) con la población de cada CCAA y año (contexto_anual). No es un dato que venga ya así en ningún fichero.",
    }
