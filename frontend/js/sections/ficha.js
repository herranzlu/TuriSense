// Ficha de destino: reúne en una sola pantalla lo que hoy está repartido entre
// Oportunidades, Problemas a tener en cuenta, Comparar destinos, Contexto turístico
// y Actualidad. No calcula nada nuevo: cada dato viene literalmente de los mismos
// endpoints que ya usan esas pestañas, solo que filtrados a una CCAA y reunidos aquí.
import { api } from "../api.js";
import { el, fmtNum, fmtPct, badgeEvidencia, conCarga, llenarSelect } from "../utils.js";

let inicializado = false;
let etiquetaAspecto = {}; // key -> label real (con tildes), de /api/aspectos: evita mostrar la clave interna en crudo

const ETIQUETA_ACCION = { promocionar: "Promocionar", renegociar: "Renegociar", vigilar: "Vigilar", diagnosticar: "Diagnosticar" };
const COLOR_ACCION_TEXTO = { promocionar: "#5C7400", renegociar: "#9A1F22", vigilar: "#7A5A00", diagnosticar: "#092A5E" };
const nombreAspecto = (key) => (etiquetaAspecto[key] ?? key.replace("_", " ")).toLowerCase();

function panel(titulo, cuerpoHtml, extra = "") {
  return `<div class="panel ficha-bloque" ${extra}><h3>${titulo}</h3>${cuerpoHtml}</div>`;
}

function bloqueOportunidad(fila) {
  if (!fila) return panel("Oportunidad", `<p class="muted">Sin datos de oportunidad para este destino.</p>`);
  const accion = fila.accion_sugerida;
  return panel(
    "Oportunidad",
    `<div class="ficha-oportunidad-cabecera">
      <div class="ficha-oportunidad-puntuacion">${fila.puntuacion}<span class="muted">/100</span></div>
      <div>
        <div style="font-weight:700;color:${COLOR_ACCION_TEXTO[accion] ?? "inherit"}">${ETIQUETA_ACCION[accion] ?? "N/D"}</div>
        <div class="muted" style="font-size:.82rem">Puesto ${fila.puesto} de 19 ${fila.evidencia === "thin" ? badgeEvidencia(false) : ""}</div>
      </div>
    </div>
    <p style="margin-top:.6rem">Satisfacción de los viajeros: <strong>${fmtPct(fila.satisfaccion_media)}</strong> ·
    Presión turística oficial: <strong>${fmtPct(fila.presion_turistica)}</strong></p>
    <p class="muted">Lo que más pesa en esta puntuación es <strong>${nombreAspecto(fila.aspecto_motor)}</strong>${
      fila.empate_tecnico ? ` (empatado con ${nombreAspecto(fila.aspecto_2)})` : ""
    }.</p>`,
  );
}

function bloqueAspectos(data) {
  if (!data?.aspectos?.length) return panel("Fortalezas y debilidades", `<p class="muted">Sin datos suficientes.</p>`);
  const ordenados = [...data.aspectos]; // ya viene peor primero
  const debilidades = ordenados.slice(0, 3);
  const fortalezas = ordenados.slice(-3).reverse();
  const fila = (a) => `<li>${a.etiqueta}: <strong>${fmtPct(a.pct_positivo)}</strong>${a.evidencia_suficiente ? "" : " " + badgeEvidencia(false)}</li>`;
  return panel(
    "Fortalezas y debilidades",
    `<div class="ficha-dos-columnas">
      <div><h4 class="ficha-subtitulo" style="color:var(--verde-sostenible)">Para destacar</h4><ul>${fortalezas.map(fila).join("")}</ul></div>
      <div><h4 class="ficha-subtitulo" style="color:var(--rojo-primario)">Para advertir</h4><ul>${debilidades.map(fila).join("")}</ul></div>
    </div>`,
  );
}

function bloqueContexto(benchmark, definicion) {
  if (!benchmark) return panel("Contexto turístico", `<p class="muted">Sin datos de posicionamiento para este destino.</p>`);
  return panel(
    "Contexto turístico",
    `<p>Volumen de turismo (percentil entre las 19 CCAA): <strong>${Math.round(benchmark.escala_percentil * 100)}</strong> ·
    Presión sobre la población: <strong>${Math.round(benchmark.intensidad_percentil * 100)}</strong></p>
    <p class="muted">${definicion?.[benchmark.cuadrante] ?? ""}</p>`,
  );
}

function bloqueActualidad(alertas) {
  if (!alertas.length) {
    return panel("Actualidad", `<p class="muted">Ninguna combinación de este destino lleva 2+ meses empeorando ahora mismo.</p>`);
  }
  const fila = (a) =>
    `<li><strong>${a.meses_consecutivos_empeorando} meses</strong> empeorando en ${nombreAspecto(a.aspecto)}
     (${(a.tasa_negativa_actual * 100).toFixed(1)}% negativo en ${a.periodo})</li>`;
  return panel("Actualidad", `<ul>${alertas.map(fila).join("")}</ul>`);
}

