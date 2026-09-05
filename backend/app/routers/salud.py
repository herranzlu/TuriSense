from fastapi import APIRouter

from .. import data_loader

router = APIRouter()


@router.get("/salud", summary="Disponibilidad real de cada fichero de datos")
def salud():
    ficheros = data_loader.estado_ficheros()
    return {
        "ok": all(f["disponible"] for f in ficheros),
        "ficheros": ficheros,
    }
