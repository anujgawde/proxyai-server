import { MeetingProvider } from 'src/entities/meeting.entity';

/**
 * Utility class for detecting meeting platforms from URLs
 */
export class MeetingPlatformDetector {
  private static readonly URL_PATTERNS: Record<MeetingProvider, RegExp[]> = {
    [MeetingProvider.ZOOM]: [
      /zoom\.us\/j\//i,
      /zoom\.us\/meeting\//i,
      /.*\.zoom\.us/i,
    ],
    [MeetingProvider.GOOGLE_MEET]: [
      /meet\.google\.com/i,
      /hangouts\.google\.com/i,
    ],
    [MeetingProvider.TEAMS]: [
      /teams\.microsoft\.com/i,
      /teams\.live\.com/i,
    ],
  };

  /**
   * Detects the meeting platform from a meeting URL
   * @param meetingUrl - The URL of the meeting
   * @returns MeetingProvider or null if no match found
   */
  static detectPlatform(meetingUrl: string): MeetingProvider | null {
    if (!meetingUrl) return null;

    for (const [provider, patterns] of Object.entries(this.URL_PATTERNS)) {
      if (patterns.some((pattern) => pattern.test(meetingUrl))) {
        return provider as MeetingProvider;
      }
    }

    return null;
  }

  /**
   * Checks if a URL is a supported meeting platform
   * @param meetingUrl - The URL to check
   * @returns boolean indicating if the URL matches a supported platform
   */
  static isSupportedPlatform(meetingUrl: string): boolean {
    return this.detectPlatform(meetingUrl) !== null;
  }
}
