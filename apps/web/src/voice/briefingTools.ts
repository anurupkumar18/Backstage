import type { ApiClient } from "../api/client";

export type BriefingReadClient = Pick<ApiClient, "getStatus" | "listIncidents" | "listEvents">;

/** This executor has no write method, URL supplied by the model, or dynamic property dispatch. */
export function createBriefingTools(client: BriefingReadClient, tier: number) {
  return async (name: string, rawArguments: string): Promise<unknown> => {
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawArguments);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "invalid_arguments" };
      args = parsed as Record<string, unknown>;
    } catch { return { error: "invalid_arguments" }; }
    if (name === "get_status" && Object.keys(args).length === 0) {
      const result = await client.getStatus();
      return result.ok ? result.data : { error: result.code };
    }
    if (tier < 1) return { error: "tool_not_allowed" };
    if (name === "list_incidents" && Object.keys(args).length === 0) {
      const result = await client.listIncidents();
      if (!result.ok) return { error: result.code };
      return { items: result.data.items.map(({ id, type, room_id, state, priority, verification, allowed_actions }) => ({
        id, type, room_id, state, priority, verification: verification.status, allowed_actions,
      })), has_more: result.data.next_cursor !== null };
    }
    if (name === "get_incident_events" && Object.keys(args).length === 1 && typeof args.incident_id === "string" && args.incident_id.length <= 200) {
      const scoped = await client.listIncidents();
      if (!scoped.ok) return { error: scoped.code };
      if (!scoped.data.items.some((item) => item.id === args.incident_id)) return { error: "not_found" };
      const result = await client.listEvents(args.incident_id);
      if (!result.ok) return { error: result.code };
      return { items: result.data.items.filter((event) => event.incident_id === args.incident_id).map(
        ({ type, occurred_at, state_from, state_to, actor }) => ({ type, occurred_at, state_from, state_to, actor_kind: actor.kind }),
      ), has_more: result.data.next_cursor !== null };
    }
    return { error: "tool_not_allowed" };
  };
}
