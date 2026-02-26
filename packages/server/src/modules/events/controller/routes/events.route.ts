import { createLogger } from "@sakti-code/shared/logger";
import { and, asc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../../../../db/index";
import { events } from "../../../../../db/schema";
import { zValidator } from "../../../../shared/controller/http/validators.js";

type Env = {
  Variables: {
    requestId: string;
    startTime: number;
  };
};

const app = new Hono<Env>();
const logger = createLogger("server:events");

const eventsQuerySchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
  afterSequence: z.coerce.number().optional(),
  afterEventId: z.string().optional(),
  limit: z.coerce.number().min(1).max(1000).default(100),
});

interface EventResponse {
  eventId: string;
  sessionId: string;
  sequence: number;
  type: string;
  properties: Record<string, unknown>;
  directory?: string;
  timestamp: number;
}

interface EventsListResponse {
  sessionId: string;
  events: EventResponse[];
  hasMore: boolean;
  total: number;
  firstSequence: number;
  lastSequence: number;
}

app.get("/api/events", zValidator("query", eventsQuerySchema), async c => {
  const { sessionId, afterSequence, afterEventId, limit } = c.req.valid("query");

  logger.debug("Fetching events", { sessionId, afterSequence, afterEventId, limit });

  try {
    let conditions = eq(events.session_id, sessionId);

    if (afterSequence !== undefined) {
      conditions = and(conditions, gt(events.sequence, afterSequence))!;
    }

    if (afterEventId && afterSequence === undefined) {
      const afterEvent = await db
        .select({ sequence: events.sequence })
        .from(events)
        .where(and(eq(events.session_id, sessionId), eq(events.event_id, afterEventId)))
        .limit(1);

      if (afterEvent.length > 0) {
        conditions = and(conditions, gt(events.sequence, afterEvent[0].sequence))!;
      }
    }

    const totalResult = await db
      .select({ count: db.$count(events) })
      .from(events)
      .where(eq(events.session_id, sessionId));

    const total = totalResult[0]?.count ?? 0;

    const eventsList = await db
      .select({
        event_id: events.event_id,
        session_id: events.session_id,
        sequence: events.sequence,
        event_type: events.event_type,
        properties: events.properties,
        directory: events.directory,
        created_at: events.created_at,
      })
      .from(events)
      .where(conditions)
      .orderBy(asc(events.sequence))
      .limit(limit + 1);

    const hasMore = eventsList.length > limit;
    const eventsToReturn = hasMore ? eventsList.slice(0, limit) : eventsList;

    const mappedEvents: EventResponse[] = eventsToReturn.map(event => ({
      eventId: event.event_id,
      sessionId: event.session_id,
      sequence: event.sequence,
      type: event.event_type,
      properties: event.properties,
      directory: event.directory ?? undefined,
      timestamp: event.created_at.getTime(),
    }));

    const response: EventsListResponse = {
      sessionId,
      events: mappedEvents,
      hasMore,
      total,
      firstSequence: mappedEvents[0]?.sequence ?? 0,
      lastSequence: mappedEvents[mappedEvents.length - 1]?.sequence ?? 0,
    };

    logger.debug("Events fetched", {
      sessionId,
      count: mappedEvents.length,
      hasMore,
      total,
    });

    return c.json(response);
  } catch (error) {
    logger.error("Failed to fetch events", error as Error, { sessionId });
    return c.json({ error: "Failed to fetch events" }, 500);
  }
});

app.get("/api/events/health", c => {
  return c.json({ status: "ok", service: "events" });
});

export const eventsRoutes = app;
