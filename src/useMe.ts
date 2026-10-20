import { useCallback, useEffect, useState } from "react";
import type { Participant } from "../shared/types";
import { getMe, setLastMe, setMe } from "./storage";

/** Who you are in this tab for a session, and a way to switch. */
export function useMe(sid: string, participants: Participant[] | undefined) {
  const [meId, setMeId] = useState(() => getMe(sid));
  useEffect(() => setMeId(getMe(sid)), [sid]);
  const me = participants?.find((p) => p.id === meId) ?? null;

  useEffect(() => {
    // Picked person no longer exists in this session (e.g. database reset): ask again.
    if (participants && meId && !me) {
      setMe(sid, null);
      setMeId(null);
    }
  }, [participants, meId, me, sid]);

  const choose = useCallback(
    (pid: string) => {
      setMe(sid, pid);
      setLastMe(sid, pid);
      setMeId(pid);
    },
    [sid],
  );

  return { me, choose };
}
