"""
Motor de recomendación: Fase 3 (score de contenido) + Fase 4 (re-ranking por
redistribución), portado tal cual de redomendador/motor_fase34_recomendador.ipynb
(Fase 3+4 del motor real, ya probado allí con 4 casos de control). No es una
aproximación propia: mismos umbrales, misma fórmula, mismo clasificador de tipo
de experiencia.

Únicos cambios frente al notebook: los pesos van 0-1 en vez de 0-5 (el score es
una media ponderada, así que el resultado es idéntico; solo cambia la escala del
slider) y el resultado se enriquece con la ciudad real y, cuando lo hay, el nombre
real (el notebook deja `entity_id` como identificador, "sustituir por nombre si
está disponible": ahora, para lugares que no vienen de Airbnb, ya lo está).
"""
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException

from .. import config, data_loader
from ..schemas import PreferenciasRecomendador

router = APIRouter()

# --- Clasificador de tipo de experiencia (idéntico al motor real) ---------------------
# Calibrado contra los valores reales de property_type: el grueso es el catálogo de
# Airbnb (empieza por "Entire "/"Private room in "/"Room in "/"Shared room in "), más una
# lista de palabras sueltas para lo que no sigue ese patrón.
PREFIJOS_ALOJAMIENTO_AIRBNB = ["entire ", "private room in ", "shared room in ", "room in "]

PALABRAS_ALOJAMIENTO = [
    "hotel", "apartamento", "rental unit", "hostal", "hostel", "casa rural", "casa particular",
    "alojamiento", "resort", "villa", "camping", "campsite", "home", "condo", "loft",
    "serviced apartment", "cottage", "townhouse", "chalet", "vacation home", "guesthouse",
    "guest suite", "farm stay", "tiny home", "bungalow", "place", "cabin", "earthen home",
    "camper", "rv", "boat", "castle", "tent", "hut", "dome", "treehouse", "tipi", "tower",
    "floor", "religious building", "holiday park", "island", "windmill", "cave", "riad",
    "yurt", "ranch", "shepherd", "hostelworld",
]
PALABRAS_RESTAURACION = ["restaurant", "bar", "cafeteria", "cafetería", "restauracion", "restauración"]
PALABRAS_OCIO = [
    "atraccion", "atracción", "turistica", "turística", "parque", "museo", "playa",
    "sendero", "ocio", "tour", "excursion", "excursión", "monumento", "castillo", "mercado",
]

TIPOS_EXPERIENCIA_ETIQUETA = {
    "alojamiento": "Alojamiento",
    "restauracion": "Restauración",
    "ocio": "Ocio y cultura",
    "otro": "Otro",
}


def clasificar_tipo_experiencia(valor: str | None) -> str:
    if not isinstance(valor, str):
        return "otro"
    texto = valor.lower()
    if any(texto.startswith(p) for p in PREFIJOS_ALOJAMIENTO_AIRBNB):
        return "alojamiento"
    if any(p in texto for p in PALABRAS_ALOJAMIENTO):
        return "alojamiento"
    if any(p in texto for p in PALABRAS_RESTAURACION):
        return "restauracion"
    if any(p in texto for p in PALABRAS_OCIO):
        return "ocio"
    return "otro"


def _con_tipo_experiencia(df: pd.DataFrame) -> pd.DataFrame:
    if "tipo_experiencia" not in df.columns:
        df = df.copy()
        df["tipo_experiencia"] = df["property_type"].apply(clasificar_tipo_experiencia)
    return df


def _es_airbnb(property_type: str | None) -> bool:
    if not isinstance(property_type, str):
        return False
    return property_type.lower().startswith(tuple(PREFIJOS_ALOJAMIENTO_AIRBNB))


def _con_nombre_real(df: pd.DataFrame) -> pd.DataFrame:
    """Cruza el nombre real (data/recomendador/entity_id_nombre.csv), pero SOLO para
    lugares que no vienen de Airbnb: esa plataforma no cede el nombre del anuncio como
    dato reutilizable, así que aunque el CSV traiga algo para esas filas (el propio
    título del anuncio, no un nombre de establecimiento), se descarta a propósito para
    no hacer pasar un titular de anuncio por el nombre real de un negocio."""
    if "nombre" in df.columns:
        return df
    df = df.merge(data_loader.cargar_entity_nombre(), on="entity_id", how="left")
    es_airbnb = df["property_type"].apply(_es_airbnb)
    df.loc[es_airbnb, "nombre"] = None
    return df


