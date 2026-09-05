# DICCIONARIO DE COLUMNAS · COLUMN DICTIONARY
**TuriSense · Rol 5 — Opportunity Score · Sesión 13**

Qué significa cada columna de cada archivo, en español y en inglés.
*What every column in every output file means, in Spanish and in English.*

---

## Los cuatro archivos · The four files

| archivo · file | filas · rows | qué es · what it is |
|---|---:|---|
| `opportunity_score.csv` | 19 | **La respuesta principal.** Una fila por comunidad autónoma. Nombres de columna en inglés. |
| `opportunity_score_es.csv` | 19 | El mismo archivo, **nombres de columna en español**. |
| `opportunity_score_mensual.csv` | 320 | La misma puntuación, **mes a mes**. Solo 14 de las 19 CCAA. Inglés. |
| `opportunity_score_mensual_es.csv` | 320 | El mismo archivo mensual, **en español**. |

**Los archivos `_es` son una copia con los encabezados traducidos. Nada más.** Los valores
son idénticos — el notebook lo comprueba en cada ejecución.
*The `_es` files are a header rename of their English twin. The values are identical, and the
notebook verifies it on every run.*

> **Sin tildes en los nombres de columna, a propósito.** Los encabezados acentuados se rompen
> en Excel y Power BI según la codificación que adivinen. La etiqueta con tilde para el
> documento escrito está en la columna «etiqueta» de las tablas de abajo.
> *No accents in column names on purpose — accented headers break in Excel and Power BI
> depending on the encoding they guess.*

**Claves para unir · Join keys:** `ccaa` (los dos archivos) · `ccaa` + `periodo` (el mensual).

---

## 1 · `opportunity_score.csv` — la respuesta principal

Una fila por comunidad autónoma, ordenada de mayor a menor oportunidad.
*One row per region, ranked.*

| columna (ES) | column (EN) | etiqueta | qué significa · what it means | rango · range | qué hacer con ella · what to do with it |
|---|---|---|---|---|---|
| `puesto` | `rank` | Puesto | Posición en la tabla. 1 = mayor oportunidad. | 1–19 | Orden por defecto del dashboard. |
| `ccaa` | `ccaa` | Comunidad autónoma | Nombre oficial de la región. | 19 valores | La clave para unir con cualquier otra tabla. |
| `puntuacion` | `score` | Puntuación | **El número.** `presion × senal × 100`. | 0–100 | El valor a mostrar. No es un porcentaje (ver §4). |
| `presion_turistica` | `pressure` | Presión turística | Cuánto turismo hay realmente. Pernoctaciones reguladas por 1.000 habitantes (Rol 4), expresadas como posición 0–1. Media de 2019-01 a 2025-12. | 0–1 | Explica *por qué* una región puntúa alto sin tener la queja más fuerte. |
| `aspecto_motor` | `driver_aspect` | Aspecto motor | El aspecto sobre el que esta región destaca más frente a las demás. **Es el problema de la región.** | 11 valores (ver §3) | El texto principal junto a la barra. |
| `z` | `z` | z | Cuántas «desviaciones» está esta región por encima de la región media **en ese aspecto**. | −0,37 a +3,40 | Diagnóstico. No lo muestres al usuario final. |
| `senal` | `signal` | Señal de queja | La `z` convertida a 0–1 con `erf(z/√2)`. **0 si la región no está por encima de la media.** | 0–1 | Media del par: `puntuacion = presion × senal × 100`. |
| `menciones` | `mentions` | Menciones | Cuántas personas hablaron de ese aspecto en esa región. | ≥ 50 | El tamaño de la evidencia. Útil en el tooltip. |
| `negativas` | `negatives` | Negativas | De esas menciones, cuántas fueron negativas. | 1–1.106 | Junto con `menciones`: «289 de 3.220». |
| `tasa_negativa` | `negative_rate` | Tasa negativa | `negativas / menciones`. | 0–1 | Muéstrala como % si hace falta. |
| `evidencia` | `evidence` | Evidencia | `solid` o `thin`. **`thin` = menos de 20 quejas reales detrás.** | 2 valores | **Regla 1 del dashboard** (ver §4). |
| `aspecto_2` | `driver_2` | Segundo aspecto | El aspecto que quedó segundo. Vacío si la región solo tiene uno evaluable. | 11 valores o vacío | Se muestra cuando `empate_tecnico` es `True`. |
| `z_2` | `z_2` | z del segundo | La `z` del segundo aspecto. | — | Diagnóstico. |
| `senal_2` | `signal_2` | Señal del segundo | La señal del segundo aspecto. | 0–1 | Diagnóstico. **No se mezcla en la puntuación** (ver §4). |
| `menciones_2` | `mentions_2` | Menciones (2º) | Menciones del segundo aspecto. | ≥ 50 | Tooltip. |
| `negativas_2` | `negatives_2` | Negativas (2º) | Negativas del segundo aspecto. | — | Tooltip. |
| `tasa_negativa_2` | `negative_rate_2` | Tasa negativa (2º) | `negativas_2 / menciones_2`. | 0–1 | Tooltip. |
| `evidencia_2` | `evidence_2` | Evidencia (2º) | `solid` o `thin`, para el segundo aspecto. | 2 valores | Tooltip. |
| `diferencia_z` | `z_gap` | Diferencia de z | `z − z_2`. Cuánta ventaja tiene el aspecto motor sobre el segundo. | ≥ 0, o vacío | Si es pequeña, el «motor» fue casi un empate. |
| `empate_tecnico` | `driver_is_close` | Empate técnico | `True` cuando `diferencia_z < 0,25`. | `True`/`False` | **Regla 2 del dashboard** (ver §4). |
| `aspectos_evaluables` | `n_rankable_aspects` | Aspectos evaluables | Cuántos aspectos de esa región llegaron a las 50 menciones. | 1–11 | Si vale **1** no hay segundo aspecto, y por eso `empate_tecnico` es `False`. |

