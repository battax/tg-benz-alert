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

export interface AlertState {
  lastRunAt?: string;
  lastDatasetDate?: string;
  lastWasBelow?: boolean;
  lastAlertPrice?: number;
  lastAlertStationId?: string;
  lastAlertAt?: string;
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
  hours: number[];
  enabled: boolean;
  requireTodayUpdate: boolean;
  pendingAction?: PendingAction;
  lastCheckKey?: string;
  lastWasBelow?: boolean;
  lastAlertPrice?: number;
  lastAlertStationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriberDatabase {
  subscribers: Subscriber[];
}
