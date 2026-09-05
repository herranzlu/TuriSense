"""
Genera data/recomendador/entity_ciudad.parquet: una fila por entity_id con la
ciudad (o, en su defecto, isla/provincia/CCAA) más frecuente entre sus reseñas.

perfil_lugares.parquet no trae ciudad ni nombre del alojamiento: entity_id es un
hash anonimizado. La ciudad SÍ está en reviews_master (columna `destination`,
a distinto nivel de detalle según `destination_level`), así que se calcula aquí
una sola vez, en vez de leer ese parquet de 1.2GB en cada request del backend.

No hay ningún campo con el nombre real del alojamiento/actividad en ningún
fichero de datos, por eso el recomendador solo puede mostrar ciudad + tipo,
nunca "Hotel X" o similar sin inventarlo.

Uso:
    cd backend && source .venv/bin/activate
    python scripts/build_entity_ciudad.py
"""
from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).resolve().parents[2]
ORIGEN = BASE_DIR / "data" / "reviews_absa" / "reviews_master (1).parquet"
DESTINO = BASE_DIR / "data" / "recomendador" / "entity_ciudad.parquet"

# de más a menos específico: se usa el primer nivel que tenga datos para cada entity_id
PRIORIDAD_NIVELES = ["ciudad", "isla", "provincia", "comunidad_autonoma"]


def main() -> None:
    df = pd.read_parquet(ORIGEN, columns=["entity_id", "destination", "destination_level"])

    resultado = None
    pendientes = df
    for nivel in PRIORIDAD_NIVELES:
        nivel_df = pendientes[pendientes["destination_level"] == nivel]
        if nivel_df.empty:
            continue
        moda = (
            nivel_df.groupby("entity_id")["destination"]
            .agg(lambda s: s.mode().iat[0])
            .rename("ciudad")
            .reset_index()
        )
        moda["nivel"] = nivel
        resultado = moda if resultado is None else pd.concat([resultado, moda], ignore_index=True)
        pendientes = pendientes[~pendientes["entity_id"].isin(moda["entity_id"])]

    resultado = resultado.drop_duplicates("entity_id")
    resultado.to_parquet(DESTINO, index=False)

    print(f"{len(resultado):,} entity_id con ciudad asignada")
    print(resultado["nivel"].value_counts().to_string())
    print(f"escrito en {DESTINO.relative_to(BASE_DIR)}")


if __name__ == "__main__":
    main()
