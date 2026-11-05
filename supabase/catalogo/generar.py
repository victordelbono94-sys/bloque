"""Genera js/catalogo/*.json a partir de los .txt de esta carpeta.
universal.txt -> universal.json (todos los países); XX.txt -> XX.json (código de país ISO de 2 letras).
Formato de cada línea: nombre;sinonimos;kcal;proteina;carbohidratos;grasas;fibra;porciones (nombre=gramos|...), valores por 100 g.
Uso: python3 supabase/catalogo/generar.py
"""
import json, os, sys, glob

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.join(AQUI, '..', '..', 'js', 'catalogo')

def leer(ruta, pais):
    filas, vistos = [], set()
    for n, l in enumerate(open(ruta, encoding='utf-8'), 1):
        l = l.strip()
        if not l or l.startswith('#'):
            continue
        p = l.split(';')
        if len(p) != 8:
            sys.exit(f'{ruta}:{n}: se esperaban 8 campos')
        nombre, sin, kcal, pr, ca, gr, fi, por = p
        if nombre.lower() in vistos:
            sys.exit(f'{ruta}:{n}: «{nombre}» repetido')
        vistos.add(nombre.lower())
        k, P, C, G, F = map(float, (kcal, pr, ca, gr, fi))
        if not (0 <= k <= 950 and 0 <= P <= 100 and 0 <= C <= 100 and 0 <= G <= 100):
            sys.exit(f'{ruta}:{n}: valores fuera de rango')
        porciones = [{'nombre': x.rsplit('=', 1)[0].strip(), 'g': float(x.rsplit('=', 1)[1])} for x in por.split('|') if '=' in x]
        filas.append({
            'nombre': nombre.strip(), 'sinonimos': sin.strip() or None, 'pais': pais,
            'kcal': k, 'proteina_g': P, 'carbohidratos_g': C, 'grasas_g': G, 'fibra_g': F,
            'porcion_nombre': porciones[0]['nombre'] if porciones else None,
            'porcion_g': porciones[0]['g'] if porciones else None,
            'porciones': porciones, 'origen': 'base',
        })
    return filas

os.makedirs(SALIDA, exist_ok=True)
for ruta in sorted(glob.glob(os.path.join(AQUI, '*.txt'))):
    base = os.path.splitext(os.path.basename(ruta))[0]
    pais = None if base == 'universal' else base.upper()
    filas = leer(ruta, pais)
    json.dump(filas, open(os.path.join(SALIDA, f'{base}.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{base}.json: {len(filas)} alimentos')