function bloqueLugar(icono, titulo, info) {
  if (!info) return `<div class="ficha-lugar"><div class="muted">${icono} ${titulo}: sin datos suficientes.</div></div>`;
  const nombre = info.nombre ?? `${info.ciudad ?? ""} (${info.tipo_alojamiento})`;
  return `
    <div class="ficha-lugar">
      <div class="lugar-titulo">${icono} ${titulo}</div>
      <div style="font-weight:700">${nombre}</div>
      <div class="muted" style="font-size:.82rem">${info.ciudad ?? ""} · ${fmtNum(info.n_resenas)} reseñas · ${fmtPct(info.pct_positivo_general)} positivo</div>
    </div>`;
}

function bloqueEstablecimientos(resumen, lugares) {
  const destacados = lugares
    .slice(0, 4)
    .map((l) => {
      const nombre = l.nombre ?? l.ciudad ?? l.ccaa;
      const consulta = l.nombre ? `${l.nombre}, ${l.ciudad ?? l.ccaa}` : `${l.tipo_alojamiento} en ${l.ciudad ?? l.ccaa}, ${l.ccaa}`;
      const enlace = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(consulta)}`;
      return `
      <div class="ficha-lugar">
        <div style="font-weight:700">${nombre}</div>
        <div class="muted" style="font-size:.82rem">${l.tipo_alojamiento} · ${fmtNum(l.n_resenas)} reseñas · ${fmtPct(l.pct_positivo_general)} positivo</div>
        <a href="${enlace}" target="_blank" rel="noopener" class="link-btn">Ver en Google Maps →</a>
      </div>`;
    })
    .join("");
  return panel(
    "Alojamiento, restauración y otros establecimientos",
    `<div class="ficha-lugar-grid">
      ${bloqueLugar("🏨", "Mejor alojamiento", resumen.mejor_alojamiento)}
      ${bloqueLugar("🍽️", "Mejor restaurante", resumen.mejor_restaurante)}
    </div>
    ${destacados ? `<h4 class="ficha-subtitulo" style="margin-top:1rem">Otros lugares bien valorados aquí</h4><div class="ficha-lugar-grid">${destacados}</div>` : ""}`,
  );
}

async function cargarFicha(ccaa) {
  if (!ccaa) return;
  sessionStorage.setItem("ficha_ccaa", ccaa);
  el("ficha-contenido").innerHTML = `<p class="muted">Cargando…</p>`;

  const [resumen, oportunidad, aspectos, historico, alertas] = await conCarga(
    Promise.all([
      api.get(`/ccaa/resumen?ccaa=${encodeURIComponent(ccaa)}`),
      api.get("/oportunidad/mapa"),
      api.get(`/aspectos/ranking?ccaa=${encodeURIComponent(ccaa)}`),
      api.get("/contexto/historico"),
      api.get(`/tendencia/alertas?ccaa=${encodeURIComponent(ccaa)}`),
    ]),
  );

  let recomendados = [];
  try {
    const rec = await api.post("/recomendar", { territorio: ccaa, top_n: 6 });
    recomendados = rec.lugares.filter(
      (l) => l.entity_id !== resumen.mejor_alojamiento?.entity_id && l.entity_id !== resumen.mejor_restaurante?.entity_id,
    );
  } catch {
    recomendados = [];
  }

  const filaOportunidad = oportunidad.ccaa.find((c) => c.ccaa === ccaa);
  const benchmark = historico.benchmark_ccaa.find((b) => b.ccaa === ccaa);

  el("ficha-contenido").innerHTML = `
    <h2 class="ficha-titulo-destino">${ccaa}</h2>
    <div class="ficha-grid">
      ${bloqueOportunidad(filaOportunidad)}
      ${bloqueAspectos(aspectos)}
      ${bloqueContexto(benchmark, historico.cuadrante_definicion)}
      ${bloqueActualidad(alertas.alertas)}
    </div>
    ${bloqueEstablecimientos(resumen, recomendados)}
    <div class="ficha-acciones">
      <button type="button" class="btn-secundario" data-ir="recomendador">🔎 Usar en el recomendador</button>
      <button type="button" class="btn-secundario" data-ir="ranking">⚖️ Comparar con otros destinos</button>
    </div>`;

  el("ficha-contenido")
    .querySelectorAll("[data-ir]")
    .forEach((boton) => boton.addEventListener("click", () => (location.hash = boton.dataset.ir)));
}

export async function render() {
  if (!inicializado) {
    inicializado = true;
    const [{ ccaa }, { aspectos }] = await Promise.all([api.get("/ccaa"), api.get("/aspectos")]);
    etiquetaAspecto = Object.fromEntries(aspectos.map((a) => [a.key, a.label]));
    llenarSelect(el("ficha-ccaa"), ccaa, { valor: "ccaa", etiqueta: "ccaa" });
    el("ficha-ccaa").addEventListener("change", (ev) => cargarFicha(ev.target.value));
  }
  // Si se llegó aquí desde "Ver ficha completa" en Inicio, se respeta esa CCAA.
  const preseleccion = sessionStorage.getItem("ficha_ccaa");
  if (preseleccion) el("ficha-ccaa").value = preseleccion;
  await cargarFicha(el("ficha-ccaa").value);
}
