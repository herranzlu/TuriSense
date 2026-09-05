"""
TuriSense: backend del cuadro de mando.

Arquitectura (diapositiva 6 de "cuadro de mando .pptx"): FastAPI sirve endpoints de
solo lectura sobre los ficheros que ya generaron los Roles 1, 4 y 5. No hay base de
datos ni modelos ejecutándose en directo, toda la inferencia ya ocurrió antes, en
Colab. El frontend (HTML/CSS/JS estático) solo consume por fetch(), nunca calcula.

Arrancar en desarrollo:
    cd backend
    uvicorn app.main:app --reload

La app queda en http://127.0.0.1:8000. La propia API sirve el frontend en "/",
así que basta con abrir esa URL en el navegador.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config
from .routers import aspectos, ccaa, contexto, oportunidad, recomendador, resumen, salud, sentimiento, tendencia

app = FastAPI(
    title="TuriSense · API del cuadro de mando",
    description=(
        "Backend de solo lectura: agrega y sirve los datos ya generados por los Roles 1, 4 y 5. "
        "No recalcula ni ejecuta modelos en caliente."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dashboard interno, no público: restringir al dominio real antes de exponerlo fuera
    allow_methods=["*"],
    allow_headers=["*"],
)

class FrontendSinCache(StaticFiles):
    """StaticFiles normal no manda Cache-Control, así que el navegador aplica su propia
    heurística (basada en Last-Modified) y puede seguir sirviendo JS/CSS viejos durante
    horas sin ni preguntarle al servidor, incluso después de un despliegue nuevo. Con
    no-cache, el navegador revalida SIEMPRE (petición condicional con ETag: barata,
    normalmente un 304) en vez de arriesgarse a mezclar un frontend antiguo con un
    backend nuevo, como pasó con las alertas de portada."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


for router in (
    salud.router,
    ccaa.router,
    resumen.router,
    aspectos.router,
    oportunidad.router,
    sentimiento.router,
    recomendador.router,
    contexto.router,
    tendencia.router,
):
    app.include_router(router, prefix="/api")

# El frontend estático se monta el último: así no tapa las rutas /api/* declaradas arriba.
app.mount("/", FrontendSinCache(directory=config.FRONTEND_DIR, html=True), name="frontend")
