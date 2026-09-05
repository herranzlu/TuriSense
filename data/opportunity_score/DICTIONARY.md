# COLUMN DICTIONARY
**TuriSense · Role 5 — Opportunity Score · Session 13**

What every column in every output file means. This is the English twin of `DICCIONARIO.md`;
the two carry the same sections in the same order, so they can be read side by side.

---

## The four files

| file | rows | what it is |
|---|---:|---|
| `opportunity_score.csv` | 19 | **The headline answer.** One row per autonomous community. English column names. |
| `opportunity_score_es.csv` | 19 | The same file with **Spanish column names**. |
| `opportunity_score_mensual.csv` | 320 | The same score, **month by month**. Only 14 of the 19 regions. English names. |
| `opportunity_score_mensual_es.csv` | 320 | The same monthly file, **in Spanish**. |

**The `_es` files are a header rename of their English twin. Nothing else changes.** Every
value is identical, and the notebook verifies that cell by cell on every run — if the two ever
disagree, the run stops.

> **No accents in column names, on purpose.** Accented headers break in Excel and Power BI
> depending on the encoding they guess. The accented display label for the written report is
> in the "label" column of the tables below.

**Join keys:** `ccaa` (both files) · `ccaa` + `period` (the monthly file).

---

## 1 · `opportunity_score.csv` — the headline answer

One row per region, ranked from highest opportunity to lowest.

> ### Read this before the table: how the driver is chosen
>
> `driver_aspect` is **not** the aspect people complain about most. It is the aspect on which
> this region is **most unusual compared with the other regions**.
>
> Aspects are complained about at wildly different rates nationally — `masificacion` runs
> about 9% negative, `vistas` about 1.1%. Ranking on the raw rate would return roughly the
> same answer for every region, because it describes the *aspect*, not the *region*. So for
> each aspect the notebook works out the average region's rate and how much regions vary
> around it, then measures how many "spreads" above that average this region sits. That is
> the `z`. The driver is simply the aspect with the highest `z`.
>
> **Worked example — Castilla y León.** Its driver is `vistas` at a 1.5% negative rate, and it
> beats `desayuno_restauracion` at 6.5%. That looks wrong until you see the yardsticks: Spain
> averages **1.14%** on views (CyL is well above) and **5.17%** on breakfast (CyL is barely
> above). Both aspects land at almost the same `z` — 0.886 against 0.875 — which is why that
> region is flagged as a technical tie.
>
> A region that is at or below the average on every aspect gets a signal of exactly **0**. The
> index says "above average on nothing" rather than inventing a rank for it.

| column (EN) | column (ES) | label | what it means | range | what to do with it |
|---|---|---|---|---|---|
| `rank` | `puesto` | Rank | Position in the table. 1 = highest opportunity. | 1–19 | The dashboard's default sort. |
| `ccaa` | `ccaa` | Region | Official name of the autonomous community. | 19 values | The key for joining to any other table. |
| `score` | `puntuacion` | Score | **The number.** `pressure × signal × 100`. | 0.0–93.4 | The value to display. It is not a percentage (see §5). |
| `pressure` | `presion_turistica` | Tourism pressure | How much tourism actually happens there. Regulated overnight stays per 1,000 residents (Role 4), expressed as a 0–1 position among the regions. Averaged over 2019-01 to 2025-12. | 0.09–0.95 | Explains *why* a region can score high without having the strongest complaint. |
| `driver_aspect` | `aspecto_motor` | Driver aspect | The aspect on which this region stands out most against the others. **This is the region's problem.** | 11 values (see §3) | The main label next to the bar. |
| `z` | `z` | z | How many "spreads" above the average region this region sits **on that aspect**. | −0.37 to +3.40 | Diagnostic. Do not show it to an end user. |
| `signal` | `senal` | Complaint signal | `z` converted to 0–1 with `erf(z/√2)`. **Exactly 0 if the region is not above average.** | 0–1 | Half of the pair: `score = pressure × signal × 100`. |
| `mentions` | `menciones` | Mentions | How many people talked about that aspect in that region. | 56–13,685 (floor is 50) | The size of the evidence. Good in a tooltip. |
| `negatives` | `negativas` | Negatives | Of those mentions, how many were negative. | 1–1,106 | Pair it with `mentions`: "289 of 3,220". |
| `negative_rate` | `tasa_negativa` | Negative rate | `negatives / mentions`. | 0–1 | Show as a % if useful. |
| `evidence` | `evidencia` | Evidence | `solid` or `thin`. **`thin` = fewer than 20 actual complaints behind it.** | 2 values | **Dashboard rule 1** (see §4). |
| `driver_2` | `aspecto_2` | Second aspect | The runner-up aspect. Empty when the region has only one eligible aspect. | 11 values, or empty | Shown when `driver_is_close` is `True`. |
| `z_2` | `z_2` | z of the runner-up | The runner-up's `z`. | −0.68 to +2.44 | Diagnostic. |
| `signal_2` | `senal_2` | Signal of the runner-up | The runner-up's signal. | 0–1 | Diagnostic. **It is never blended into the score** (see §5). |
| `mentions_2` | `menciones_2` | Mentions (2nd) | Mentions of the runner-up aspect. | ≥ 50 | Tooltip. |
| `negatives_2` | `negativas_2` | Negatives (2nd) | Negatives of the runner-up aspect. | — | Tooltip. |
| `negative_rate_2` | `tasa_negativa_2` | Negative rate (2nd) | `negatives_2 / mentions_2`. | 0–1 | Tooltip. |
| `evidence_2` | `evidencia_2` | Evidence (2nd) | `solid` or `thin`, for the runner-up aspect. | 2 values | Tooltip. |
| `z_gap` | `diferencia_z` | z gap | `z − z_2`. How far ahead the driver is. Always ≥ 0. Empty for a region with no runner-up. | 0.011–1.60, or empty | Small gap = the "driver" was almost a coin flip. |
| `driver_is_close` | `empate_tecnico` | Technical tie | `True` when `z_gap < 0.25`. **True means the two aspects are CLOSE together, not far apart.** | `True`/`False` | **Dashboard rule 2** (see §4). |
| `n_rankable_aspects` | `aspectos_evaluables` | Eligible aspects | How many of that region's aspects reached the 50-mention floor. | 1–11 | If it is **1** there is no runner-up, and that is why `driver_is_close` is `False`. |

