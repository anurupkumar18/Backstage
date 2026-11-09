/**
 * Venue facts come from events.linuxfoundation.org (fetched 2026-11-09).
 * Capacities, accessibility routes and badge pickup are not published there, so none are stored here.
 * The room mapping below is a demo assumption. Confirm it against the venue map on site and edit this file only.
 */

export const EVENT = {
  name: "KubeCon + CloudNativeCon North America 2026",
  dates: "November 9-12, 2026",
  city: "Salt Lake City, Utah",
  venue: "Salt Palace Convention Center",
  address: "90 South West Temple, Salt Lake City, UT 84101",
  overflowVenue: "Hyatt Regency Salt Lake City",
  scale: { attendees: "9,000+", organizations: "2,100+", sessions: "400+" },
  source: "https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/",
} as const;

/** Rooms and areas named on the event page. Not every one is used by a demo incident. */
export const NAMED_AREAS = [
  "Hall DE",
  "Grand Ballroom GI",
  "Room 151",
  "Room 251 A-C",
  "Room 254",
  "Room 255 A",
  "Room 255 BC",
  "Hyatt Regency, Regency Ballroom B",
  "Solutions Showcase, Hall 1 (Alpine Overlook Zone)",
  "Solutions Showcase, Hall 5 (Cosmic Canyon Zone, Cloud Native Theater)",
] as const;

/**
 * Frozen contract IDs stay the same on the wire. Only the label shown to people changes.
 * Assumed: the demo overflow room is a mid-size Level 2 session room and the badge stall is at registration.
 */
const ROOM_LABELS: Record<string, string> = {
  "room-b": "Room 255 BC",
  "room-c": "Registration",
};

export function venueRoomLabel(roomId: string, fallback: string): string {
  return ROOM_LABELS[roomId] ?? fallback;
}
