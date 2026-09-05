import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from .. import config, data_loader
from .contexto import INDICADORES_DEFECTO
from .recomendador import clasificar_tipo_experiencia

router = APIRouter()


@router.get("/ccaa", summary="Las 19 CCAA con su código oficial, su nombre en el geojson del mapa y su imagen")
def listar_ccaa():
    return {"ccaa": config.CCAA}


@router.get("/aspectos", summary="Los 11 aspectos evaluables, con su etiqueta legible")
def listar_aspectos():
    return {"aspectos": [{"key": a["key"], "label": a["label"]} for a in config.ASPECTOS]}


def _ciudad_de(entity_id: str) -> tuple[str | None, str | None]:
    fila = data_loader.cargar_entity_ciudad()
    fila = fila[fila["entity_id"] == entity_id]
    if fila.empty:
        return None, None
    ciudad, nivel = fila["ciudad"].iloc[0], fila["nivel"].iloc[0]
    return (ciudad if pd.notna(ciudad) else None), (nivel if pd.notna(nivel) else None)


def _mejor_de_tipo(perfil: pd.DataFrame, tipo: str) -> dict | None:
    """El lugar mejor valorado de un tipo (alojamiento/restauracion) en un territorio ya
    filtrado. Mismo umbral de calidad que el recomendador (min. 5 reseñas, min. 30%
    positivo): un "mejor valorado" con 1 reseña al 100% no significa nada."""
    if "tipo_experiencia" not in perfil.columns:
        perfil = perfil.assign(tipo_experiencia=perfil["property_type"].apply(clasificar_tipo_experiencia))
    candidatos = perfil[
        (perfil["tipo_experiencia"] == tipo)
        & (perfil["n_resenas"] >= config.MIN_RESENAS_RECOMENDADOR)
        & (perfil["pct_positivo_general"] >= config.MIN_SENTIMIENTO_RECOMENDADOR)
    ]
    if candidatos.empty:
        return None

    mejor = candidatos.sort_values(["pct_positivo_general", "n_resenas"], ascending=[False, False]).iloc[0]
    ciudad, nivel = _ciudad_de(mejor["entity_id"])

    return {
        "entity_id": mejor["entity_id"],
        "ciudad": ciudad,
        "ciudad_es_aproximada": nivel is not None and nivel != "ciudad",
        "tipo_alojamiento": config.traducir_tipo_alojamiento(mejor["property_type"]),
        "pct_positivo_general": round(float(mejor["pct_positivo_general"]), 4),
        "n_resenas": int(mejor["n_resenas"]),
        "volumen_relativo": round(float(mejor["volumen_relativo"]), 4),
    }


def _aspectos_de_lugar(fila: pd.Series) -> list[dict]:
    aspectos = []
    for a in config.ASPECTOS:
        col_pct, col_n = f"pct_positivo_{a['col_perfil']}", f"n_menciones_{a['col_perfil']}"
        pct, n = fila.get(col_pct), fila.get(col_n)
        aspectos.append(
            {
                "aspecto": a["key"],
                "etiqueta": a["label"],
                "pct_positivo": round(float(pct), 4) if pd.notna(pct) else None,
                "menciones": int(n) if pd.notna(n) else 0,
                "evidencia_suficiente": bool(pd.notna(n) and n >= config.MIN_MENCIONES_PERFIL),
            }
        )
    aspectos.sort(key=lambda f: (not f["evidencia_suficiente"], f["pct_positivo"] if f["pct_positivo"] is not None else 1))
    return aspectos


@router.get(
    "/lugares/resumen",
    summary="Ficha completa de un lugar: desglose por los 11 aspectos (sin nombre real, no existe en los datos)",
)
def resumen_lugar(entity_id: str = Query(...)):
    perfil = data_loader.cargar_perfil_lugares()
    fila = perfil[perfil["entity_id"] == entity_id]
    if fila.empty:
        raise HTTPException(404, f"no existe entity_id='{entity_id}'")
    fila = fila.iloc[0]
    ciudad, nivel = _ciudad_de(entity_id)

    return {
        "entity_id": entity_id,
        "ccaa": fila["ccaa"],
        "ciudad": ciudad,
        "ciudad_es_aproximada": nivel is not None and nivel != "ciudad",
        "tipo_alojamiento": config.traducir_tipo_alojamiento(fila["property_type"]),
        "n_resenas": int(fila["n_resenas"]),
        "pct_positivo_general": round(float(fila["pct_positivo_general"]), 4),
        "volumen_relativo": round(float(fila["volumen_relativo"]), 4),
        "aspectos": _aspectos_de_lugar(fila),
        "nota": "No hay nombre real de alojamiento/actividad en los datos: entity_id es un hash anonimizado.",
    }


