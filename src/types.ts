export interface Station {
  id: string;
  manager: string;
  brand: string;
  roadType: string;
  name: string;
  address: string;
  city: string;
  province: string;
  latitude: number;
  longitude: number;
}

export interface FuelPrice {
  stationId: string;
  fuel: string;
  price: number;
  isSelf: boolean;
  communicatedAt: string;
}

export interface Offer extends Station {
  price: number;
  communicatedAt: string;
  distanceKm: number;
}

/** Prezzo migliore rilevato in un controllo programmato. */
export interface PriceSample {
  at: string;
  price: number;
}

/** `fixed`: soglia scelta dall'utente. `auto`: ricavata dallo storico. */
export type ThresholdMode = "fixed" | "auto";

export interface AlertState {
  lastRunAt?: string;
  lastDatasetDate?: string;
  lastWasBelow?: boolean;
  lastAlertPrice?: number;
  lastAlertStationId?: string;
  lastAlertAt?: string;
  priceHistory?: PriceSample[];
}

export type PendingAction = "threshold" | "radius" | "hours" | undefined;

export interface Subscriber {
  chatId: number;
  userId: number;
  username?: string;
  firstName?: string;
  latitude?: number;
  longitude?: number;
  radiusKm: number;
  threshold: number;
  thresholdMode: ThresholdMode;
  hours: number[];
  enabled: boolean;
  requireTodayUpdate: boolean;
  pendingAction?: PendingAction;
  lastCheckKey?: string;
  lastWasBelow?: boolean;
  lastAlertPrice?: number;
  lastAlertStationId?: string;
  priceHistory?: PriceSample[];
  createdAt: string;
  updatedAt: string;
}

export interface SubscriberDatabase {
  subscribers: Subscriber[];
}
