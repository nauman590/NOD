import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface LatLng {
  lat: number;
  lng: number;
}

@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);
  private readonly key: string | undefined;

  constructor(private config: ConfigService) {
    this.key = (config.get<string>("GOOGLE_MAPS_SERVER_KEY") || "").trim() || undefined;
    if (!this.key) this.logger.warn("GOOGLE_MAPS_SERVER_KEY not set — distance falls back to a default.");
  }

  get enabled() {
    return !!this.key;
  }

  async geocode(address: string): Promise<LatLng | null> {
    if (!this.key || !address) return null;
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${this.key}`;
      const res = await fetch(url);
      const data: any = await res.json();
      const loc = data?.results?.[0]?.geometry?.location;
      return loc ? { lat: loc.lat, lng: loc.lng } : null;
    } catch (e) {
      this.logger.warn(`geocode failed: ${(e as Error).message}`);
      return null;
    }
  }

  // Driving-ish miles between two addresses. Uses haversine × 1.3 road factor on
  // geocoded points (cheap, no Distance Matrix billing). Falls back to a default.
  async distanceMiles(pickup?: string, dropoff?: string, fallback = 6): Promise<number> {
    if (!this.key || !pickup || !dropoff) return fallback;
    const [a, b] = await Promise.all([this.geocode(pickup), this.geocode(dropoff)]);
    if (!a || !b) return fallback;
    const R = 3958.8;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    const straight = 2 * R * Math.asin(Math.sqrt(h));
    return Math.round(straight * 1.3 * 10) / 10;
  }
}
