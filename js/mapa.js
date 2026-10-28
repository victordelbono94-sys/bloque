// Buscar lugares y mostrarlos en un mapa, gratis y sin clave: OpenStreetMap
// (búsqueda con Photon y Nominatim, mapa con Leaflet). Leaflet se carga solo cuando hace falta.

const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4';
const QUITO = { lat: -0.18, lng: -78.48 };
let cargando = null;

export function cargarLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  cargando ??= new Promise((resolver, rechazar) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${LEAFLET}/leaflet.css`;
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = `${LEAFLET}/leaflet.js`;
    js.onload = () => resolver(window.L);
    js.onerror = () => { cargando = null; rechazar(new Error('No se pudo cargar el mapa.')); };
    document.head.appendChild(js);
  });
  return cargando;
}

const PIN = `<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true"><path d="M16 41s14-13.2 14-25A14 14 0 0 0 2 16c0 11.8 14 25 14 25z" fill="#C6F432" stroke="#15171C" stroke-width="2"/><rect x="10" y="10" width="12" height="12" rx="3" fill="#15171C"/></svg>`;

/**
 * Mapa con un pin. Con `alMover`, el pin se arrastra o se mueve tocando el mapa.
 * @returns {Promise<{ mover(lat, lng): void, destruir(): void }>}
 */
export async function crearMapa(el, punto, { alMover = null, zoom = 17 } = {}) {
  const L = await cargarLeaflet();
  const centro = punto ?? QUITO;
  const mapa = L.map(el, {
    zoomControl: !!alMover,
    dragging: !!alMover,
    scrollWheelZoom: false,
    doubleClickZoom: !!alMover,
    touchZoom: !!alMover,
    boxZoom: false,
    keyboard: !!alMover,
    attributionControl: true,
  }).setView([centro.lat, centro.lng], punto ? zoom : 12);
  mapa.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(mapa);
  const icono = L.divIcon({ html: PIN, className: 'mapa-pin', iconSize: [32, 42], iconAnchor: [16, 41] });
  let pin = punto ? L.marker([punto.lat, punto.lng], { icon: icono, draggable: !!alMover, keyboard: false }).addTo(mapa) : null;
  const avisar = (ll) => alMover?.({ lat: Number(ll.lat.toFixed(7)), lng: Number(ll.lng.toFixed(7)) });
  const poner = (lat, lng) => {
    if (pin) pin.setLatLng([lat, lng]);
    else {
      pin = L.marker([lat, lng], { icon: icono, draggable: !!alMover, keyboard: false }).addTo(mapa);
      pin.on('dragend', () => avisar(pin.getLatLng()));
    }
  };
  if (alMover) {
    pin?.on('dragend', () => avisar(pin.getLatLng()));
    mapa.on('click', (e) => { poner(e.latlng.lat, e.latlng.lng); avisar(e.latlng); });
  }
  // El contenedor puede haberse medido antes de tener tamaño final.
  setTimeout(() => mapa.invalidateSize(), 60);
  return {
    mover(lat, lng) { poner(lat, lng); mapa.setView([lat, lng], Math.max(mapa.getZoom(), zoom)); },
    destruir() { mapa.remove(); },
  };
}

/** Busca lugares cerca de Quito. Devuelve [{ nombre, detalle, lat, lng }]. */
export async function buscarLugares(texto, cerca = QUITO) {
  const q = texto.trim();
  if (q.length < 3) return [];
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${cerca.lat}&lon=${cerca.lng}&limit=7`);
    if (r.ok) {
      const j = await r.json();
      const lista = (j.features ?? [])
        .filter((f) => f.properties?.countrycode === 'EC' || !f.properties?.countrycode)
        .map((f) => {
          const p = f.properties ?? {};
          return {
            nombre: p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || q,
            detalle: [p.street && p.name ? p.street : null, p.district, p.city ?? p.county].filter(Boolean).join(', '),
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
          };
        });
      if (lista.length) return lista;
    }
  } catch { /* se prueba con Nominatim */ }
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=7&countrycodes=ec&accept-language=es&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('No se pudo buscar. Revisa la conexión.');
  const j = await r.json();
  return j.map((x) => {
    const [nombre, ...resto] = (x.display_name ?? '').split(', ');
    return { nombre: x.name || nombre, detalle: resto.slice(0, 3).join(', '), lat: Number(x.lat), lng: Number(x.lon) };
  });
}
