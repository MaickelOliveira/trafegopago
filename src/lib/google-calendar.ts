import { google } from "googleapis";
import { getConfig } from "./clients";

function getOAuth2Client(baseUrl?: string) {
  const config = getConfig();
  const clientId = process.env.GOOGLE_CLIENT_ID || config.googleClientId;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || config.googleClientSecret;
  const base = baseUrl || config.appBaseUrl || "";
  const redirectUri = `${base}/api/agent/google-auth/callback`;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(clientId: string, baseUrl?: string): string {
  const oauth2 = getOAuth2Client(baseUrl);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
    state: clientId,
  });
}

export async function exchangeCode(code: string, baseUrl?: string): Promise<string> {
  const oauth2 = getOAuth2Client(baseUrl);
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) throw new Error("No refresh token received");
  return tokens.refresh_token;
}

async function getCalendar(refreshToken: string) {
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth: oauth2 });
}

export type TimeSlot = { start: string; end: string };

export async function listFreeSlots(
  refreshToken: string,
  calendarId: string,
  date: string // YYYY-MM-DD
): Promise<TimeSlot[]> {
  const calendar = await getCalendar(refreshToken);
  const dayStart = new Date(`${date}T08:00:00`);
  const dayEnd = new Date(`${date}T18:00:00`);

  const { data } = await calendar.freebusy.query({
    requestBody: {
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      items: [{ id: calendarId }],
    },
  });

  const busy = (data.calendars?.[calendarId]?.busy ?? []) as { start?: string | null; end?: string | null }[];
  const slots: TimeSlot[] = [];
  let current = new Date(dayStart);

  while (current < dayEnd) {
    const slotEnd = new Date(current.getTime() + 60 * 60 * 1000); // 1h slots
    const isBusy = busy.some((b) => {
      if (!b.start || !b.end) return false;
      const bStart = new Date(b.start);
      const bEnd = new Date(b.end);
      return current < bEnd && slotEnd > bStart;
    });
    if (!isBusy) {
      slots.push({
        start: current.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        end: slotEnd.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      });
    }
    current = slotEnd;
  }

  return slots;
}

export async function createEvent(
  refreshToken: string,
  calendarId: string,
  opts: {
    title: string;
    description?: string;
    startDateTime: string; // ISO
    endDateTime: string;   // ISO
    location?: string;
  }
): Promise<{ eventId: string; link: string }> {
  const calendar = await getCalendar(refreshToken);
  const { data } = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: opts.title,
      description: opts.description,
      location: opts.location,
      start: { dateTime: opts.startDateTime, timeZone: "America/Sao_Paulo" },
      end: { dateTime: opts.endDateTime, timeZone: "America/Sao_Paulo" },
    },
  });
  return {
    eventId: data.id ?? "",
    link: data.htmlLink ?? "",
  };
}

export async function cancelEvent(
  refreshToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const calendar = await getCalendar(refreshToken);
  await calendar.events.delete({ calendarId, eventId });
}

export type EventItem = {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
};

export async function listEvents(
  refreshToken: string,
  calendarId: string,
  timeMin?: string,
  timeMax?: string
): Promise<EventItem[]> {
  const calendar = await getCalendar(refreshToken);
  const now = timeMin ?? new Date().toISOString();
  const until = timeMax ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await calendar.events.list({
    calendarId,
    timeMin: now,
    timeMax: until,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 20,
  });
  return (data.items ?? []).map((e) => ({
    id: e.id ?? "",
    title: e.summary ?? "",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    description: e.description ?? undefined,
  })).filter((e) => e.id);
}

export async function updateEvent(
  refreshToken: string,
  calendarId: string,
  eventId: string,
  opts: { startDateTime: string; endDateTime: string; title?: string; description?: string }
): Promise<void> {
  const calendar = await getCalendar(refreshToken);
  const { data: existing } = await calendar.events.get({ calendarId, eventId });
  await calendar.events.update({
    calendarId,
    eventId,
    requestBody: {
      ...existing,
      summary: opts.title ?? existing.summary,
      description: opts.description ?? existing.description,
      start: { dateTime: opts.startDateTime, timeZone: "America/Sao_Paulo" },
      end: { dateTime: opts.endDateTime, timeZone: "America/Sao_Paulo" },
    },
  });
}

export async function isCalendarConnected(refreshToken: string, calendarId: string): Promise<boolean> {
  try {
    const calendar = await getCalendar(refreshToken);
    await calendar.calendars.get({ calendarId });
    return true;
  } catch {
    return false;
  }
}

export type CalendarItem = { id: string; name: string; primary: boolean };

export async function listCalendars(refreshToken: string): Promise<CalendarItem[]> {
  const calendar = await getCalendar(refreshToken);
  const { data } = await calendar.calendarList.list({ minAccessRole: "writer" });
  return (data.items ?? []).map((c) => ({
    id: c.id ?? "",
    name: c.summary ?? c.id ?? "",
    primary: c.primary === true,
  })).filter((c) => c.id);
}
