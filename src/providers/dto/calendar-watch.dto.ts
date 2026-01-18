export interface GoogleWebhookHeaders {
  'x-goog-channel-id': string;
  'x-goog-resource-id': string;
  'x-goog-resource-state': 'sync' | 'exists' | 'not_exists';
  'x-goog-message-number'?: string;
  'x-goog-channel-token'?: string;
  'x-goog-channel-expiration'?: string;
}

export interface WatchSetupRequest {
  id: string; // Our channel ID (UUID)
  type: 'web_hook';
  address: string; // Our webhook URL
  expiration?: number; // Timestamp in ms
  token?: string; // Optional custom token for verification
}

export interface WatchSetupResponse {
  kind: string;
  id: string;
  resourceId: string;
  resourceUri: string;
  expiration: string;
}

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}

export interface GoogleCalendarEvent {
  id: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  start?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType: string;
      uri?: string;
    }>;
  };
  location?: string;
  organizer?: {
    email?: string;
    self?: boolean;
  };
  attendees?: Array<{
    email: string;
    responseStatus?: string;
  }>;
  updated?: string;
  created?: string;
}

export interface GoogleCalendarListResponse {
  kind: string;
  etag: string;
  summary: string;
  updated: string;
  timeZone: string;
  accessRole: string;
  nextSyncToken?: string;
  nextPageToken?: string;
  items: GoogleCalendarEvent[];
}
