import pandas as pd
from fastapi import APIRouter

from .. import data_loader

router = APIRouter()


def _satisfaccion_por_ccaa() -> pd.DataFrame:
    df = data_loader.cargar_perfil_lugares()

    def _agg(g: pd.DataFrame) -> pd.Series:
        return pd.Series(
            {
                "satisfaccion_media": (g["pct_positivo_general"] * g["n_resenas"]).sum() / g["n_resenas"].sum(),
                "n_lugares": len(g),
            }
        )

    return df.groupby("ccaa").apply(_agg, include_groups=False).reset_index()


@router.get(
    "/oportunidad/mapa",
    summary="Mapa de oportunidad: puntuación Rol 5 por CCAA, cruzada con satisfacción real",
)
def mapa_oportunidad():
    score = data_loader.cargar_opportunity_score()
    satisfaccion = _satisfaccion_por_ccaa()
    df = score.merge(satisfaccion, on="ccaa", how="left")

    mediana_satisfaccion = df["satisfaccion_media"].median()
    mediana_presion = df["presion_turistica"].median()

    def _cuadrante(row) -> str | None:
        if pd.isna(row["satisfaccion_media"]):
            return None
        buena = row["satisfaccion_media"] >= mediana_satisfaccion
        mucha_presion = row["presion_turistica"] >= mediana_presion
        if buena and not mucha_presion:
            return "promocionar"
        if not buena and mucha_presion:
            return "renegociar"
        if buena and mucha_presion:
            return "vigilar"
        return "diagnosticar"

    filas = []
    for _, r in df.iterrows():
        filas.append(
            {
                "ccaa": r["ccaa"],
                "ccaa_geojson": data_loader.geojson_de_ccaa(r["ccaa"]),
                "puesto": int(r["puesto"]),
                "puntuacion": round(float(r["puntuacion"]), 2),
                "presion_turistica": round(float(r["presion_turistica"]), 4),
                "satisfaccion_media": None if pd.isna(r["satisfaccion_media"]) else round(float(r["satisfaccion_media"]), 4),
                "n_lugares": None if pd.isna(r["n_lugares"]) else int(r["n_lugares"]),
                "aspecto_motor": r["aspecto_motor"],
                "aspecto_2": None if pd.isna(r["aspecto_2"]) else r["aspecto_2"],
                "empate_tecnico": bool(r["empate_tecnico"]),
                "evidencia": r["evidencia"],
                "menciones": int(r["menciones"]),
                "negativas": int(r["negativas"]),
                "tasa_negativa": round(float(r["tasa_negativa"]), 4),
                "accion_sugerida": _cuadrante(r),
            }
        )

    return {
        "unidad_puntuacion": "0-100: prioridad de actuación relativa entre las 19 CCAA, no un porcentaje de quejas",
        "regla_evidencia": "evidencia='thin' (menos de 20 quejas reales detrás) -> mostrar atenuado, nunca como titular",
        "regla_empate": "empate_tecnico=true (diferencia de z < 0.25 entre 1er y 2º aspecto) -> nombrar los dos",
        "cuadrante": {
            "promocionar": "A los viajeros les gusta y todavía no está masificado: el momento de invertir en marketing.",
            "renegociar": "Recibe mucha presión turística pero la experiencia no acompaña: revisar las condiciones con los socios locales.",
            "vigilar": "Funciona bien hoy, pero con tanta afluencia puede saturarse: no urge actuar, sí conviene seguirlo de cerca.",
            "diagnosticar": "Ni destaca ni está saturada: antes de invertir aquí, hay que entender qué falla aspecto a aspecto.",
        },
        "mediana_satisfaccion": round(float(mediana_satisfaccion), 4),
        "mediana_presion_turistica": round(float(mediana_presion), 4),
        "ccaa": filas,
    }
