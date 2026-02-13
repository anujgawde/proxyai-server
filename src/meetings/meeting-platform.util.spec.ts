import { MeetingPlatformDetector } from './meeting-platform.util';
import { MeetingProvider } from '../entities/meeting.entity';

describe('MeetingPlatformDetector', () => {
  describe('detectPlatform', () => {
    it('should detect Google Meet from meet.google.com URL', () => {
      expect(
        MeetingPlatformDetector.detectPlatform(
          'https://meet.google.com/abc-def-ghi',
        ),
      ).toBe(MeetingProvider.GOOGLE_MEET);
    });

    it('should detect Google Meet from hangouts.google.com URL', () => {
      expect(
        MeetingPlatformDetector.detectPlatform(
          'https://hangouts.google.com/call/abc123',
        ),
      ).toBe(MeetingProvider.GOOGLE_MEET);
    });

    it('should detect Zoom from zoom.us/j/ URL', () => {
      expect(
        MeetingPlatformDetector.detectPlatform(
          'https://zoom.us/j/1234567890',
        ),
      ).toBe(MeetingProvider.ZOOM);
    });

    it('should detect Zoom from zoom.us/meeting/ URL', () => {
      expect(
        MeetingPlatformDetector.detectPlatform(
          'https://zoom.us/meeting/abc123',
        ),
      ).toBe(MeetingProvider.ZOOM);
    });

    it('should detect Zoom from subdomain.zoom.us URL', () => {
      expect(
        MeetingPlatformDetector.detectPlatform(
          'https://company.zoom.us/j/1234567890',
        ),
      ).toBe(MeetingProvider.ZOOM);
    });

    it('should detect Teams from teams.microsoft.com URL', () => {
      expect(
        MeetingPlatformDetector.detectPlatform(
          'https://teams.microsoft.com/l/meetup-join/abc',
        ),
      ).toBe(MeetingProvider.TEAMS);
    });

    it('should detect Teams from teams.live.com URL', () => {
      expect(
        MeetingPlatformDetector.detectPlatform(
          'https://teams.live.com/meet/abc',
        ),
      ).toBe(MeetingProvider.TEAMS);
    });

    it('should return null for unsupported platform URL', () => {
      expect(
        MeetingPlatformDetector.detectPlatform('https://example.com/meeting'),
      ).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(MeetingPlatformDetector.detectPlatform('')).toBeNull();
    });

    it('should return null for null/undefined input', () => {
      expect(MeetingPlatformDetector.detectPlatform(null as any)).toBeNull();
      expect(
        MeetingPlatformDetector.detectPlatform(undefined as any),
      ).toBeNull();
    });

    it('should be case-insensitive', () => {
      expect(
        MeetingPlatformDetector.detectPlatform(
          'https://MEET.GOOGLE.COM/abc-def',
        ),
      ).toBe(MeetingProvider.GOOGLE_MEET);
      expect(
        MeetingPlatformDetector.detectPlatform(
          'https://ZOOM.US/j/1234567890',
        ),
      ).toBe(MeetingProvider.ZOOM);
    });

    it('should handle URLs with query parameters', () => {
      expect(
        MeetingPlatformDetector.detectPlatform(
          'https://meet.google.com/abc-def?authuser=0&hs=122',
        ),
      ).toBe(MeetingProvider.GOOGLE_MEET);
    });
  });

  describe('isSupportedPlatform', () => {
    it('should return true for Google Meet URL', () => {
      expect(
        MeetingPlatformDetector.isSupportedPlatform(
          'https://meet.google.com/abc',
        ),
      ).toBe(true);
    });

    it('should return true for Zoom URL', () => {
      expect(
        MeetingPlatformDetector.isSupportedPlatform(
          'https://zoom.us/j/1234567890',
        ),
      ).toBe(true);
    });

    it('should return false for unsupported URL', () => {
      expect(
        MeetingPlatformDetector.isSupportedPlatform(
          'https://example.com/meeting',
        ),
      ).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(MeetingPlatformDetector.isSupportedPlatform('')).toBe(false);
    });
  });
});
