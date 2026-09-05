import { api } from "../api.js";
import { el, llenarSelect, fmtNum, conCarga } from "../utils.js";

let chart = null;
let inicializado = false;
let peticionActual = 0; // evita que una respuesta lenta pise a una más reciente si el usuario cambia varios filtros seguidos

function seleccionar(ccaa, aspecto, source) {
  el("tend-ccaa").value = ccaa;
  el("tend-aspecto").value = aspecto;
  el("tend-source").value = source ?? "todas";
  cargar();
}

async function cargarAlertas() {
  const data = await conCarga(api.get("/tendencia/alertas?top_n=6"));
  const panel = el("tendencia-alertas");
  if (!data.alertas.length) {
    panel.innerHTML = `<h3>⚠ Rachas activas de empeoramiento</h3><p class="muted">Ninguna combinación CCAA/aspecto lleva 2 o más meses seguidos empeorando ahora mismo.</p>`;
    return;
  }
  panel.innerHTML = `
    <h3>⚠ Rachas activas de empeoramiento en toda España</h3>
    <p class="muted">${data.total_combinaciones_con_racha} combinaciones CCAA/aspecto empeoran ahora mismo, agregado entre plataformas. Las ${data.alertas.length} más largas, pincha para verlas en la gráfica:</p>
    <div class="alertas-tendencia-grid">
      ${data.alertas
        .map(
          (a) => `
        <button type="button" class="alerta-tendencia-item" data-ccaa="${a.ccaa}" data-aspecto="${a.aspecto}">
          <div class="alerta-tendencia-meses">${a.meses_consecutivos_empeorando} <span class="muted" style="font-weight:400;font-size:.7rem">meses</span></div>
          <div class="lugar-titulo" style="font-size:.85rem">${a.ccaa}</div>
          <div class="muted" style="font-size:.78rem">${a.etiqueta_aspecto} · ${(a.tasa_negativa_actual * 100).toFixed(1)}% negativo en ${a.periodo}</div>
        </button>`,
        )
        .join("")}
    </div>`;

  panel.querySelectorAll(".alerta-tendencia-item").forEach((btn) => {
    btn.addEventListener("click", () => seleccionar(btn.dataset.ccaa, btn.dataset.aspecto));
  });
}

async function cargar() {
  const ccaa = el("tend-ccaa").value;
  const aspecto = el("tend-aspecto").value;
  const source = el("tend-source").value;
  if (!ccaa || !aspecto || !source) return;

  const esTodaEspana = ccaa === "todas";
  const esGeneral = aspecto === "general";
  const ccaaTxt = esTodaEspana ? "toda España" : ccaa;
  const aspectoTxt = esGeneral ? "el sentimiento general" : aspecto.replace("_", " ");

  const idPeticion = ++peticionActual;
  const qs = new URLSearchParams({ ccaa, aspecto, source, meses: 24 });
  const data = await conCarga(api.get(`/tendencia?${qs}`));
  if (idPeticion !== peticionActual) return; // ya hay una petición más nueva en curso, se descarta esta

  const fuenteTxt = data.source === "todas" ? "todas las plataformas" : data.source;
  const aviso = el("tend-racha");
  if (data.serie.length === 0) {
    aviso.textContent = data.aviso ?? "Sin datos para esta combinación.";
  } else if (data.meses_consecutivos_empeorando >= 2) {
    aviso.textContent = `⚠ Lleva ${data.meses_consecutivos_empeorando} meses empeorando seguidos en ${ccaaTxt}: ${aspectoTxt} (${fuenteTxt}).`;
  } else {
    aviso.textContent = `De momento no hay una racha clara de empeoramiento (${fuenteTxt}).`;
  }

  // Si ya se ha pedido toda España, la línea de comparación sería idéntica a la
  // principal: no tiene sentido dibujarla dos veces encima.
  el("tend-leyenda").innerHTML = esTodaEspana
    ? `<span class="leyenda-item"><span class="leyenda-swatch" style="background:#D40E14"></span> España (todas las CCAA)</span>`
    : `
    <span class="leyenda-item"><span class="leyenda-swatch" style="background:#D40E14"></span> ${ccaa}</span>
    <span class="leyenda-item"><span class="leyenda-swatch" style="background:#092A5E"></span> media nacional ${esGeneral ? "del sentimiento general" : "del mismo aspecto"}</span>
  `;

  // Los dos periodos no siempre coinciden exactamente (la CCAA puede tener menos meses
  // con evidencia que el país entero), se indexa por periodo, no por posición.
  const nacionalPorPeriodo = Object.fromEntries(data.serie_nacional.map((p) => [p.periodo, p.tasa_negativa * 100]));
  const periodos = data.serie.length ? data.serie.map((p) => p.periodo) : data.serie_nacional.map((p) => p.periodo);

  const datasets = [
    {
      label: esTodaEspana ? "España (todas las CCAA)" : ccaa,
      data: data.serie.map((p) => +(p.tasa_negativa * 100).toFixed(2)),
      borderColor: "#D40E14",
      backgroundColor: "rgba(212,14,20,.12)",
      pointBackgroundColor: data.serie.map((p) => (p.evidencia_suficiente ? "#D40E14" : "#D7D2C3")),
      fill: true,
      tension: 0.25,
    },
  ];
  if (!esTodaEspana) {
    datasets.push({
      label: "Media nacional",
      data: periodos.map((p) => nacionalPorPeriodo[p] ?? null),
      borderColor: "#092A5E",
      borderDash: [5, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false,
      tension: 0.25,
    });
  }

  const ctx = el("chart-tendencia").getContext("2d");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: { labels: periodos, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { min: 0, title: { display: true, text: "% de reseñas negativas ese mes" } } },
    },
  });
}

export async function render() {
  if (!inicializado) {
    inicializado = true;
    const [{ ccaa }, { aspectos }, { fuentes }] = await Promise.all([
      api.get("/ccaa"),
      api.get("/aspectos"),
      api.get("/sentimiento/fuentes"),
    ]);

    llenarSelect(el("tend-ccaa"), ccaa, { valor: "ccaa", etiqueta: "ccaa" });
    el("tend-ccaa").insertAdjacentHTML("afterbegin", `<option value="todas" selected>España (todas las CCAA)</option>`);
    llenarSelect(el("tend-aspecto"), aspectos, { valor: "key", etiqueta: "label" });
    el("tend-aspecto").insertAdjacentHTML("afterbegin", `<option value="general" selected>Sentimiento general</option>`);
    llenarSelect(el("tend-source"), fuentes, { valor: "source", etiqueta: "source" });
    el("tend-source").insertAdjacentHTML("afterbegin", `<option value="todas" selected>Todas las plataformas</option>`);

    el("tend-ccaa").addEventListener("change", cargar);
    el("tend-aspecto").addEventListener("change", cargar);
    el("tend-source").addEventListener("change", cargar);

    await cargarAlertas();
  }
  await cargar();
}
