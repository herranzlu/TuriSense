# TuriSense: Cuadro de mando

Arquitectura **opción B** de la diapositiva 4/6 de `cuadro de mando .pptx`: backend
FastAPI de solo lectura + frontend HTML/CSS/JS propio. Sin base de datos ni modelos
ejecutándose en directo, toda la inferencia (ABSA, sentimiento) ya ocurrió antes, en
Colab. El backend solo agrega y sirve; el frontend solo consume por `fetch()`.

## Cómo arrancarlo (VS Code)

```bash
cd backend
python3.11 -m venv .venv        # ya está creado si vienes de esta sesión
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt # ya instalado si vienes de esta sesión
uvicorn app.main:app --reload
```

Abre **http://127.0.0.1:8000**. La propia API sirve el frontend en `/`, no hace
falta un segundo servidor ni Live Server. La documentación interactiva de la API
está en http://127.0.0.1:8000/docs.

> Se usa Python 3.11 (no 3.9, la versión por defecto de macOS) porque el código usa
> sintaxis `str | None` que Python 3.9 no soporta. Si no tienes 3.11, instálalo con
> `brew install python@3.11` o Anaconda, y créalo con esa ruta.

## Desplegarlo en Render

El repo ya trae `render.yaml`. En [render.com](https://render.com): New → Blueprint →
conectar este repo de GitHub → Apply. Arranca solo, sin tocar nada más.

Si prefieres crearlo a mano (New → Web Service):
- Build command: `pip install -r backend/requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT --app-dir backend`

El plan gratuito de Render duerme el servicio tras ~15 min sin tráfico: la primera
visita después de una pausa tarda unos 30-50s en despertar. Normal, no está roto.

## Estructura

```
backend/app/
  config.py        : rutas a los datos + vocabulario de los 11 aspectos + CCAA↔geojson
  data_loader.py    : carga cacheada de cada parquet/csv real
  schemas.py        : validación del body de /api/recomendar
  routers/          : un fichero por grupo de endpoints
  main.py           : arma la app y monta el frontend estático

frontend/
  index.html         : las 7 secciones (mapa del sitio, diapositiva 8)
  css/styles.css      : sistema de diseño (colores reales de marca TUI)
  js/api.js           : cliente fetch() contra /api
  js/utils.js         : helpers + fábrica del mapa choropleth (Leaflet)
  js/sections/*.js    : un módulo por sección, con su propio render()
  data/ccaa.geojson   : geometría de las 19 CCAA (codeforgermany/click_that_hood)

data/
  contrato/           : contrato Rol4→Rol6 + las 4 tablas tidy (fuente PRINCIPAL del backend)
  opportunity_score/  : notebook + opportunity_score_es.csv + diccionario (Rol 5)
  recomendador/        : perfil_lugares.parquet (87.721 lugares) + entity_ciudad.parquet (Rol 6)
  reviews_absa/        : reseña-nivel / ABSA en bruto, no se lee en caliente (demasiado grande)
  raw_sources/          : CSVs oficiales crudos, trazabilidad/anexo técnico
```

## Las 7 secciones y sus endpoints

| # | Sección | Endpoint(s) principal(es) |
|---|---|---|
| 1 | Portada | `GET /api/resumen` |
| 2 | Recomendador | `GET /api/recomendar/filtros`, `POST /api/recomendar` |
| 3 | Impacto de la redistribución | `GET /api/recomendar/impacto` |
| 4 | Mapa de oportunidad | `GET /api/oportunidad/mapa` |
| 5 | Qué falla y dónde | `GET /api/aspectos/ranking` |
| 6 | Contexto turístico | `GET /api/contexto` |
| 7 | Tendencia | `GET /api/tendencia` (acepta `source=todas` para agregar las plataformas) |

Utilidad: `GET /api/salud` (estado de los 7 ficheros de datos), `GET /api/ccaa`,
`GET /api/aspectos`, `GET /api/sentimiento/fuentes` + `GET /api/sentimiento/mapa`.

## Decisiones ya tomadas (de las preguntas de la diapositiva 5)

1. **Ruta FastAPI**, no Streamlit. Ya construida, no documentada como futuro.
2. Se implementan **las 7 secciones** del mapa de sitio (diapositiva 8), no solo las 6
   del contrato técnico original.
3. ABSA y Opportunity Score son **datos reales** (`data/opportunity_score/`,
   `data/reviews_absa/`), no la muestra de prueba. El motor de recomendación se
   construyó aquí mismo como un ranking sobre `perfil_lugares.parquet`, ya que ese
   fichero llega ya calculado pero sin el código del ranking final: ver
   "Nota sobre el recomendador" abajo.

## Nota sobre el recomendador y el "93%"

`perfil_lugares.parquet` (87.721 lugares, columnas `pct_positivo_<aspecto>` y
`volumen_relativo`) llegó ya calculado, pero sin el notebook que decide cómo
rankear. `backend/app/routers/recomendador.py` implementa un ranking propio: media
ponderada del `%positivo` en los aspectos elegidos, menos
`peso_anti_masificacion × volumen_relativo` normalizado. Con preferencias neutras
(mismo peso en los 11 aspectos) y evidencia mínima de 10 reseñas por lugar, este
ranking reduce el volumen relativo medio del top-20 en un **~86%** al subir el
freno anti-masificación al máximo (`GET /api/recomendar/impacto`), cerca del 93%
de la diapositiva 10, pero es un número calculado en vivo con esta fórmula, no una
reproducción exacta de un cálculo anterior no documentado. Si aparece el notebook
real del recomendador, se puede sustituir esta función por su lógica exacta sin
tocar el resto del backend.

Tampoco existe en ningún fichero el nombre real de un alojamiento o actividad
(`entity_id` es un hash anonimizado). `backend/scripts/build_entity_ciudad.py`
cruza ese hash con `reviews_master` para sacar la ciudad real de cada lugar; el
recomendador identifica cada resultado por ciudad + tipo, nunca por un nombre
inventado.

## Reglas de negocio ya aplicadas (contrato Rol4 + DICCIONARIO.md de Rol 5)

- Toda celda de opinión con menos de 30 reseñas de soporte se marca
  `evidencia_suficiente: false` (contrato `support_ge_30`) y el frontend la atenúa.
- `evidencia: "thin"` en el Opportunity Score (menos de 20 quejas reales) se pinta
  atenuado en la tabla, nunca como titular.
- `empate_tecnico: true` nombra los dos aspectos motor, no solo el primero.
- Un mes sin evidencia suficiente se deja vacío en la serie de tendencia, nunca se
  rellena con un cero inventado.
- El contexto anual (`/api/contexto`) se etiqueta explícitamente como anual, nunca
  mezclado con la serie mensual.

## Pendiente / próximos pasos

- Sustituir el ranking del recomendador por el notebook real si aparece.
- La nota metodológica (botón "ℹ️" del pie) resume las limitaciones de
  `DICCIONARIO.md` (masificación apenas se detecta en texto, sentimiento no 100%
  fiable por aspecto, diccionario de aspectos solo en español). Ampliarla si el
  tribunal pide más detalle.
- `data/reviews_absa/` no se usa en caliente por tamaño, solo trazabilidad.
