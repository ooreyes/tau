import { useEffect, useState } from "react";
import {
  CLOUD_AI_CONSENT_CHANGE_EVENT,
  loadCloudAiConsent,
  type CloudAiConsent,
} from "./cloudAiConsent";

export function useCloudAiConsent(): CloudAiConsent {
  const [consent, setConsent] = useState(loadCloudAiConsent);
  useEffect(() => {
    const sync = () => setConsent(loadCloudAiConsent());
    window.addEventListener(CLOUD_AI_CONSENT_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CLOUD_AI_CONSENT_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return consent;
}
