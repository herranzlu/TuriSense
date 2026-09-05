"""
Configuración central del backend TuriSense.

Un único sitio para:
- Las rutas a los ficheros de datos reales (ver /data/contrato, /data/opportunity_score,
  /data/recomendador).
- El vocabulario de los 11 aspectos: el nombre de cada uno no se escribe igual en cada
  tabla (snake_case en las tablas de opinión, "Trato/Anfitrión" con tilde y barra en el
  mart del recomendador): aquí se resuelve una sola vez.
- El mapeo CCAA -> nombre usado en el geojson que dibuja el mapa en el frontend.

Si algún día cambia el nombre de una columna o de un fichero, se cambia aquí y no hay
que tocar cada router.
"""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]  # .../VISUALIZACIÓN
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIR = BASE_DIR / "frontend"

# --- Ficheros reales (contrato Rol4 -> Rol6, opportunity score de Rol 5, recomendador) ---
CONTRATO_DIR = DATA_DIR / "contrato"
OFICIAL_MENSUAL_PARQUET = CONTRATO_DIR / "R4_DASHBOARD_OFICIAL_TIDY_CCAA_MES.parquet"
OPINION_GLOBAL_PARQUET = CONTRATO_DIR / "R4_DASHBOARD_OPINION_GLOBAL_TIDY.parquet"
OPINION_ASPECTO_PARQUET = CONTRATO_DIR / "R4_DASHBOARD_OPINION_ASPECTO_TIDY.parquet"
CONTEXTO_ANUAL_PARQUET = CONTRATO_DIR / "R4_DASHBOARD_CONTEXTO_ANUAL_CCAA.parquet"
DIM_CCAA_CSV = CONTRATO_DIR / "dim_ccaa.csv"

OPORTUNIDAD_DIR = DATA_DIR / "opportunity_score"
OPORTUNIDAD_CSV = OPORTUNIDAD_DIR / "opportunity_score_es.csv"

RECOMENDADOR_DIR = DATA_DIR / "recomendador"
PERFIL_LUGARES_PARQUET = RECOMENDADOR_DIR / "perfil_lugares.parquet"
# Generado por backend/scripts/build_entity_ciudad.py. perfil_lugares.parquet no
# trae ciudad (entity_id es un hash anonimizado); la ciudad se saca aparte de
# reviews_master.
ENTITY_CIUDAD_PARQUET = RECOMENDADOR_DIR / "entity_ciudad.parquet"
# Nombre real, solo para lugares que NO vienen de Airbnb (hoteles, restauración, ocio):
# Airbnb no cede el nombre del anuncio como dato reutilizable, así que esas filas
# siguen identificándose por ciudad + tipo, nunca con el título del anuncio. El filtro
# por property_type vive en recomendador.py, junto al resto del motor.
ENTITY_NOMBRE_CSV = RECOMENDADOR_DIR / "entity_id_nombre.csv"

REQUIRED_FILES = {
    "oficial_mensual": OFICIAL_MENSUAL_PARQUET,
    "opinion_global": OPINION_GLOBAL_PARQUET,
    "opinion_aspecto": OPINION_ASPECTO_PARQUET,
    "contexto_anual": CONTEXTO_ANUAL_PARQUET,
    "dim_ccaa": DIM_CCAA_CSV,
    "opportunity_score": OPORTUNIDAD_CSV,
    "perfil_lugares": PERFIL_LUGARES_PARQUET,
    "entity_ciudad": ENTITY_CIUDAD_PARQUET,
}

