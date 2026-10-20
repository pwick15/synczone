export interface Session {
  id: string;
  name: string;
  createdAt: number;
}

export interface Participant {
  id: string;
  initials: string;
  tz: string;
  color: number;
}

export interface Meeting {
  id: string;
  title: string;
  /** UTC epoch ms, inclusive. */
  startUtc: number;
  /** UTC epoch ms, exclusive. */
  endUtc: number;
  slotMinutes: number;
  tz: string;
  createdBy: string | null;
  chosenStart: number | null;
  chosenEnd: number | null;
  createdAt: number;
}

export interface MeetingSummary extends Meeting {
  responded: number;
}

export interface SessionPayload {
  session: Session;
  participants: Participant[];
  meetings: MeetingSummary[];
}

export interface MeetingPayload {
  session: Session;
  participants: Participant[];
  meeting: Meeting;
  /** participantId -> sorted slot indexes they are free in. */
  availability: Record<string, number[]>;
}

export const SLOT_OPTIONS = [15, 30, 60] as const;
export const MAX_DAYS = 14;
export const INITIALS_RE = /^[A-Z0-9]{1,4}$/;
