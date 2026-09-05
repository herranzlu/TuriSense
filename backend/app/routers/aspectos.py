from fastapi import APIRouter, Query

from .. import config, data_loader

router = APIRouter()


@router.get("/aspectos/ranking", summary="Los 11 aspectos ordenados, peor valorado primero")
def ranking_aspectos(
    ccaa: str | None = Query(
        default=None,
        description="Nombre oficial de una CCAA. Si se omite, es el ranking nacional.",
    ),
):
    df = data_loader.cargar_perfil_lugares()
    if ccaa:
        df = df[df["ccaa"] == ccaa]
        if df.empty:
            return {"ccaa": ccaa, "aspectos": [], "aviso": "no hay lugares registrados para esa CCAA"}

    filas = []
    for aspecto in config.ASPECTOS:
        col_pct = f"pct_positivo_{aspecto['col_perfil']}"
        col_n = f"n_menciones_{aspecto['col_perfil']}"
        sub = df[[col_pct, col_n]].dropna()
        sub = sub[sub[col_n] >= config.MIN_MENCIONES_PERFIL]
        menciones_totales = int(sub[col_n].sum())
        pct_positivo_medio = (
            float((sub[col_pct] * sub[col_n]).sum() / menciones_totales) if menciones_totales else None
        )
        filas.append(
            {
                "aspecto": aspecto["key"],
                "etiqueta": aspecto["label"],
                "pct_positivo": round(pct_positivo_medio, 4) if pct_positivo_medio is not None else None,
                "menciones_totales": menciones_totales,
                "evidencia_suficiente": menciones_totales >= config.MIN_SUPPORT_OPINION,
            }
        )

    # peor primero: menor % positivo primero; sin evidencia suficiente, al final
    filas.sort(key=lambda f: (not f["evidencia_suficiente"], f["pct_positivo"] if f["pct_positivo"] is not None else 1))

    return {
        "ccaa": ccaa or "España (todas las CCAA)",
        "unidad": "proporción [0,1] de menciones positivas, ponderada por nº de menciones de cada lugar",
        "fuente": "perfil_lugares.parquet",
        "aspectos": filas,
    }


@router.get(
    "/aspectos/matriz",
    summary="Matriz CCAA x aspecto (% positivo de cada uno de los 11 aspectos, en cada una de las 19 CCAA)",
)
def matriz_aspectos():
    df = data_loader.cargar_perfil_lugares()

    filas = []
    for ccaa, grupo in df.groupby("ccaa"):
        celdas = {}
        for aspecto in config.ASPECTOS:
            col_pct = f"pct_positivo_{aspecto['col_perfil']}"
            col_n = f"n_menciones_{aspecto['col_perfil']}"
            sub = grupo[[col_pct, col_n]].dropna()
            sub = sub[sub[col_n] >= config.MIN_MENCIONES_PERFIL]
            menciones = int(sub[col_n].sum())
            valor = float((sub[col_pct] * sub[col_n]).sum() / menciones) if menciones else None
            celdas[aspecto["key"]] = {
                "pct_positivo": round(valor, 4) if valor is not None else None,
                "menciones": menciones,
                "evidencia_suficiente": menciones >= config.MIN_SUPPORT_OPINION,
            }
        filas.append({"ccaa": ccaa, "aspectos": celdas})

    filas.sort(key=lambda f: f["ccaa"])
    return {
        "aspectos": [{"key": a["key"], "label": a["label"]} for a in config.ASPECTOS],
        "matriz": filas,
        "unidad": "proporción [0,1] de menciones positivas, ponderada por nº de menciones de cada lugar",
        "fuente": "perfil_lugares.parquet",
    }
