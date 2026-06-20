import { Elysia, t } from "elysia";
import { getActiveLoop } from "../agent/runner.ts";

const controlBody = t.Object({
  message: t.String(),
});

export const sessionControlRoutes = new Elysia({
  name: "routes.session-controls",
})
  .post(
    "/api/sessions/:id/steer",
    ({ params, body }) => {
      const loop = getActiveLoop(params.id);
      if (!loop) {
        return new Response("No active run for this session", {
          status: 404,
        });
      }
      loop.steer(body.message);
      return { ok: true };
    },
    { body: controlBody }
  )
  .post(
    "/api/sessions/:id/follow-up",
    ({ params, body }) => {
      const loop = getActiveLoop(params.id);
      if (!loop) {
        return new Response("No active run for this session", {
          status: 404,
        });
      }
      loop.followUp(body.message);
      return { ok: true };
    },
    { body: controlBody }
  );