def _masificacion(perfil_ccaa: pd.DataFrame, ccaa: str) -> dict:
    col_pct, col_n = "pct_positivo_Masificación", "n_menciones_Masificación"
    sub = perfil_ccaa[[col_pct, col_n]].dropna()
    sub = sub[sub[col_n] >= config.MIN_MENCIONES_PERFIL]
    menciones = int(sub[col_n].sum())
    resultado = {"pct_quejas": None, "menciones": menciones, "evidencia_suficiente": False}
    if menciones:
        pct_positivo = float((sub[col_pct] * sub[col_n]).sum() / menciones)
        resultado["pct_quejas"] = round((1 - pct_positivo) * 100, 1)
        resultado["evidencia_suficiente"] = menciones >= config.MIN_SUPPORT_OPINION

    # Contexto adicional: puesto de esta CCAA en el Opportunity Score oficial (Rol 5),
    # y si masificación es de verdad lo que más pesa en su puntuación.
    oportunidad = data_loader.cargar_opportunity_score()
    fila_op = oportunidad[oportunidad["ccaa"] == ccaa]
    if not fila_op.empty:
        r = fila_op.iloc[0]
        resultado["puesto_opportunity_score"] = int(r["puesto"])
        resultado["puntuacion_opportunity_score"] = round(float(r["puntuacion"]), 1)
        resultado["aspecto_motor"] = r["aspecto_motor"]
        resultado["masificacion_es_aspecto_motor"] = r["aspecto_motor"] == "masificacion"
        resultado["evidencia_opportunity_score"] = r["evidencia"]
    return resultado


def _tendencia_turistica(ccaa: str) -> dict | None:
    """Última variación interanual real de pernoctaciones regladas por 1.000 residentes
    en esa CCAA (contrato Rol4, columna yoy_change ya calculada), más el resto de
    indicadores oficiales del mismo periodo para dar más contexto al pinchar."""
    oficial = data_loader.cargar_oficial_mensual()
    de_ccaa = oficial[oficial["ccaa"] == ccaa]

    serie = de_ccaa[de_ccaa["indicator_id"] == "regulated_overnights_per_1000_residents"]
    serie = serie.dropna(subset=["yoy_change"]).sort_values("period")
    if serie.empty:
        return None
    ultimo = serie.iloc[-1]
    variacion = float(ultimo["yoy_change"])

    otros = []
    mismo_periodo = de_ccaa[(de_ccaa["period"] == ultimo["period"]) & (de_ccaa["indicator_id"].isin(INDICADORES_DEFECTO))]
    for _, r in mismo_periodo.iterrows():
        otros.append(
            {
                "indicator_id": r["indicator_id"],
                "etiqueta": r["indicator_label"],
                "valor": round(float(r["value"]), 2) if pd.notna(r["value"]) else None,
                "variacion_pct": round(float(r["yoy_change"]), 1) if pd.notna(r["yoy_change"]) else None,
                "unidad": r["unit"],
            }
        )

    return {
        "variacion_pct": round(variacion, 1),
        "direccion": "crecimiento" if variacion >= 0 else "caida",
        "periodo": ultimo["period"],
        "indicador": "Pernoctaciones regladas por 1.000 residentes",
        "provisional": bool(ultimo["provisional_flag"]),
        "otros_indicadores": otros,
    }


@router.get("/ccaa/resumen", summary="Alojamiento y restaurante mejor valorados, masificación y tendencia de una CCAA")
def resumen_ccaa(ccaa: str = Query(..., description="Nombre oficial de una CCAA, ver /api/ccaa")):
    perfil = data_loader.cargar_perfil_lugares()
    perfil_ccaa = perfil[perfil["ccaa"] == ccaa]
    if perfil_ccaa.empty:
        raise HTTPException(404, f"no hay lugares registrados para '{ccaa}'")

    return {
        "ccaa": ccaa,
        "mejor_alojamiento": _mejor_de_tipo(perfil_ccaa, "alojamiento"),
        "mejor_restaurante": _mejor_de_tipo(perfil_ccaa, "restauracion"),
        "masificacion": _masificacion(perfil_ccaa, ccaa),
        "tendencia": _tendencia_turistica(ccaa),
    }


@router.get("/ccaa/ranking", summary="Las 19 CCAA ordenadas por satisfacción general o por un aspecto")
def ranking_ccaa(metrica: str = Query(default="general", description="'general', o key de uno de los 11 aspectos")):
    perfil = data_loader.cargar_perfil_lugares()

    if metrica == "general":
        col_pct, col_n, etiqueta = "pct_positivo_general", "n_resenas", "Satisfacción general"
    elif metrica in config.ASPECTO_KEYS:
        col_perfil = config.ASPECTO_COL_PERFIL_BY_KEY[metrica]
        col_pct, col_n, etiqueta = f"pct_positivo_{col_perfil}", f"n_menciones_{col_perfil}", config.ASPECTO_LABEL_BY_KEY[metrica]
    else:
        raise HTTPException(400, f"metrica debe ser 'general' o uno de {config.ASPECTO_KEYS}")

    umbral = config.MIN_MENCIONES_PERFIL if metrica != "general" else 1
    filas = []
    for ccaa, grupo in perfil.groupby("ccaa"):
        sub = grupo[[col_pct, col_n]].dropna()
        sub = sub[sub[col_n] >= umbral]
        menciones = int(sub[col_n].sum())
        valor = float((sub[col_pct] * sub[col_n]).sum() / menciones) if menciones else None
        filas.append(
            {
                "ccaa": ccaa,
                "pct_positivo": round(valor, 4) if valor is not None else None,
                "menciones": menciones,
                "evidencia_suficiente": menciones >= config.MIN_SUPPORT_OPINION,
            }
        )

    filas.sort(key=lambda f: (f["pct_positivo"] is None, -(f["pct_positivo"] or 0)))
    return {"metrica": metrica, "etiqueta": etiqueta, "ccaa": filas}