---

## 2 · `opportunity_score_mensual.csv` — the same score, month by month

One row per **region × month**, and only for that region's driver aspect.

| column (EN) | column (ES) | what it means | what to do with it |
|---|---|---|---|
| `ccaa` | `ccaa` | The region. | Join key to the headline file. |
| `period` | `periodo` | The month, as the text `YYYY-MM`. Between `2019-01` and `2025-12`. | X axis. It is **text**, not a date — parse it. |
| `driver_aspect` | `aspecto_motor` | **Always the same aspect as in the headline file.** It is not re-chosen each month. | Series label. |
| `mentions` | `menciones` | Mentions of that aspect in that month. | Always ≥ 50: months below the floor **are not in the file at all**. |
| `negatives` | `negativas` | Of those, how many were negative. | Tooltip. |
| `negative_rate` | `tasa_negativa` | `negatives / mentions` **for that month**. This is the thing that actually moves. | An alternative series, easier to read than the score. |
| `average_region` | `media_regiones` | The average across-regions rate for that aspect. **Frozen** — identical in every month. | The reference line. |
| `spread` | `dispersion` | How much regions differ on that aspect. **Frozen**, same as above. | Diagnostic. |
| `z` | `z` | That month's `z`, measured against the frozen yardstick. | Diagnostic. |
| `signal` | `senal` | That month's signal, 0–1. | Diagnostic. |
| `pressure` | `presion_turistica` | The pressure **of that specific month**, not the average. This is why seasonality shows. | An interesting secondary series in its own right. |
| `score` | `puntuacion` | `pressure × signal × 100` **for that month**. | The time line. |
| `evidence` | `evidencia` | `solid` or `thin`, recomputed month by month. | Pale marker when `thin`. |

> **This series is not a decomposition of the headline score, and it does not average back to
> it.** It is the same recipe applied month by month: the headline uses seven years of average
> pressure, each month here uses its own.

**Coverage: 320 region-months, and only 14 of the 19 regions.**
No trajectory at all for: **Aragón, Ceuta, Comunidad Foral de Navarra, La Rioja, Melilla.**
Even within the 14 it is very uneven — Madrid has 74 months, Extremadura 3.
Months below 50 mentions are **dropped, not filled with zero**: a month with no evidence is
unknown, not calm.

