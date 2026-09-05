import { api } from "../api.js";
import { el, fmtNum, fmtPct, badgeEvidencia, conCarga } from "../utils.js";

let inicializado = false;
let intervalo = null;
let listaCcaa = [];
let indice = 0;
let pausadoManual = false;
let ultimoResumen = null; // el /ccaa/resumen de la CCAA mostrada ahora mismo, para las fichas de detalle

// --- Carrusel: tira de miniaturas donde la CCAA activa siempre está centrada y a la
// vista (nunca queda fuera de pantalla, que era el problema de la versión 100%
// autónoma). Su info vive en una ficha aparte debajo, no encima de la foto -------------

function construirPista() {
  const item = (c, i) => `<button type="button" class="ccaa-pista-item" data-indice="${i}" aria-label="Ir a ${c.ccaa}"><img src="img/ccaa/${c.imagen}" alt="${c.ccaa}" loading="lazy" /></button>`;
  el("ccaa-pista-continua").innerHTML = listaCcaa.map(item).join("");
  el("carrusel-puntos").innerHTML = listaCcaa
    .map((c, i) => `<button type="button" class="carrusel-punto" data-indice="${i}" aria-label="Ir a ${c.ccaa}"></button>`)
    .join("");
}

function marcarActivo() {
  document.querySelectorAll(".ccaa-pista-item").forEach((it) => it.classList.toggle("activo", Number(it.dataset.indice) === indice));
  document.querySelectorAll(".carrusel-punto").forEach((p, i) => p.classList.toggle("activo", i === indice));
}

// Congelar "de verdad" (por una interacción del visitante): avisa de que el avance
// automático se ha detenido, hasta que se pulse "reanudar".
function congelarPista() {
  pausadoManual = true;
  el("carrusel-aviso-manual").hidden = false;
}

// Desliza la tira para que la CCAA activa quede centrada en su hueco visible: se
// llama SIEMPRE que cambia (a mano o en el avance automático), para garantizar que
// la foto de la que se está hablando esté siempre en pantalla.
function centrarPista() {
  const viewport = el("ccaa-pista-viewport");
  const item = document.querySelector(".ccaa-pista-item");
  if (!item) return;
  const anchoItem = item.offsetWidth;
  const paso = anchoItem + 10; // 10px = gap del CSS (.6rem)
  const centro = viewport.clientWidth / 2 - anchoItem / 2;
  // requestAnimationFrame: para que el navegador registre primero la posición
  // "congelada" (frame anterior) y luego la de destino, y la transición entre
  // ambas se vea como un desplazamiento suave en vez de un salto instantáneo.
  requestAnimationFrame(() => {
    el("ccaa-pista-continua").style.transform = `translateX(${centro - indice * paso}px)`;
  });
}

function reanudarCarrete() {
  // No hace falta tocar la posición: ya está centrada en lo último que se vio: el
  // próximo tick del intervalo (cada 4,5s) sigue avanzando desde ahí con normalidad.
  pausadoManual = false;
  el("carrusel-aviso-manual").hidden = true;
}

function pos(i) {
  return ((i % listaCcaa.length) + listaCcaa.length) % listaCcaa.length; // módulo positivo
}

async function mostrarIndice(nuevoIndice) {
  indice = pos(nuevoIndice);
  marcarActivo();
  const c = listaCcaa[indice];
  await mostrarCcaa(c.ccaa);
}

// Clic directo en una miniatura: se congela justo donde está, como en el carrete
// original (no se recoloca la tira).
async function seleccionarMiniatura(i) {
  congelarPista();
  await mostrarIndice(i);
}

// Flecha o punto: además de congelar, hay que traer la CCAA elegida al centro,
// porque puede no estar a la vista en ese momento.
async function irA(nuevoIndice) {
  congelarPista();
  await mostrarIndice(nuevoIndice);
  centrarPista();
}

// Avance automático: la CCAA que cuenta la ficha de abajo tiene que verse SIEMPRE en
// pantalla, así que cada 4,5s se centra suavemente en la siguiente. No toca
// pausadoManual: para el visitante sigue siendo "automático".
async function avanzarAuto() {
  await mostrarIndice(indice + 1);
  centrarPista();
}

// --- Tarjetas de la ficha completa (dentro del modal) ----------------------------------

