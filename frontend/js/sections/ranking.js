import { api } from "../api.js";
import { el, llenarSelect, degradadoPositivoPorValor, rangoAjustado, conCarga } from "../utils.js";

let chart = null;
let inicializado = false;

// Línea discontinua fina entre el 3º y el 4º puesto: separa visualmente el "top 3"
// sin necesitar una tabla aparte ni texto explicando qué es el top 3.
const separadorTop3 = {
  id: "separadorTop3",
  afterDraw(c) {
    if (c.data.labels.length < 4) return;
    const y = c.scales.y;
    const yPixel = (y.getPixelForTick(2) + y.getPixelForTick(3)) / 2;
    const { ctx, chartArea } = c;
    ctx.save();
    ctx.strokeStyle = "#C9BFAF";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartArea.left, yPixel);
    ctx.lineTo(chartArea.right, yPixel);
    ctx.stroke();
    ctx.restore();
  },
};

// El % al final de cada barra: más rápido de leer que esperar al hover de cada una.
const valorAlFinal = {
  id: "valorAlFinal",
  afterDatasetsDraw(c) {
    const meta = c.getDatasetMeta(0);
    const valores = c.data.datasets[0].data;
    const { ctx } = c;
    ctx.save();
    ctx.font = "600 11px 'Plus Jakarta Sans', sans-serif";
    ctx.fillStyle = "#14181C";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    meta.data.forEach((bar, i) => {
      if (valores[i] === null || valores[i] === undefined) return;
      ctx.fillText(`${valores[i]}%`, bar.x + 6, bar.y);
    });
    ctx.restore();
  },
};

async function cargar() {
  const metrica = el("ranking-metrica").value;
  const data = await conCarga(api.get(`/ccaa/ranking?metrica=${encodeURIComponent(metrica)}`));

  const ctx = el("chart-ranking").getContext("2d");
  const etiquetas = data.ccaa.map((f) => f.ccaa);
  const valores = data.ccaa.map((f) => (f.pct_positivo !== null ? +(f.pct_positivo * 100).toFixed(1) : null));
  const degradado = degradadoPositivoPorValor(valores);
  const colores = data.ccaa.map((f, i) => (f.evidencia_suficiente ? degradado[i] : "#D7D2C3"));
  const { min, max } = rangoAjustado(valores);

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: etiquetas,
      datasets: [{ label: data.etiqueta, data: valores, backgroundColor: colores, borderRadius: 4, barThickness: 16 }],
    },
    plugins: [separadorTop3, valorAlFinal],
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 34 } },
      plugins: {
        legend: { display: false },
        title: { display: true, text: `${data.etiqueta}: de mejor a peor` },
        // El % ya se dibuja al final de cada barra (valorAlFinal): el tooltip por
        // defecto solo repetiría ese mismo dato al pasar el ratón, sin aportar nada.
        tooltip: { enabled: false },
      },
      scales: {
        x: { min, max, title: { display: true, text: "% positivo" } },
        y: {
          ticks: {
            font: (c) => ({ weight: c.index < 3 ? "700" : "400" }),
          },
        },
      },
    },
  });
}

export async function render() {
  if (!inicializado) {
    inicializado = true;
    const { aspectos } = await api.get("/aspectos");
    llenarSelect(el("ranking-metrica"), aspectos, { valor: "key", etiqueta: "label" });
    el("ranking-metrica").insertAdjacentHTML("afterbegin", `<option value="general" selected>Satisfacción general</option>`);
    el("ranking-metrica").addEventListener("change", cargar);
  }
  await cargar();
}