# --- Los 11 aspectos: una entrada por aspecto, con su forma exacta en cada tabla -------
ASPECTOS = [
    {"key": "trato_anfitrion", "label": "Trato / Anfitrión", "col_perfil": "Trato/Anfitrión"},
    {"key": "ubicacion", "label": "Ubicación", "col_perfil": "Ubicación"},
    {"key": "equipamiento", "label": "Equipamiento", "col_perfil": "Equipamiento"},
    {"key": "limpieza", "label": "Limpieza", "col_perfil": "Limpieza"},
    {"key": "descanso_ruido", "label": "Descanso / Ruido", "col_perfil": "Descanso/Ruido"},
    {"key": "aparcamiento", "label": "Aparcamiento", "col_perfil": "Aparcamiento"},
    {"key": "desayuno_restauracion", "label": "Desayuno / Restauración", "col_perfil": "Desayuno/Restauración"},
    {"key": "autenticidad", "label": "Autenticidad", "col_perfil": "Autenticidad"},
    {"key": "vistas", "label": "Vistas", "col_perfil": "Vistas"},
    {"key": "precio", "label": "Precio", "col_perfil": "Precio"},
    {"key": "masificacion", "label": "Masificación", "col_perfil": "Masificación"},
]
ASPECTO_KEYS = [a["key"] for a in ASPECTOS]
ASPECTO_LABEL_BY_KEY = {a["key"]: a["label"] for a in ASPECTOS}
ASPECTO_COL_PERFIL_BY_KEY = {a["key"]: a["col_perfil"] for a in ASPECTOS}

# --- Umbrales mínimos de evidencia -----------------------------------------------------
# El contrato Rol4 -> Rol6 exige: "ocultar o marcar las celdas de opinión con
# support_ge_30=false". Usamos el mismo umbral a nivel de lugar individual.
MIN_SUPPORT_OPINION = 30
# Estos dos, y todo el motor de recomendador.py, son los del motor real
# (redomendador/motor_fase34_recomendador.ipynb, Fase 3+4), no una aproximación propia.
MIN_MENCIONES_PERFIL = 5  # UMBRAL_MIN_MENCIONES_ASPECTO del motor
MIN_RESENAS_RECOMENDADOR = 5  # UMBRAL_MIN_RESENAS del motor
MIN_SENTIMIENTO_RECOMENDADOR = 0.3  # UMBRAL_MIN_SENTIMIENTO del motor: por debajo, nunca se recomienda

# --- CCAA: código oficial -> nombre oficial -> nombre en el geojson del mapa -> imagen -
# (frontend/data/ccaa.geojson, fuente: codeforgermany/click_that_hood; las imágenes en
# frontend/img/ccaa/, normalizadas a 600x400 desde "imagenes de portada" con
# backend/scripts/procesar_imagenes_ccaa.py)
CCAA = [
    {"code": 1, "ccaa": "Andalucía", "geojson": "Andalucia", "imagen": "andalucia.jpg"},
    {"code": 2, "ccaa": "Aragón", "geojson": "Aragon", "imagen": "aragon.jpg"},
    {"code": 3, "ccaa": "Principado de Asturias", "geojson": "Asturias", "imagen": "asturias.jpg"},
    {"code": 4, "ccaa": "Illes Balears", "geojson": "Baleares", "imagen": "baleares.jpg"},
    {"code": 5, "ccaa": "Canarias", "geojson": "Canarias", "imagen": "canarias.jpg"},
    {"code": 6, "ccaa": "Cantabria", "geojson": "Cantabria", "imagen": "cantabria.jpg"},
    {"code": 7, "ccaa": "Castilla y León", "geojson": "Castilla-Leon", "imagen": "castilla-y-leon.jpg"},
    {"code": 8, "ccaa": "Castilla-La Mancha", "geojson": "Castilla-La Mancha", "imagen": "castilla-la-mancha.jpg"},
    {"code": 9, "ccaa": "Cataluña", "geojson": "Cataluña", "imagen": "cataluna.jpg"},
    {"code": 10, "ccaa": "Comunitat Valenciana", "geojson": "Valencia", "imagen": "comunitat-valenciana.jpg"},
    {"code": 11, "ccaa": "Extremadura", "geojson": "Extremadura", "imagen": "extremadura.jpg"},
    {"code": 12, "ccaa": "Galicia", "geojson": "Galicia", "imagen": "galicia.jpg"},
    {"code": 13, "ccaa": "Comunidad de Madrid", "geojson": "Madrid", "imagen": "madrid.jpg"},
    {"code": 14, "ccaa": "Región de Murcia", "geojson": "Murcia", "imagen": "murcia.jpg"},
    {"code": 15, "ccaa": "Comunidad Foral de Navarra", "geojson": "Navarra", "imagen": "navarra.jpg"},
    {"code": 16, "ccaa": "País Vasco", "geojson": "Pais Vasco", "imagen": "pais-vasco.jpg"},
    {"code": 17, "ccaa": "La Rioja", "geojson": "La Rioja", "imagen": "la-rioja.jpg"},
    {"code": 18, "ccaa": "Ceuta", "geojson": "Ceuta", "imagen": "ceuta.jpg"},
    {"code": 19, "ccaa": "Melilla", "geojson": "Melilla", "imagen": "melilla.jpg"},
]
GEOJSON_NAME_BY_CCAA = {c["ccaa"]: c["geojson"] for c in CCAA}

