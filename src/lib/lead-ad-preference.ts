type PreferenceFields = Record<string, string>;

export function formMeasurementRefused(fields?: PreferenceFields): boolean {
  const choice = fields?.consentimento_medicao;
  return choice !== undefined && choice !== "permitido";
}

// Subsequent CRM edits may replace the other form fields. Only a new explicit
// preference can replace the one attached to the original request.
export function preserveFormPreference(previous: PreferenceFields | undefined, incoming: PreferenceFields | undefined): PreferenceFields | undefined {
  const choice = previous?.consentimento_medicao;
  if (choice === undefined || incoming?.consentimento_medicao !== undefined) return incoming;
  return { ...incoming, consentimento_medicao: choice };
}
