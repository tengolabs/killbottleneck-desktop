#!/usr/bin/env python3
"""Ikony rámu z loga killBottlenecku (product/mobile/assets/icon.png, 1024×1024).

Vyrobí (a výsledky se commitují — v CI se negenerují):
  build/icon.png            1024²  ikona aplikace; electron-builder z ní udělá .ico
  build/tray/ikona.png      256²   ikona okna ve vývojové stavbě (Linux)
  build/tray/tray[@1.5x|@2x].png        ikona u hodin (16/24/32 px)
  build/tray/tray-odznak[…].png         totéž s červenou tečkou = nepřečtená upozornění
  build/odznak/{1..9,9plus}[@2x].png    číslo na ikoně v hlavní liště (16/32 px)

Spuštění: npm run ikony (potřebuje Pillow a písmo DejaVu Sans Bold).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

KOREN = Path(__file__).resolve().parent.parent
ZDROJ = KOREN.parent / "mobile" / "assets" / "icon.png"
BUILD = KOREN / "build"
CERVENA = (220, 38, 38, 255)
PISMO = "DejaVuSans-Bold.ttf"


def kruh_z_loga(velikost: int) -> Image.Image:
    """Jen kruh s hadem (bez tmavého čtverce) — na malé ikoně u hodin je čitelnější."""
    logo = Image.open(ZDROJ).convert("RGBA")
    # kruh hada leží zhruba ve středu (515, 525) s poloměrem ~385 px
    stred_x, stred_y, polomer = 515, 525, 392
    vyrez = logo.crop((stred_x - polomer, stred_y - polomer, stred_x + polomer, stred_y + polomer))
    maska = Image.new("L", vyrez.size, 0)
    ImageDraw.Draw(maska).ellipse((0, 0, vyrez.size[0] - 1, vyrez.size[1] - 1), fill=255)
    vyrez.putalpha(maska)
    # zmenšovat po krocích s vyhlazením (z 784 rovnou na 16 by zmizely detaily kruhu)
    obr = vyrez.resize((velikost * 8, velikost * 8), Image.LANCZOS)
    return obr.resize((velikost, velikost), Image.LANCZOS)


def s_teckou(obr: Image.Image) -> Image.Image:
    vysledek = obr.copy()
    v = obr.size[0]
    d = max(6, round(v * 0.46))
    kresba = ImageDraw.Draw(vysledek)
    okraj = max(1, v // 16)
    kresba.ellipse((v - d - 0, v - d - 0, v - 1, v - 1), fill=(18, 31, 50, 255))
    kresba.ellipse((v - d + okraj, v - d + okraj, v - 1 - okraj, v - 1 - okraj), fill=CERVENA)
    return vysledek


def odznak(text: str, velikost: int) -> Image.Image:
    obr = Image.new("RGBA", (velikost, velikost), (0, 0, 0, 0))
    kresba = ImageDraw.Draw(obr)
    kresba.ellipse((0, 0, velikost - 1, velikost - 1), fill=CERVENA)
    pismo = ImageFont.truetype(PISMO, round(velikost * (0.62 if len(text) == 1 else 0.5)))
    box = kresba.textbbox((0, 0), text, font=pismo)
    sirka, vyska = box[2] - box[0], box[3] - box[1]
    kresba.text(((velikost - sirka) / 2 - box[0], (velikost - vyska) / 2 - box[1]), text, font=pismo, fill=(255, 255, 255, 255))
    return obr


def main() -> None:
    (BUILD / "tray").mkdir(parents=True, exist_ok=True)
    (BUILD / "odznak").mkdir(parents=True, exist_ok=True)
    Image.open(ZDROJ).convert("RGBA").save(BUILD / "icon.png", optimize=True)
    kruh_z_loga(256).save(BUILD / "tray" / "ikona.png", optimize=True)
    for pripona, velikost in (("", 16), ("@1.5x", 24), ("@2x", 32)):
        zakladni = kruh_z_loga(velikost)
        zakladni.save(BUILD / "tray" / f"tray{pripona}.png", optimize=True)
        s_teckou(zakladni).save(BUILD / "tray" / f"tray-odznak{pripona}.png", optimize=True)
    for n in [str(i) for i in range(1, 10)] + ["9plus"]:
        text = "9+" if n == "9plus" else n
        odznak(text, 16).save(BUILD / "odznak" / f"{n}.png", optimize=True)
        odznak(text, 32).save(BUILD / "odznak" / f"{n}@2x.png", optimize=True)
    print("ikony hotové:", BUILD)


if __name__ == "__main__":
    main()
