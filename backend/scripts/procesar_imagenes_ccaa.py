"""
Normaliza las fotos de "imagenes de portada/" (tamaños y formatos distintos:
jpeg, jpg, webp, avif, de 500x228 a 3840x2561) a un tamaño y formato
consistentes -- recorte centrado 3:2, 600x400, JPEG -- para el carrete de la
portada. Las guarda en frontend/img/ccaa/<slug>.jpg.

Uso:
    python3 backend/scripts/procesar_imagenes_ccaa.py
(necesita Pillow: pip install pillow; con soporte AVIF si el intérprete no lo
trae ya incorporado)
"""
from pathlib import Path

from PIL import Image, ImageOps

BASE_DIR = Path(__file__).resolve().parents[2]
ORIGEN = BASE_DIR / "imagenes de portada"
DESTINO = BASE_DIR / "frontend" / "img" / "ccaa"

TAMANO = (600, 400)  # 3:2

# (fichero origen, nombre oficial de CCAA -- debe coincidir con config.CCAA --, slug de salida)
MAPEO = [
    ("Andalucia.jpeg", "Andalucía", "andalucia"),
    ("aragon.jpg", "Aragón", "aragon"),
    ("Asturias.jpeg", "Principado de Asturias", "asturias"),
    ("baleares.jpg", "Illes Balears", "baleares"),
    ("Canarias.avif", "Canarias", "canarias"),
    ("Cantabria.jpg", "Cantabria", "cantabria"),
    ("segovia.jpg", "Castilla y León", "castilla-y-leon"),
    ("castilla la mancha.jpg", "Castilla-La Mancha", "castilla-la-mancha"),
    ("cataluña.jpg", "Cataluña", "cataluna"),
    ("ComunidadValenciana.jpg", "Comunitat Valenciana", "comunitat-valenciana"),
    ("Extremadura.jpeg", "Extremadura", "extremadura"),
    ("galicia.jpg", "Galicia", "galicia"),
    ("Madrid.webp", "Comunidad de Madrid", "madrid"),
    ("Murcia.jpg", "Región de Murcia", "murcia"),
    ("navarra.jpeg", "Comunidad Foral de Navarra", "navarra"),
    ("PaisVasco.jpeg", "País Vasco", "pais-vasco"),
    ("la rioja.avif", "La Rioja", "la-rioja"),
    ("Ceuta.jpeg", "Ceuta", "ceuta"),
    ("Melilla.jpeg", "Melilla", "melilla"),
]


def recortar_centrado(im: Image.Image, tamano: tuple[int, int]) -> Image.Image:
    # centering algo por encima del centro (0.45 en vez de 0.5): en fotos de paisaje
    # el cielo suele sobrar más que el suelo/mar al recortar a un ratio más cuadrado.
    return ImageOps.fit(im, tamano, Image.LANCZOS, centering=(0.5, 0.45))


def main() -> None:
    DESTINO.mkdir(parents=True, exist_ok=True)
    guardadas = []
    for archivo, ccaa, slug in MAPEO:
        im = Image.open(ORIGEN / archivo)
        im = ImageOps.exif_transpose(im).convert("RGB")
        im = recortar_centrado(im, TAMANO)
        salida = DESTINO / f"{slug}.jpg"
        im.save(salida, "JPEG", quality=82, optimize=True)
        guardadas.append((ccaa, salida))
        print(f"{ccaa:30} -> {salida.name}  ({salida.stat().st_size // 1024} KB)")

    assert len(guardadas) == 19, f"esperaba 19 imágenes, se guardaron {len(guardadas)}"
    print(f"\nTotal: {sum(s.stat().st_size for _, s in guardadas) // 1024} KB")


if __name__ == "__main__":
    main()