function tarjetaLugar(icono, titulo, info, ccaaFallback) {
  if (!info) {
    return `
      <div class="ccaa-card">
        <div class="ccaa-card-titulo">${icono} ${titulo}</div>
        <p class="muted">Sin datos suficientes en esta comunidad.</p>
      </div>`;
  }
  const aprox = info.ciudad_es_aproximada ? ` <span class="muted">(zona aprox.)</span>` : "";
  return `
    <div class="ccaa-card ccaa-card-clicable" data-accion="lugar" data-entity-id="${info.entity_id}">
      <div class="ccaa-card-titulo">${icono} ${titulo}</div>
      <div class="ccaa-card-valor">${info.ciudad ?? ccaaFallback}${aprox}</div>
      <div class="muted">${info.tipo_alojamiento} · ${fmtPct(info.pct_positivo_general)} positivo · ${fmtNum(info.n_resenas)} reseñas</div>
      <div class="ccaa-card-vermas">Ver ficha completa →</div>
    </div>`;
}

function tarjetaMasificacion(masif) {
  if (!masif || masif.pct_quejas === null) {
    return `
      <div class="ccaa-card">
        <div class="ccaa-card-titulo">🧍 Masificación</div>
        <p class="muted">Sin datos suficientes.</p>
      </div>`;
  }
  return `
    <div class="ccaa-card ccaa-card-clicable" data-accion="masificacion">
      <div class="ccaa-card-titulo">🧍 Masificación</div>
      <div class="ccaa-card-valor">${masif.pct_quejas}%</div>
      <div class="muted">${masif.evidencia_suficiente ? "de quejas por masificación" : `poca evidencia (${masif.menciones} menciones)`}</div>
      <div class="ccaa-card-vermas">Ver contexto →</div>
    </div>`;
}

function tarjetaTendencia(tend) {
  if (!tend) {
    return `
      <div class="ccaa-card">
        <div class="ccaa-card-titulo">📈 Tendencia turística</div>
        <p class="muted">Sin datos suficientes.</p>
      </div>`;
  }
  const sube = tend.direccion === "crecimiento";
  return `
    <div class="ccaa-card ccaa-card-clicable" data-accion="tendencia">
      <div class="ccaa-card-titulo">${sube ? "📈" : "📉"} Tendencia turística</div>
      <div class="ccaa-card-valor ${sube ? "tendencia-sube" : "tendencia-baja"}">${sube ? "+" : ""}${tend.variacion_pct}%</div>
      <div class="muted">${tend.indicador}, interanual · ${tend.periodo}${tend.provisional ? " (provisional)" : ""}</div>
      <div class="ccaa-card-vermas">Ver todos los indicadores →</div>
    </div>`;
}

// --- Modal de detalle -------------------------------------------------------------------

function abrirModal(tituloHtml, cuerpoHtml) {
  el("modal-detalle-contenido").innerHTML = `<h2>${tituloHtml}</h2>${cuerpoHtml}`;
  el("modal-detalle").hidden = false;
}

function filaBarra(etiqueta, valor01, extra) {
  const pct = valor01 !== null ? Math.round(valor01 * 100) : 0;
  return `
    <div class="detalle-fila">
      <span>${etiqueta}</span>
      <div class="detalle-barra"><div style="width:${pct}%"></div></div>
      <span class="muted">${valor01 !== null ? fmtPct(valor01) : "N/D"}${extra ?? ""}</span>
    </div>`;
}

function abrirDetalleCcaaCompleta() {
  if (!ultimoResumen) return;
  abrirModal(
    ultimoResumen.ccaa,
    `<div class="ccaa-resumen-grid" style="margin-top:.8rem">
      ${tarjetaLugar("🏨", "Mejor alojamiento", ultimoResumen.mejor_alojamiento, ultimoResumen.ccaa)}
      ${tarjetaLugar("🍽️", "Mejor restaurante", ultimoResumen.mejor_restaurante, ultimoResumen.ccaa)}
      ${tarjetaMasificacion(ultimoResumen.masificacion)}
      ${tarjetaTendencia(ultimoResumen.tendencia)}
    </div>`,
  );
}

async function abrirDetalleLugar(entityId) {
  abrirModal("Cargando…", "");
  try {
    const d = await api.get(`/lugares/resumen?entity_id=${encodeURIComponent(entityId)}`);
    const aprox = d.ciudad_es_aproximada ? " (zona aprox.)" : "";
    const filas = d.aspectos
      .map((a) => filaBarra(a.etiqueta, a.pct_positivo, a.evidencia_suficiente ? "" : " " + badgeEvidencia(false)))
      .join("");
    abrirModal(
      `${d.ciudad ?? d.ccaa}${aprox} · ${d.tipo_alojamiento}`,
      `<p class="muted">${fmtNum(d.n_resenas)} reseñas · ${fmtPct(d.pct_positivo_general)} positivo en general · volumen relativo ${d.volumen_relativo}</p>
       <h3>Por aspecto</h3>
       <div class="detalle-lista">${filas}</div>
       <p class="muted" style="margin-top:1rem">${d.nota}</p>`,
    );
  } catch (err) {
    abrirModal("No se pudo cargar", `<p class="muted">${err.message}</p>`);
  }
}

