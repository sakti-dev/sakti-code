import { Elysia, t } from "elysia";
import { getActiveHarness } from "../agent/runner.ts";

const controlBody = t.Object({
  message: t.String(),
});

export const sessionControlRoutes = new Elysia({
  name: "routes.session-controls",
})
  .post(
    "/api/sessions/:id/steer",
    ({ params, body }) => {
      const harness = getActiveHarness(params.id);
      if (!harness) {
        return new Response("No active run for this session", {
          status: 404,
        });
      }
      harness.steer(body.message).catch(() => {});
      return { ok: true };
    },
    { body: controlBody }
  )
  .post(
    "/api/sessions/:id/follow-up",
    ({ params, body }) => {
      const harness = getActiveHarness(params.id);
      if (!harness) {
        return new Response("No active run for this session", {
          status: 404,
        });
      }
      harness.followUp(body.message).catch(() => {});
      return { ok: true };
    },
    { body: controlBody }
  );
