import { el, conCarga } from "./utils.js";
import * as portada from "./sections/portada.js";
import * as recomendador from "./sections/recomendador.js";
import * as ranking from "./sections/ranking.js";
import * as oportunidad from "./sections/oportunidad.js";
import * as diagnostico from "./sections/diagnostico.js";
import * as contexto from "./sections/contexto.js";
import * as tendencia from "./sections/tendencia.js";

const SECCIONES = { portada, recomendador, ranking, oportunidad, diagnostico, contexto, tendencia };

async function activar(nombre) {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.section === nombre));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("is-active", v.id === `sec-${nombre}`));

  const modulo = SECCIONES[nombre];
  if (!modulo) return;
  try {
    await conCarga(modulo.render());
  } catch (err) {
    console.error(err);
    const vista = el(`sec-${nombre}`);
    vista.insertAdjacentHTML("beforeend", `<p style="color:var(--rojo-primario)">Error cargando esta sección: ${err.message}</p>`);
  }
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    location.hash = btn.dataset.section;
    cerrarMenuMovil();
  });
});

// --- Menú lateral en móvil: cajón deslizante (index.html/styles.css llevan el hueco,
// aquí solo se abre/cierra) --------------------------------------------------------
const sidebar = el("app-sidebar");
const btnHamburguesa = el("btn-hamburguesa");
const backdrop = el("sidebar-backdrop");

function abrirMenuMovil() {
  sidebar.classList.add("abierto");
  backdrop.hidden = false;
  btnHamburguesa.setAttribute("aria-expanded", "true");
}
function cerrarMenuMovil() {
  sidebar.classList.remove("abierto");
  backdrop.hidden = true;
  btnHamburguesa.setAttribute("aria-expanded", "false");
}
btnHamburguesa.addEventListener("click", () => {
  if (sidebar.classList.contains("abierto")) cerrarMenuMovil();
  else abrirMenuMovil();
});
backdrop.addEventListener("click", cerrarMenuMovil);

window.addEventListener("hashchange", () => activar(location.hash.slice(1) || "portada"));

el("btn-metodologia").addEventListener("click", () => (el("modal-metodologia").hidden = false));
el("modal-close").addEventListener("click", () => (el("modal-metodologia").hidden = true));
el("modal-metodologia").addEventListener("click", (ev) => {
  if (ev.target.id === "modal-metodologia") el("modal-metodologia").hidden = true;
});

el("modal-detalle-close").addEventListener("click", () => (el("modal-detalle").hidden = true));
el("modal-detalle").addEventListener("click", (ev) => {
  if (ev.target.id === "modal-detalle") el("modal-detalle").hidden = true;
});

activar(location.hash.slice(1) || "portada");
