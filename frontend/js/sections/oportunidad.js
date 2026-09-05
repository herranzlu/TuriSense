import { api } from "../api.js";
import { el, fmtPct, badgeEvidencia, crearMapaCoropletico, conCarga } from "../utils.js";

let mapaListo = null;
let resaltarEnMapa = null; // función expuesta por crearMapaCoropletico, para sincronizar mapa <-> tabla
let scatter = null;
let cargado = false;
let datosActuales = null;
let seleccionActual = null; // nombre (geojson) de la CCAA elegida en mapa o tabla, o null si no hay ninguna

const ETIQUETA_ACCION = {
  promocionar: "Promocionar",
  renegociar: "Renegociar",
  vigilar: "Vigilar",
  diagnosticar: "Diagnosticar",
};

// El mapa, el scatter y la leyenda usan una versión suavizada de cada color TUI:
// los tonos puros (verde lima, amarillo limón) son muy saturados para pintar
// superficies grandes o muchos puntos a la vez, así que se rebajan un poco sin
// perder la familia de color de marca. La tabla y el texto narrativo usan la
// variante oscura (accion-* en el CSS), pensada para leerse sobre blanco.
const COLOR_ACCION = {
  promocionar: "#8FAE3C", // verde TUI suavizado
  renegociar: "#C23B3F", // rojo TUI suavizado
  vigilar: "#D9A426", // amarillo TUI suavizado (dorado)
  diagnosticar: "#1F3F6E", // azul TUI, algo más claro para verse bien en mapa
};
// Mismo tono, oscurecido: para texto sobre un fondo claro (las píldoras del resumen),
// el tono de relleno de arriba no tiene contraste suficiente.
const COLOR_ACCION_TEXTO = {
  promocionar: "#5C7400",
  renegociar: "#9A1F22",
  vigilar: "#7A5A00",
  diagnosticar: "#092A5E",
};