function abrirDetalleMasificacion() {
  if (!ultimoResumen) return;
  const m = ultimoResumen.masificacion;
  const contextoOpportunity = m.puesto_opportunity_score
    ? `
      <h3>Índice de Oportunidad (Rol 5)</h3>
      <p>${ultimoResumen.ccaa} ocupa el puesto <strong>${m.puesto_opportunity_score} de 19</strong>, con una puntuación de
      <strong>${m.puntuacion_opportunity_score}/100</strong> ${badgeEvidencia(m.evidencia_opportunity_score === "solid")}.</p>
      <p>El aspecto que más pesa en esa puntuación es <strong>${m.aspecto_motor.replace("_", " ")}</strong>${
        m.masificacion_es_aspecto_motor
          ? ": en esta comunidad, la masificación es justo lo que más destaca frente al resto del país."
          : ", no la masificación en sí: aquí destaca más otra cosa."
      }</p>`
    : "";
  abrirModal(
    `Masificación en ${ultimoResumen.ccaa}`,
    `<p><strong>${m.pct_quejas !== null ? m.pct_quejas + "%" : "N/D"}</strong> de las menciones a masificación en las reseñas de esta comunidad son negativas
     (${m.menciones} menciones ${badgeEvidencia(m.evidencia_suficiente)}).</p>
     ${contextoOpportunity}`,
  );
}

function abrirDetalleTendencia() {
  if (!ultimoResumen?.tendencia) return;
  const t = ultimoResumen.tendencia;
  const filas = t.otros_indicadores
    .map((i) => {
      const sube = i.variacion_pct === null || i.variacion_pct >= 0;
      return `
      <div class="detalle-fila detalle-fila-indicador">
        <span>${i.etiqueta}</span>
        <span>${fmtNum(i.valor)} <span class="muted">${i.unidad}</span></span>
        <span class="${sube ? "tendencia-sube" : "tendencia-baja"}">${i.variacion_pct === null ? "N/D" : `${i.variacion_pct >= 0 ? "+" : ""}${i.variacion_pct}%`}</span>
      </div>`;
    })
    .join("");
  abrirModal(
    `Tendencia turística en ${ultimoResumen.ccaa}`,
    `<p class="muted">Periodo ${t.periodo}${t.provisional ? " (provisional)" : ""} · variación interanual</p>
     <div class="detalle-lista">${filas}</div>`,
  );
}

// Delegado en el propio modal: sirve tanto para la ficha completa (abrirDetalleCcaaCompleta)
// como para cualquier otra pantalla que reutilice las mismas tarjetas .ccaa-card-clicable.
el("modal-detalle-contenido").addEventListener("click", (ev) => {
  const card = ev.target.closest(".ccaa-card-clicable");
  if (!card) return;
  const accion = card.dataset.accion;
  if (accion === "lugar") abrirDetalleLugar(card.dataset.entityId);
  else if (accion === "masificacion") abrirDetalleMasificacion();
  else if (accion === "tendencia") abrirDetalleTendencia();
});

// --- Alertas generales, arriba del todo: por qué + qué hacer, bien diferenciados ------

const CLASE_CATEGORIA = { MARKETING: "marketing", "CALIDAD DE PRODUCTO": "calidad", TENDENCIA: "tendencia" };

async function renderAlertasGenerales() {
  const data = await conCarga(api.get("/resumen"));

  el("portada-alertas").innerHTML =
    data.alertas
      .map((a) => {
        const stat =
          a.valor !== undefined
            ? `<div class="alert-stat">${a.valor}<span class="alert-stat-suf">${a.valor_sufijo ?? ""}</span></div>`
            : "";
        const barra =
          a.barra_pct !== undefined
            ? `<div class="alert-barra"><div class="alert-barra-fill" style="width:${a.barra_pct}%"></div></div>`
            : "";
        return `
      <div class="alert-card ${CLASE_CATEGORIA[a.categoria] ?? ""} ${a.destacada ? "alert-destacada" : ""}">
        <div class="alert-top">
          <span class="alert-icono">${a.icono ?? ""}</span>
          <div>
            <div class="alert-cat">${a.categoria}</div>
            <div class="alert-titulo">${a.titulo ?? ""}</div>
          </div>
          <button type="button" class="btn-info alert-btn-info" data-causa="${(a.causa ?? "").replace(/"/g, "&quot;")}" data-accion-texto="${(a.accion ?? "").replace(/"/g, "&quot;")}" aria-label="Por qué salta esta alerta">i</button>
        </div>
        ${stat}
        ${barra}
        <div class="alert-accion-linea">➜ ${a.accion ?? ""}</div>
      </div>`;
      })
      .join("") || `<p class="muted">Nada que destacar hoy.</p>`;
}