> ### Warning: `evidence` is nearly always `thin` in this file
>
> **294 of the 320 rows are `thin`** — 92%. The 20-complaint threshold was designed for a
> seven-year total, and almost no single month can clear it. Castilla y León's biggest month
> has 7 complaints; its monthly score swings 0 → 41.6 → 0 → 0 → 68.4 → 34.1 on counts between
> 0 and 7. That is noise, not a trajectory.
>
> The threshold is deliberately left unchanged — the flag is reporting something true, which
> is that the data is not dense enough for month-by-month claims. **Do not build a headline
> trend chart on this file.** Use it to show seasonality in `pressure`, and to show that the
> method extends to a time series, not to argue that a region got better or worse.

---

## 3 · The 11 aspects

Role 1's vocabulary. The values arrive in Spanish and are **not translated** — use these
strings exactly as they appear in the data.

| aspect | what it covers |
|---|---|
| `trato_anfitrion` | Host / staff treatment |
| `ubicacion` | Location, how well situated the place is |
| `equipamiento` | Facilities and equipment |
| `limpieza` | Cleanliness |
| `descanso_ruido` | Rest and noise |
| `aparcamiento` | Parking |
| `desayuno_restauracion` | Breakfast and food service |
| `autenticidad` | Authenticity, local character |
| `vistas` | Views |
| `precio` | Price and value for money |
| `masificacion` | Tourist overcrowding |

---

## 4 · Three rules for the dashboard

**1. `evidence = thin` → render it pale, and never as a headline.**
That is **6 of 19** regions: Aragón, Comunidad Foral de Navarra, La Rioja, Ceuta, Extremadura,
Melilla. They stay in the ranking, but they rest on fewer than 20 real complaints — Melilla
has 1. Ranked, yes; quotable, no.
*Worth knowing: Castilla y León is the most fragile `solid` in the table, at 24 complaints
against a threshold of 20. The next ones up are Comunitat Valenciana (29) and Asturias (45).*

**2. `driver_is_close = True` → name BOTH aspects.**
That is **4 of 19**: Castilla y León (gap 0.011), Andalucía (0.048), Castilla-La Mancha
(0.090), Extremadura (0.180). Naming only one would be close to a coin flip.
**Melilla comes out `False` for a different reason** — it has nothing to tie with. It has only
one eligible aspect, and `n_rankable_aspects = 1` is the column that says so. `False` there
means "no comparison exists", not "clear winner".

**3. Five regions have a score but NO monthly series.**
The dashboard has to be able to draw a region that has a score and an empty time line.
Do not invent zeros.

---

## 5 · What a score of 95 does NOT mean

`Canarias 93.4` does **not** mean 93% of visitors complain, and it does not mean Canarias is
Spain's worst destination. It means: *among the 19 regions, this one combines heavy tourism
pressure with a complaint that clearly stands out above the average on one specific aspect —
here, `desayuno_restauracion`.* It is a **relative action priority**, not a grade.

`País Vasco 0.0` does not mean "no problems" either. It means the region is not above the
average region on any aspect, so its signal is 0. Note that its driver, `precio`, still has
**358 complaints out of 5,445 mentions** — a 6.6% negative rate. It scores 0 because Spain's
average on `precio` is 7.2%, which is *higher*. The index says "above average on nothing"
rather than inventing a rank for it.

**The score keeps one driver on purpose.** Blending the top two aspects 60/40 was tested and
rejected: it changed nothing (rank correlation 0.958, same top 5) and it can only ever *lower*
a score, which would punish a region for having one clear problem instead of two. That is why
`signal_2` exists in the file but never enters the arithmetic.

---

## 6 · Before presenting this

**The engineering is closed. The measurement is not yet thesis-grade**, for reasons that all
sit **upstream** of this notebook:

1. **The sentiment is not really aspect-level.** Of the fragments carrying two or more
   aspects, **0.00%** have aspects that disagree — one label per fragment is being copied onto
   every aspect in it. *(Role 1)*
2. **The aspect dictionary is Spanish-only** and English is ~42% of the corpus. Match rates:
   Spanish 82%, English 34%. That bias runs along the exact axis the index ranks on.
   *(Roles 1 and 2)*
3. **`masificacion` is barely detected** — 2,735 mentions in seven years, 0.07% of rows. That
   is awkward, because overcrowding is the thesis's central theme. *(Role 2)*
4. **Only 48% of reviews mention any aspect at all.**

Also for the write-up: complaints come mostly from Airbnb (87% of tagged rows) while the
official pressure figure counts regulated accommodation, so the two sides do not quite cover
the same market. And `period` may be the month a review was *published*, not the month of the
stay.

**Present this as a method demonstration.** The pipeline, the join and the checks are sound
and will not change when the input improves. Only the numbers will.