def _filtrar(
    df: pd.DataFrame,
    territorio: str | None,
    tipo_experiencia: str | None,
    incluir_baja_evidencia: bool = False,
    ciudad: str | None = None,
) -> pd.DataFrame:
    # --- Filtro de calidad mínima (motor real) ---
    if not incluir_baja_evidencia:
        df = df[
            (df["n_resenas"] >= config.MIN_RESENAS_RECOMENDADOR)
            & (df["pct_positivo_general"] >= config.MIN_SENTIMIENTO_RECOMENDADOR)
        ]
    if territorio and territorio.lower() != "todas":
        df = df[df["ccaa"] == territorio]
    if tipo_experiencia and tipo_experiencia.lower() != "todas":
        df = _con_tipo_experiencia(df)
        df = df[df["tipo_experiencia"] == tipo_experiencia]
    # No hay coordenadas en ningún fichero de origen, así que "cerca de un punto X" no
    # se puede filtrar de verdad; la ciudad (ya cruzada en cargar_perfil_lugares_con_ciudad)
    # es el proxy más honesto de "ubicación relativa" que los datos permiten.
    if ciudad and ciudad.lower() != "todas":
        df = df[df["ciudad"] == ciudad]
    return df


def _score_contenido(perfil: pd.DataFrame, pesos: dict[str, float]) -> tuple[pd.Series, pd.Series]:
    """Coincidencia ponderada entre las preferencias y el perfil de cada lugar. Ignora
    aspectos con peso 0 y lugares sin evidencia suficiente en ese aspecto (>= MIN_MENCIONES_PERFIL).
    Devuelve también la evidencia total detrás del score, para desempatar: entre dos lugares con
    el mismo score (un 100% positivo es un techo que alcanzan muchos), gana el que tiene más
    reseñas detrás, no el primero que aparezca en la tabla."""
    pesos_validos = {k: v for k, v in pesos.items() if k in config.ASPECTO_KEYS and v > 0}
    if not pesos_validos:
        return perfil["pct_positivo_general"], perfil["n_resenas"]

    numerador = pd.Series(0.0, index=perfil.index)
    denominador = pd.Series(0.0, index=perfil.index)
    evidencia_total = pd.Series(0.0, index=perfil.index)
    for key, peso in pesos_validos.items():
        col_pct = f"pct_positivo_{config.ASPECTO_COL_PERFIL_BY_KEY[key]}"
        col_n = f"n_menciones_{config.ASPECTO_COL_PERFIL_BY_KEY[key]}"
        valores = perfil[col_pct]
        menciones = perfil[col_n]
        tiene_evidencia = valores.notna() & (menciones >= config.MIN_MENCIONES_PERFIL)
        numerador = numerador + np.where(tiene_evidencia, valores.fillna(0) * peso, 0.0)
        denominador = denominador + np.where(tiene_evidencia, peso, 0.0)
        evidencia_total = evidencia_total + np.where(tiene_evidencia, menciones.fillna(0), 0.0)

    with np.errstate(invalid="ignore", divide="ignore"):
        score = np.where(denominador > 0, numerador / denominador, np.nan)
    return pd.Series(score, index=perfil.index), evidencia_total


def _explicar(fila: pd.Series, aspectos_pedidos: list[str]) -> str:
    destacan = [
        config.ASPECTO_LABEL_BY_KEY[a]
        for a in aspectos_pedidos[:3]
        if pd.notna(fila.get(f"pct_positivo_{config.ASPECTO_COL_PERFIL_BY_KEY[a]}"))
        and fila.get(f"pct_positivo_{config.ASPECTO_COL_PERFIL_BY_KEY[a]}", 0) >= 0.7
    ]
    if destacan:
        return f"Destaca en {', '.join(destacan).lower()}, que marcaste como importante."
    return "Coincide de forma moderada con tus preferencias."


def _puntuar(df: pd.DataFrame, pesos: dict[str, float], peso_anti_masificacion: float) -> pd.DataFrame:
    """Fase 3 (score de contenido) + Fase 4 (re-ranking por redistribución):
    score_final = score_contenido x (1 - peso_anti_masificacion x volumen_relativo).
    Multiplicativo, no resta: penaliza en proporción a lo masificado que esté el lugar,
    nunca hace negativo un score ni lo saca de orden si el resto de aspectos son perfectos."""
    df = df.copy()
    df["match_score"], df["evidencia_score"] = _score_contenido(df, pesos)
    df = df.dropna(subset=["match_score"])
    df["puntuacion_final"] = df["match_score"] * (1 - peso_anti_masificacion * df["volumen_relativo"])
    return df


def _top(df: pd.DataFrame, prefs: PreferenciasRecomendador) -> pd.DataFrame:
    df = _puntuar(df, prefs.pesos_validados(), prefs.peso_anti_masificacion)
    # Desempate: a igual puntuacion_final, gana quien tiene más evidencia detrás del match.
    # ciudad ya viene cruzada desde cargar_perfil_lugares_con_ciudad(): no hace falta
    # otro merge aquí al final, como pasaba antes.
    return df.sort_values(["puntuacion_final", "evidencia_score"], ascending=[False, False]).head(prefs.top_n)


