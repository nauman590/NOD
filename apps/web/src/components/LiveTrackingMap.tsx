import { useEffect, useRef, useState } from "react";
import { MapPin, Navigation } from "lucide-react";
import { loadGoogleMaps, mapsEnabled } from "@/lib/maps";

interface Props {
  lat: number | null;
  lng: number | null;
  lastUpdate: number | null;
  etaMinutes?: number | null;
  vehicleType?: string | null;
}

// Shows the provider's live position. Renders a real Google Map when a Maps key is
// configured; otherwise a graceful live-status card (GPS still streams in real time).
export default function LiveTrackingMap({ lat, lng, lastUpdate, etaMinutes, vehicleType }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!mapsEnabled() || lat == null || lng == null) return;
    let cancelled = false;
    loadGoogleMaps().then((maps) => {
      if (cancelled || !maps || !divRef.current) return;
      if (!mapRef.current) {
        mapRef.current = new maps.Map(divRef.current, { center: { lat, lng }, zoom: 14, disableDefaultUI: true });
        markerRef.current = new maps.Marker({ position: { lat, lng }, map: mapRef.current });
      }
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [lat, lng]);

  useEffect(() => {
    if (ready && mapRef.current && markerRef.current && lat != null && lng != null) {
      markerRef.current.setPosition({ lat, lng });
      mapRef.current.panTo({ lat, lng });
    }
  }, [lat, lng, ready]);

  const ago = lastUpdate ? Math.max(0, Math.round((Date.now() - lastUpdate) / 1000)) : null;
  const sharing = lat != null && lng != null;

  if (mapsEnabled()) {
    return (
      <div className="mt-6 overflow-hidden rounded-3xl border border-border">
        <div ref={divRef} className="h-56 w-full bg-muted" />
        <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Navigation className="h-3.5 w-3.5 text-primary" /> Live location
            {vehicleType && <span className="text-muted-foreground/80">· {vehicleType}</span>}
          </span>
          {etaMinutes != null && <span>ETA ~{etaMinutes} min</span>}
        </div>
      </div>
    );
  }

  // No Maps key yet — graceful live card.
  return (
    <div className="mt-6 rounded-3xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className={`h-2.5 w-2.5 rounded-full ${sharing ? "animate-pulse bg-primary" : "bg-muted-foreground/40"}`} />
        {sharing ? "Your pro is sharing live location" : "Waiting for live location…"}
      </div>
      {sharing && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> {lat!.toFixed(5)}, {lng!.toFixed(5)}
          {ago != null && <span>· updated {ago}s ago</span>}
        </div>
      )}
      {(etaMinutes != null || vehicleType) && (
        <div className="mt-1 text-xs text-muted-foreground">
          {vehicleType && <span>{vehicleType}</span>}
          {vehicleType && etaMinutes != null && <span> · </span>}
          {etaMinutes != null && <span>ETA ~{etaMinutes} min</span>}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">The live map appears here once the Google Maps key is added.</p>
    </div>
  );
}
