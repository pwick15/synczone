import { useEffect, useState } from "react";
import type { Participant } from "../shared/types";
import { getMe, setMe } from "./storage";

/** The participant this browser joined a session as, if any. */
export function useMe(sid: string, participants: Participant[] | undefined) {
  const [meId, setMeId] = useState(() => getMe(sid));
  useEffect(() => setMeId(getMe(sid)), [sid]);
  const me = participants?.find((p) => p.id === meId) ?? null;

  useEffect(() => {
    // Stored id no longer exists in this session (e.g. database reset): ask to join again.
    if (participants && meId && !me) {
      setMe(sid, null);
      setMeId(null);
    }
  }, [participants, meId, me, sid]);

  return { me, setMeId };
}