---

## 2 · `opportunity_score_mensual.csv` — la misma puntuación, mes a mes

Una fila por **comunidad autónoma × mes**, solo para el aspecto motor de esa región.
*One row per region × month, for that region's driver aspect only.*

| columna (ES) | column (EN) | qué significa · what it means | qué hacer con ella |
|---|---|---|---|
| `ccaa` | `ccaa` | La región. | Clave de unión con el archivo principal. |
| `periodo` | `period` | El mes, como texto `AAAA-MM`. Entre `2019-01` y `2025-12`. | Eje X. Es **texto**, no fecha: conviértelo. |
| `aspecto_motor` | `driver_aspect` | **Siempre el mismo aspecto que en el archivo principal.** No se vuelve a elegir cada mes. | Etiqueta de la serie. |
| `menciones` | `mentions` | Menciones de ese aspecto en ese mes. | Siempre ≥ 50: los meses por debajo **no existen en el archivo**. |
| `negativas` | `negatives` | De esas, cuántas fueron negativas. | Tooltip. |
| `tasa_negativa` | `negative_rate` | `negativas / menciones` **de ese mes**. Esto es lo que se mueve. | Serie alternativa, más directa de leer que la puntuación. |
| `media_regiones` | `average_region` | La tasa media entre regiones para ese aspecto. **Congelada**: es la misma en todos los meses. | La línea de referencia. |
| `dispersion` | `spread` | Cuánto difieren las regiones en ese aspecto. **Congelada** igual que la anterior. | Diagnóstico. |
| `z` | `z` | La `z` de ese mes, medida con la regla congelada. | Diagnóstico. |
| `senal` | `signal` | La señal de ese mes, 0–1. | Diagnóstico. |
| `presion_turistica` | `pressure` | La presión **de ese mes concreto**, no la media. Por eso se ve la estacionalidad. | Serie secundaria interesante por sí sola. |
| `puntuacion` | `score` | `presion_turistica × senal × 100` **de ese mes**. | La línea temporal. |
| `evidencia` | `evidence` | `solid` o `thin`, calculado mes a mes. | Punto pálido cuando es `thin`. |

> **Ojo:** esta serie **no es un desglose** de la puntuación principal y no promedia hasta
> ella. Es la misma receta aplicada mes a mes: la principal usa la presión media de siete
> años, cada mes aquí usa la suya.
> *This series is not a decomposition of the headline score and does not average back to it.*