function hexARgba(hex, alfa) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alfa})`;
}

// Resumen como cuatro píldoras de color + número, no como párrafos con la lista de
// nombres: el mapa de abajo ya es el resumen visual real, esto es solo el recuento
// rápido de un vistazo (cuántas hay en cada categoría, no cuáles). Relleno del propio
// color (suave, sin fondo blanco) en vez de una tarjeta blanca con borde de color.
function renderResumen(data) {
  const conteo = { promocionar: 0, renegociar: 0, vigilar: 0, diagnosticar: 0 };
  for (const c of data.ccaa) if (c.accion_sugerida) conteo[c.accion_sugerida]++;

  el("oportunidad-resumen").innerHTML = `
    <div class="resumen-pills">
      ${Object.entries(ETIQUETA_ACCION)
        .map(
          ([accion, etiqueta]) => `
        <span class="pill-accion" style="background:${hexARgba(COLOR_ACCION[accion], 0.16)};color:${COLOR_ACCION_TEXTO[accion]}">
          <span class="pill-accion-punto" style="background:${COLOR_ACCION[accion]}"></span>
          <strong>${conteo[accion]}</strong> ${etiqueta}
        </span>`,
        )
        .join("")}
    </div>`;
}

function renderMapa(data, pintar) {
  const valores = {};
  const colores = {};
  for (const c of data.ccaa) {
    valores[c.ccaa_geojson] = c.puntuacion;
    colores[c.ccaa_geojson] = COLOR_ACCION[c.accion_sugerida] ?? "#E7E2DB";
  }
  pintar(valores, {
    coloresDirectos: colores,
    onClick: (nombreGeojson) => seleccionarCcaa(nombreGeojson),
    tooltip: (nombre) => {
      const fila = data.ccaa.find((c) => c.ccaa_geojson === nombre);
      if (!fila) return nombre;
      return `<strong>${fila.ccaa}</strong> · ${ETIQUETA_ACCION[fila.accion_sugerida] ?? "N/D"}<br>
        Satisfacción: ${fmtPct(fila.satisfaccion_media)} · Presión: ${fmtPct(fila.presion_turistica)}<br>
        Puntuación de oportunidad: ${fila.puntuacion}/100 · Aspecto motor: ${fila.aspecto_motor.replace("_", " ")}${
          fila.empate_tecnico ? ` (empate con ${fila.aspecto_2.replace("_", " ")})` : ""
        }<br><span style="opacity:.8">Toca para ver esta comunidad en la tabla</span>`;
    },
  });

  el("mapa-oportunidad-leyenda").innerHTML = `
    <p class="muted" style="margin:.6rem 0 .5rem">En qué debe enfocarse el equipo, según el color:</p>
    ${Object.entries(ETIQUETA_ACCION)
      .map(
        ([accion, etiqueta]) => `
      <div class="benchmark-leyenda-item">
        <span class="benchmark-leyenda-swatch" style="background:${COLOR_ACCION[accion]}"></span>
        <span><strong>${etiqueta}</strong><br><span class="muted">${data.cuadrante[accion] ?? ""}</span></span>
      </div>`,
      )
      .join("")}
  `;
}

function renderTabla(data) {
  const tbody = document.querySelector("#tabla-oportunidad tbody");
  tbody.innerHTML = data.ccaa
    .sort((a, b) => a.puesto - b.puesto)
    .map(
      (c) => `
      <tr class="fila-ccaa-clicable ${c.evidencia === "thin" ? "fila-thin" : ""}" data-ccaa-geojson="${c.ccaa_geojson}" tabindex="0">
        <td>${c.puesto}</td>
        <td>${c.ccaa}</td>
        <td>${fmtPct(c.satisfaccion_media)}</td>
        <td>${fmtPct(c.presion_turistica)}</td>
        <td>${c.aspecto_motor.replace("_", " ")}${c.empate_tecnico ? ` / ${c.aspecto_2.replace("_", " ")}` : ""}${c.evidencia === "thin" ? " " + badgeEvidencia(false) : ""}</td>
        <td class="accion-${c.accion_sugerida ?? "diagnosticar"}">${ETIQUETA_ACCION[c.accion_sugerida] ?? "N/D"}</td>
      </tr>`,
    )
    .join("");
}

// --- Sincronización mapa <-> tabla: un clic en cualquiera de los dos resalta la misma
// CCAA en el otro, y atenúa el resto de filas para que se lea "solo esta", sin dejar
// de tener el conjunto completo a un clic de distancia (botón "Ver todas"). --------------

function seleccionarCcaa(nombreGeojson) {
  seleccionActual = seleccionActual === nombreGeojson ? null : nombreGeojson; // segundo clic quita el filtro
  resaltarEnMapa?.(seleccionActual);

  const tabla = el("tabla-oportunidad");
  tabla.classList.toggle("tabla-con-seleccion", !!seleccionActual);
  let filaActiva = null;
  tabla.querySelectorAll("tbody tr").forEach((tr) => {
    const esta = tr.dataset.ccaaGeojson === seleccionActual;
    tr.classList.toggle("fila-seleccionada", esta);
    if (esta) filaActiva = tr;
  });
  filaActiva?.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const fila = datosActuales?.ccaa.find((c) => c.ccaa_geojson === seleccionActual);
  el("oportunidad-filtro-aviso").innerHTML = fila
    ? `Mostrando <strong>${fila.ccaa}</strong> · <button type="button" id="btn-quitar-filtro-ccaa" class="link-btn">ver las 19 comunidades</button>`
    : "Toca una comunidad, en el mapa o en la tabla, para ver solo la suya.";
}

el("tabla-oportunidad").addEventListener("click", (ev) => {
  const fila = ev.target.closest(".fila-ccaa-clicable");
  if (fila) seleccionarCcaa(fila.dataset.ccaaGeojson);
});
el("oportunidad-filtro-aviso").addEventListener("click", (ev) => {
  if (ev.target.id === "btn-quitar-filtro-ccaa") seleccionarCcaa(seleccionActual);
});

function renderScatter(data) {
  const grupos = {};
  for (const c of data.ccaa) {
    if (c.satisfaccion_media === null) continue;
    (grupos[c.accion_sugerida] ??= []).push({ x: c.presion_turistica, y: c.satisfaccion_media, ccaa: c.ccaa });
  }

  const m = data.mediana_presion_turistica;
  const n = data.mediana_satisfaccion;

  const ctx = el("chart-oportunidad-scatter").getContext("2d");
  if (scatter) scatter.destroy();
  scatter = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [
        ...Object.entries(grupos).map(([accion, puntos]) => ({
          type: "scatter",
          label: ETIQUETA_ACCION[accion] ?? accion,
          data: puntos,
          backgroundColor: COLOR_ACCION[accion] ?? "#737373",
          pointRadius: 7,
          pointHoverRadius: 9,
        })),
        {
          type: "line",
          label: "media de España en presión",
          data: [{ x: m, y: 0 }, { x: m, y: 1 }],
          borderColor: "#B0AAA0",
          borderDash: [5, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
        },
        {
          type: "line",
          label: "media de España en satisfacción",
          data: [{ x: 0, y: n }, { x: 1, y: n }],
          borderColor: "#B0AAA0",
          borderDash: [5, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.dataset.type === "scatter",
          callbacks: { label: (c) => `${c.raw.ccaa}: ${c.dataset.label}` },
        },
      },
      scales: {
        x: { min: 0, max: 1, title: { display: true, text: "Presión turística" } },
        y: { min: 0, max: 1, title: { display: true, text: "Satisfacción de los viajeros" } },
      },
    },
  });
}

export async function render() {
  if (cargado) return;
  cargado = true;

  const data = await conCarga(api.get("/oportunidad/mapa"));
  datosActuales = data;

  if (!mapaListo) mapaListo = crearMapaCoropletico("mapa-oportunidad");
  const { pintar, resaltar } = await mapaListo;
  resaltarEnMapa = resaltar;

  renderResumen(data);
  renderMapa(data, pintar);
  renderTabla(data);
  renderScatter(data);
}
