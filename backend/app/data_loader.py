"""
Carga perezosa y cacheada de los ficheros reales.

Cada función de carga se ejecuta una sola vez por proceso (lru_cache): FastAPI la
vuelve a llamar en cada request, pero pandas no vuelve a leer el fichero del disco.

Nada aquí infiere ni recalcula lo que ya hicieron los Roles 1, 4 y 5: como mucho se
hace un groupby/merge de agregación para servir la respuesta, nunca una predicción
nueva. Esa es la regla de arquitectura de la diapositiva 6 y del apartado 2 de
DICCIONARIO.md: "el backend no recalcula nada".
"""
from functools import lru_cache

import pandas as pd

from . import config


@lru_cache
def cargar_oficial_mensual() -> pd.DataFrame:
    return pd.read_parquet(config.OFICIAL_MENSUAL_PARQUET)


@lru_cache
def cargar_opinion_global() -> pd.DataFrame:
    return pd.read_parquet(config.OPINION_GLOBAL_PARQUET)


@lru_cache
def cargar_opinion_aspecto() -> pd.DataFrame:
    return pd.read_parquet(config.OPINION_ASPECTO_PARQUET)


@lru_cache
def cargar_contexto_anual() -> pd.DataFrame:
    return pd.read_parquet(config.CONTEXTO_ANUAL_PARQUET)


@lru_cache
def cargar_dim_ccaa() -> pd.DataFrame:
    return pd.read_csv(config.DIM_CCAA_CSV)


@lru_cache
def cargar_opportunity_score() -> pd.DataFrame:
    df = pd.read_csv(config.OPORTUNIDAD_CSV)
    df["empate_tecnico"] = df["empate_tecnico"].astype(bool)
    return df


@lru_cache
def cargar_perfil_lugares() -> pd.DataFrame:
    # entity_id se guardó como índice del parquet, no como columna: lo recuperamos
    # como columna normal para poder filtrar/agrupar por él como el resto.
    df = pd.read_parquet(config.PERFIL_LUGARES_PARQUET)
    if df.index.name == "entity_id":
        df = df.reset_index()
    return df


@lru_cache
def cargar_entity_ciudad() -> pd.DataFrame:
    return pd.read_parquet(config.ENTITY_CIUDAD_PARQUET)


@lru_cache
def cargar_entity_nombre() -> pd.DataFrame:
    """entity_id -> nombre real, solo para lugares que no vienen de Airbnb (ver
    config.ENTITY_NOMBRE_CSV). Si el fichero no está presente, se sigue funcionando
    igual que antes (todo identificado por ciudad + tipo): es un plus, no un requisito."""
    if not config.ENTITY_NOMBRE_CSV.exists():
        return pd.DataFrame(columns=["entity_id", "nombre"])
    return pd.read_csv(config.ENTITY_NOMBRE_CSV)


@lru_cache
def cargar_perfil_lugares_con_ciudad() -> pd.DataFrame:
    """perfil_lugares con la ciudad ya cruzada, para poder filtrar por ciudad antes de
    puntuar (no solo para mostrarla al final del todo, como hacía el recomendador)."""
    return cargar_perfil_lugares().merge(cargar_entity_ciudad(), on="entity_id", how="left")


def geojson_de_ccaa(nombre_ccaa: str) -> str | None:
    return config.GEOJSON_NAME_BY_CCAA.get(nombre_ccaa)


def estado_ficheros() -> list[dict]:
    """Usado por /api/salud: comprueba que cada fichero existe y se puede leer.

    Para los parquet solo lee los metadatos (filas/columnas), no el contenido:
    así /api/salud responde al instante incluso con ficheros grandes.
    """
    import pyarrow.parquet as pq

    estado = []
    for nombre, ruta in config.REQUIRED_FILES.items():
        item = {
            "dataset": nombre,
            "ruta": str(ruta.relative_to(config.BASE_DIR)),
            "disponible": False,
        }
        try:
            if not ruta.exists():
                raise FileNotFoundError("el fichero no existe en esa ruta")
            if ruta.suffix == ".parquet":
                pf = pq.ParquetFile(ruta)
                item["filas"] = pf.metadata.num_rows
                item["columnas"] = len(pf.schema_arrow.names)
            else:
                df = pd.read_csv(ruta)
                item["filas"] = len(df)
                item["columnas"] = len(df.columns)
            item["disponible"] = True
        except Exception as exc:  # noqa: BLE001 (queremos reportar cualquier fallo, no ocultarlo)
            item["error"] = str(exc)
        estado.append(item)
    return estado