**Cobertura · Coverage: 320 meses-región, y solo 14 de las 19 CCAA.**
Sin serie temporal: **Aragón, Ceuta, Comunidad Foral de Navarra, La Rioja, Melilla.**
Incluso dentro de las 14 es muy desigual — Madrid 74 meses, Extremadura 3.
Los meses con menos de 50 menciones **se eliminan, no se rellenan con cero**: un mes sin
evidencia es desconocido, no tranquilo.

---

## 3 · Los 11 aspectos · The 11 aspects

Vocabulario del Rol 1. Los valores llegan en español y **no se traducen**.

| aspecto | qué recoge · what it covers |
|---|---|
| `trato_anfitrion` | Trato del anfitrión o del personal · host / staff treatment |
| `ubicacion` | Ubicación, cómo de bien situado está · location |
| `equipamiento` | Equipamiento e instalaciones · facilities and equipment |
| `limpieza` | Limpieza · cleanliness |
| `descanso_ruido` | Descanso y ruido · rest and noise |
| `aparcamiento` | Aparcamiento · parking |
| `desayuno_restauracion` | Desayuno y restauración · breakfast and food service |
| `autenticidad` | Autenticidad, carácter local · authenticity, local character |
| `vistas` | Vistas · views |
| `precio` | Precio y relación calidad-precio · price and value |
| `masificacion` | Masificación turística · overcrowding |

---

## 4 · Las tres reglas del dashboard · Three rules for the dashboard

**1. `evidencia = thin` → muéstralo en pálido y nunca como titular.**
Son **6 de 19** regiones: Aragón, C. F. de Navarra, La Rioja, Ceuta, Extremadura, Melilla.
Están en el ranking, pero descansan sobre menos de 20 quejas reales. Melilla tiene 1.
*Ranked, but resting on fewer than 20 actual complaints. Render pale, never headline.*

**2. `empate_tecnico = True` → nombra los DOS aspectos.**
Son **4 de 19**: Castilla y León (diferencia 0,011), Andalucía (0,048),
Castilla-La Mancha (0,090), Extremadura (0,180). Elegir uno solo sería casi cara o cruz.
**Melilla sale `False` porque no tiene con quién empatar** — solo tiene un aspecto evaluable,
y `aspectos_evaluables = 1` es la columna que lo dice.

**3. Cinco regiones tienen puntuación pero NO tienen serie mensual.**
El dashboard tiene que poder dibujar una región con puntuación y con la línea temporal vacía.
No inventes ceros.
*Five regions have a score and no trajectory. The dashboard must render that.*

---

## 5 · Qué NO significa una puntuación de 95

`Canarias 93,4` **no** quiere decir que el 93% de los visitantes se quejen, ni que Canarias
sea el peor destino de España. Quiere decir: *entre las 19 comunidades, esta combina mucha
presión turística con una queja que destaca claramente sobre la media en un aspecto concreto
— aquí, `desayuno_restauracion`.* Es una **prioridad de actuación relativa**, no una nota.

`País Vasco 0,0` tampoco significa «sin problemas»: significa que no está por encima de la
región media en ningún aspecto. El índice lo dice en vez de inventarle un puesto.

*A 95 is a relative action priority among 19 regions, not a grade and not a percentage of
unhappy visitors. A 0 means "above the average region on nothing", not "no problems".*

---

## 6 · Antes de presentar esto · Before presenting this

**La ingeniería está cerrada. La medición todavía no es de nivel tesis**, por motivos que
están todos **aguas arriba** de este notebook:

1. **El sentimiento no es realmente por aspecto** — de las frases con dos o más aspectos, el
   **0,00%** tiene aspectos que discrepen. *(Rol 1)*
2. **El diccionario de aspectos es solo en español** y el inglés es ~42% del corpus.
   Coincidencia: español 82%, inglés 34%. *(Roles 1 y 2)*
3. **`masificacion` apenas se detecta** — 2.735 menciones en siete años, el 0,07% de las
   filas. Es justo el tema central de la tesis. *(Rol 2)*
4. **Solo el 48% de las reseñas menciona algún aspecto.**

**Preséntalo como demostración de método.** El pipeline, la unión y las comprobaciones son
sólidos y no cambiarán cuando mejore la entrada. Solo cambiarán los números.