@router.get("/recomendar/filtros", summary="Territorios, ciudades y tipos de experiencia disponibles")
def filtros_recomendador():
    df = _con_tipo_experiencia(data_loader.cargar_perfil_lugares_con_ciudad())
    conteo = df["tipo_experiencia"].value_counts()

    ciudades = (
        df.dropna(subset=["ciudad"])
        .groupby(["ccaa", "ciudad"], observed=True)
        .size()
        .reset_index(name="n_lugares")
        .sort_values(["ccaa", "ciudad"])
    )

    return {
        "territorios": sorted(df["ccaa"].dropna().unique().tolist()),
        "ciudades": [
            {"ciudad": r["ciudad"], "ccaa": r["ccaa"], "n_lugares": int(r["n_lugares"])} for _, r in ciudades.iterrows()
        ],
        "tipos_experiencia": [
            {"valor": t, "etiqueta": TIPOS_EXPERIENCIA_ETIQUETA[t], "n_lugares": int(conteo.get(t, 0))}
            for t in ["alojamiento", "restauracion", "ocio", "otro"]
            if conteo.get(t, 0) > 0
        ],
    }


@router.post("/recomendar", summary="Motor de recomendación: rankea lugares por preferencias, penalizando la masificación")
def recomendar(prefs: PreferenciasRecomendador):
    df = _filtrar(
        data_loader.cargar_perfil_lugares_con_ciudad(),
        prefs.territorio,
        prefs.tipo_experiencia,
        prefs.incluir_baja_evidencia,
        prefs.ciudad,
    )
    if df.empty:
        raise HTTPException(404, "no hay lugares para ese territorio/ciudad/tipo de experiencia")

    df = _con_nombre_real(df)
    top = _top(df, prefs)
    pesos_usuario = prefs.pesos_validados()
    aspectos_pedidos = sorted(pesos_usuario, key=lambda a: pesos_usuario[a], reverse=True)

    lugares = []
    for _, r in top.iterrows():
        nota_redistribucion = None
        if prefs.peso_anti_masificacion > 0 and r["volumen_relativo"] < 0.5:
            nota_redistribucion = f"Recibe menos reseñas que alternativas parecidas en {r['ccaa']}: opción con menos aglomeración."
        lugares.append(
            {
                "entity_id": r["entity_id"],
                "nombre": r["nombre"] if pd.notna(r["nombre"]) else None,
                "ciudad": r["ciudad"] if pd.notna(r["ciudad"]) else None,
                "ciudad_es_aproximada": pd.notna(r["nivel"]) and r["nivel"] != "ciudad",
                "ccaa": r["ccaa"],
                "property_type": r["property_type"],
                "tipo_alojamiento": config.traducir_tipo_alojamiento(r["property_type"]),
                "n_resenas": int(r["n_resenas"]),
                "pct_positivo_general": round(float(r["pct_positivo_general"]), 4),
                "volumen_relativo": round(float(r["volumen_relativo"]), 4),
                "match_score": round(float(r["match_score"]), 4),
                "puntuacion_final": round(float(r["puntuacion_final"]), 4),
                "por_que": _explicar(r, aspectos_pedidos),
                "nota_redistribucion": nota_redistribucion,
            }
        )

    return {
        "n_candidatos": int(len(df)),
        "lugares": lugares,
        "nota": (
            "match_score = media ponderada de %positivo en los aspectos elegidos (o %positivo general, si no se "
            "elige ninguno). puntuacion_final = match_score x (1 - peso_anti_masificacion x volumen_relativo). "
            "Los lugares que no vienen de Airbnb (hoteles, restauración, ocio) muestran su nombre real; los de "
            "Airbnb siguen identificándose por ciudad y tipo, porque esa plataforma no cede el nombre del anuncio "
            "como un dato reutilizable."
        ),
    }


@router.get("/recomendar/impacto", summary="Impacto real de activar el peso anti-masificación, sin preferencias de aspecto")
def impacto_redistribucion(top_n: int = 20):
    df = _filtrar(data_loader.cargar_perfil_lugares_con_ciudad(), None, None, incluir_baja_evidencia=False)

    sin_freno = _puntuar(df, {}, 0.0).sort_values(["puntuacion_final", "evidencia_score"], ascending=[False, False]).head(top_n)
    con_freno = _puntuar(df, {}, 1.0).sort_values(["puntuacion_final", "evidencia_score"], ascending=[False, False]).head(top_n)

    vol_sin = float(sin_freno["volumen_relativo"].mean())
    vol_con = float(con_freno["volumen_relativo"].mean())
    reduccion_pct = (1 - vol_con / vol_sin) * 100 if vol_sin else None

    return {
        "top_n": top_n,
        "volumen_relativo_medio_sin_freno": round(vol_sin, 4),
        "volumen_relativo_medio_con_freno_maximo": round(vol_con, 4),
        "reduccion_pct": round(reduccion_pct, 1) if reduccion_pct is not None else None,
        "nota": (
            "Comparación calculada en vivo sobre perfil_lugares.parquet sin preferencias de aspecto (se ordena "
            "por satisfacción general): top-N antes y después de subir el peso anti-masificación al máximo, "
            "con la misma fórmula del motor real (Fase 4)."
        ),
    }