el("portada-alertas").addEventListener("click", (ev) => {
  const boton = ev.target.closest(".alert-btn-info");
  if (!boton) return;
  abrirModal(
    "Por qué salta esta alerta",
    `<p>${boton.dataset.causa}</p><p style="margin-top:.8rem"><strong>Qué hacer:</strong> ${boton.dataset.accionTexto}</p>`,
  );
});

// --- Carga de cada CCAA ------------------------------------------------------------------

async function mostrarCcaa(ccaa) {
  el("ccaa-tarjeta-nombre").textContent = ccaa;

  try {
    const data = await conCarga(api.get(`/ccaa/resumen?ccaa=${encodeURIComponent(ccaa)}`));
    ultimoResumen = data;
    // Solo las 2 cifras más "de alerta" en la cara de la tarjeta (masificación y
    // tendencia); el resto (mejor alojamiento/restaurante) queda a un clic, en el modal:
    // en un carrusel no conviene amontonar texto, mejor una tarjeta limpia y clicable.
    const masif = data.masificacion?.pct_quejas !== null && data.masificacion?.pct_quejas !== undefined
      ? `<div><div class="ccaa-tarjeta-stat-valor">${data.masificacion.pct_quejas}%</div><div class="ccaa-tarjeta-stat-label">Masificación</div></div>`
      : "";
    const sube = data.tendencia?.direccion === "crecimiento";
    const tend = data.tendencia
      ? `<div><div class="ccaa-tarjeta-stat-valor">${sube ? "+" : ""}${data.tendencia.variacion_pct}%</div><div class="ccaa-tarjeta-stat-label">Tendencia turística</div></div>`
      : "";
    el("ccaa-tarjeta-stats").innerHTML = masif + tend;
  } catch (err) {
    ultimoResumen = null;
    el("ccaa-tarjeta-stats").innerHTML = `<div class="ccaa-tarjeta-stat-label">No se pudo cargar: ${err.message}</div>`;
  }
}

export async function render() {
  if (inicializado) return;
  inicializado = true;

  renderAlertasGenerales();

  const { ccaa } = await api.get("/ccaa");
  listaCcaa = ccaa;
  construirPista();

  el("carrusel-prev").addEventListener("click", () => irA(indice - 1));
  el("carrusel-next").addEventListener("click", () => irA(indice + 1));
  el("ccaa-pista-continua").addEventListener("click", (ev) => {
    const item = ev.target.closest(".ccaa-pista-item");
    if (!item) return;
    seleccionarMiniatura(Number(item.dataset.indice));
  });
  el("carrusel-puntos").addEventListener("click", (ev) => {
    const punto = ev.target.closest(".carrusel-punto");
    if (!punto) return;
    irA(Number(punto.dataset.indice));
  });
  el("btn-ver-todos-ccaa").addEventListener("click", abrirDetalleCcaaCompleta);
  el("btn-reanudar-carrete").addEventListener("click", reanudarCarrete);
  window.addEventListener("resize", centrarPista);

  // Menú de acciones: la primera pantalla de trabajo, no una lista de accesos discretos.
  el("menu-acciones").addEventListener("click", (ev) => {
    const boton = ev.target.closest(".accion-card");
    if (boton) location.hash = boton.dataset.ir;
  });
  // "Ver ficha completa": pasa la CCAA que se está viendo ahora mismo en el carrusel.
  el("btn-ver-ficha-ccaa").addEventListener("click", () => {
    sessionStorage.setItem("ficha_ccaa", listaCcaa[indice].ccaa);
    location.hash = "ficha";
  });

  await mostrarIndice(0);
  centrarPista(); // la primera CCAA también tiene que arrancar centrada, no a la izquierda del todo

  // Cada 4,5s pasa a la siguiente CCAA y la centra (avanzarAuto); cualquier interacción
  // manual lo detiene del todo hasta pulsar "reanudar".
  intervalo = setInterval(() => {
    if (pausadoManual) return; // el visitante ha fijado una CCAA a mano
    if (!el("sec-portada").classList.contains("is-active")) return; // no gastar llamadas en otra pestaña
    avanzarAuto();
  }, 4500);
}
