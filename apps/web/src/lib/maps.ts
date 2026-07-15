// Google Maps browser key. HARDCODED placeholder for now — drop the real key here
// (or set VITE_GOOGLE_MAPS_KEY) and the live map + ETA light up automatically.
export const GOOGLE_MAPS_BROWSER_KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY as string) || "";

export const mapsEnabled = () => GOOGLE_MAPS_BROWSER_KEY.trim().length > 0;

let loader: Promise<any> | null = null;

// Loads the Google Maps JS API once. Resolves to `google.maps` or null if no key.
export function loadGoogleMaps(): Promise<any> {
  if (!mapsEnabled()) return Promise.resolve(null);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    if ((window as any).google?.maps) return resolve((window as any).google.maps);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_BROWSER_KEY}`;
    s.async = true;
    s.onload = () => resolve((window as any).google.maps);
    s.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(s);
  });
  return loader;
}

// Haversine miles between two points (client-side ETA fallback when no Maps key).
export function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.3 * 10) / 10;
}
