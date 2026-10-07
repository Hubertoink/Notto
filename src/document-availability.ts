export interface DocumentAvailability {
  status: 'available' | 'unavailable' | 'unknown';
  message: string;
}
