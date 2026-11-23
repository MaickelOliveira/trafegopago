import { readRecordList } from "./record-store";
import { formMeasurementRefused } from "./lead-ad-preference";

export async function storedLeadRefusedMeasurement(id: string, clientId?: string): Promise<boolean> {
  const [lead] = await readRecordList<{ id: string; customFields?: Record<string, string> }>(
    "leads.json", { id, clientId },
  );
  return formMeasurementRefused(lead?.customFields);
}
