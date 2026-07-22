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

  // The dispatch hub the provider pool is measured from. Non-secret; surfaced for admin
  // diagnostics so an operator can confirm which service area this instance is pricing.
  get hubAddress(): string {
    return (this.config.get<string>("SERVICE_HUB_ADDRESS") || "").trim();
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

  // Road miles between two lat/lng points (haversine × 1.3 road factor).
  private roadMiles(a: LatLng, b: LatLng): number {
    const R = 3958.8;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.3 * 10) / 10;
  }

  // Distance from the provider pool's dispatch base (SERVICE_HUB_ADDRESS) to the
  // customer — an "AI Pricing Engine" input. Falls back to a default when no Maps key
  // or hub is configured, so on-site jobs still get a sensible trip distance.
  async poolDistanceMiles(customerAddress?: string | null, fallback = 8): Promise<number> {
    const hub = (this.config.get<string>("SERVICE_HUB_ADDRESS") || "").trim();
    if (!this.key || !hub || !customerAddress) return fallback;
    return this.distanceMiles(hub, customerAddress, fallback);
  }

  // Live ETA in minutes from the provider's current GPS point to the customer address.
  // Returns null when it can't be computed (no Maps key or the address won't geocode),
  // matching the codebase's "ETA only when Maps is available" contract.
  async etaMinutesFromPoint(lat: number, lng: number, address?: string | null, avgMph = 25): Promise<number | null> {
    if (!this.key || !address) return null;
    const dest = await this.geocode(address);
    if (!dest) return null;
    const miles = this.roadMiles({ lat, lng }, dest);
    return Math.max(1, Math.round((miles / avgMph) * 60));
  }
}
