/**
 * Events API - Event catch-up and replay endpoint
 *
 * Provides endpoint for fetching persisted events for catch-up synchronization.
 *
 * Batch 3: Stream Processing - WS5 Catch-up/Reconnect
 */

import { createLogger } from "@sakti-code/shared/logger";
import { and, asc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { events } from "../../db/schema";
import type { Env } from "../index";

const app = new Hono<Env>();
const logger = createLogger("server:events");

/**
 * Query schema for events endpoint
 */
const eventsQuerySchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
  afterSequence: z.coerce.number().optional(),
  afterEventId: z.string().optional(),
  limit: z.coerce.number().min(1).max(1000).default(100),
});

/**
 * Event response type
 */
interface EventResponse {
  eventId: string;
  sessionId: string;
  sequence: number;
  type: string;
  properties: Record<string, unknown>;
  directory?: string;
  timestamp: number;
}

/**
 * Events list response
 */
interface EventsListResponse {
  sessionId: string;
  events: EventResponse[];
  hasMore: boolean;
  total: number;
  firstSequence: number;
  lastSequence: number;
}

/**
 * GET /api/events
 *
 * Fetch events for a session with optional sequence-based pagination.
 * Used for catch-up synchronization when SSE reconnects.
 *
 * Query parameters:
 * - sessionId: Session to fetch events for (required)
 * - afterSequence: Fetch events after this sequence number (optional)
 * - afterEventId: Fetch events after this event ID (optional, alternative to afterSequence)
 * - limit: Maximum events to return (default: 100, max: 1000)
 *
 * @example
 * GET /api/events?sessionId=abc123&afterSequence=42&limit=50
 */
app.get("/api/events", async c => {
  // Parse and validate query parameters
  const queryResult = eventsQuerySchema.safeParse({
    sessionId: c.req.query("sessionId"),
    afterSequence: c.req.query("afterSequence"),
    afterEventId: c.req.query("afterEventId"),
    limit: c.req.query("limit"),
  });

  if (!queryResult.success) {
    const formattedErrors = queryResult.error.issues.map(issue => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    logger.warn("Invalid events query", { errors: formattedErrors });
    return c.json({ error: "Invalid query parameters", details: formattedErrors }, 400);
  }

  const { sessionId, afterSequence, afterEventId, limit } = queryResult.data;

  logger.debug("Fetching events", { sessionId, afterSequence, afterEventId, limit });

  try {
    // Build query conditions
    let conditions = eq(events.session_id, sessionId);

    // Handle afterSequence filter
    if (afterSequence !== undefined) {
      conditions = and(conditions, gt(events.sequence, afterSequence))!;
    }

    // Handle afterEventId filter (look up the sequence first)
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

    // Get total count for pagination info
    const totalResult = await db
      .select({ count: db.$count(events) })
      .from(events)
      .where(eq(events.session_id, sessionId));

    const total = totalResult[0]?.count ?? 0;

    // Fetch events
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
      .limit(limit + 1); // Fetch one extra to determine hasMore

    const hasMore = eventsList.length > limit;
    const eventsToReturn = hasMore ? eventsList.slice(0, limit) : eventsList;

    // Map to response format
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

/**
 * GET /api/events/health
 *
 * Health check for events endpoint
 */
app.get("/api/events/health", c => {
  return c.json({ status: "ok", service: "events" });
});

export default app;