# --- Tipos de alojamiento/lugar: traducción a español natural -------------------------
# perfil_lugares.parquet mezcla el vocabulario de tipos de anuncio de Airbnb (en inglés,
# "Entire rental unit", "Private room in condo"...) con categorías propias en snake_case
# (restaurante, tour_actividad...). No hay nombre real de ningún alojamiento/actividad en
# ningún fichero (entity_id es un hash anonimizado); esto NO sustituye un nombre, solo
# traduce la categoría para que no se vea la jerga de la plataforma origen.
_TIPOS_BASE_ES = {
    "rental unit": "apartamento",
    "condo": "apartamento",
    "loft": "loft",
    "villa": "villa",
    "cabin": "cabaña",
    "chalet": "chalet",
    "cottage": "casa rural",
    "guesthouse": "casa de huéspedes",
    "guest suite": "suite",
    "home": "casa",
    "home/apt": "casa o apartamento",
    "hostel": "hostal",
    "serviced apartment": "apartamento con servicios",
    "townhouse": "casa adosada",
    "vacation home": "casa de vacaciones",
    "bungalow": "bungaló",
    "boat": "barco",
    "camper/rv": "autocaravana",
    "casa particular": "casa particular",
    "castle": "castillo",
    "cave": "cueva",
    "dome": "domo",
    "earthen home": "casa de tierra",
    "farm stay": "granja",
    "floor": "piso",
    "nature lodge": "refugio en la naturaleza",
    "pension": "pensión",
    "tent": "tienda de campaña",
    "tiny home": "mini casa",
    "treehouse": "casa en un árbol",
    "bed and breakfast": "casa con desayuno incluido",
    "aparthotel": "aparthotel",
    "boutique hotel": "hotel con encanto",
    "heritage hotel": "hotel con historia",
    "hotel": "hotel",
    "barn": "granero",
    "campsite": "camping",
    "holiday park": "parque de vacaciones",
    "hut": "cabaña rústica",
    "island": "isla",
    "ranch": "rancho",
    "religious building": "edificio religioso",
    "riad": "riad",
    "shepherd’s hut": "cabaña de pastor",
    "tipi": "tipi",
    "tower": "torre",
    "windmill": "molino",
    "yurt": "yurta",
}

_CATEGORIAS_ES = {
    "atraccion_turistica": "Atracción turística",
    "hostel": "Hostal",
    "hosteleria": "Hostelería",
    "hotel": "Hotel",
    "mercado": "Mercado",
    "ocio_naturaleza": "Ocio y naturaleza",
    "restaurante": "Restaurante",
    "tour_actividad": "Tour / actividad",
}


def traducir_tipo_alojamiento(valor: str) -> str:
    if not valor:
        return valor
    if valor in _CATEGORIAS_ES:
        return _CATEGORIAS_ES[valor]

    v = valor.strip()
    vl = v.lower()

    def _tipo_base(resto: str) -> str:
        return _TIPOS_BASE_ES.get(resto.lower(), resto)

    if vl == "entire place":
        return "Vivienda completa"
    if vl.startswith("entire "):
        return f"Vivienda completa · {_tipo_base(v[7:])}"
    if vl.startswith("private room in "):
        return f"Habitación privada en {_tipo_base(v[16:])}"
    if vl.startswith("room in "):
        return f"Habitación en {_tipo_base(v[8:])}"
    if vl.startswith("shared room in "):
        return f"Habitación compartida en {_tipo_base(v[15:])}"
    if vl == "private room":
        return "Habitación privada"
    if vl == "shared room":
        return "Habitación compartida"

    # tipos "sueltos" (Boat, Castle, Tent...) sin prefijo: la propiedad entera es de
    # ese tipo, se traduce directamente el sustantivo
    return _tipo_base(v).capitalize()
