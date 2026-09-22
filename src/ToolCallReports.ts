import type {UpdateSessionEvent} from "./ACPSessionConnection";

type ToolCallReport = Extract<UpdateSessionEvent, {sessionUpdate: "tool_call" | "tool_call_update"}>;

/** The client appends these metadata values, so the adapter never compares them with an earlier value. */
const OUTPUT_DELTA_META_KEYS = new Set(["terminal_output", "terminal_output_delta", "mcp_output_delta"]);
const COMPARED_FIELDS = ["title", "kind", "status", "name", "content", "locations", "rawInput", "rawOutput"] as const;
const META_FIELD_PREFIX = "_meta.";

/**
 * Keeps the fields that the adapter reported for each open tool call in one session.
 *
 * ACP clients merge a `tool_call_update` into the stored tool call.
 * A present field replaces the stored value, and a `_meta` key replaces the stored key.
 * So an update carries only the fields that changed since the last report.
 * The record of a tool call goes away when the tool call reaches a terminal status.
 */
export class ToolCallReports {
    private readonly openToolCalls = new Map<string, Map<string, string>>();

    /**
     * Returns the update to send, without the fields that did not change.
     * Returns `null` when nothing is left to send.
     */
    prepare(sessionId: string, update: UpdateSessionEvent): UpdateSessionEvent | null {
        if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
            return update;
        }
        const key = `${sessionId}\u0000${update.toolCallId}`;
        const prepared = update.sessionUpdate === "tool_call"
            ? this.recordStart(key, update)
            : this.recordUpdate(key, update);
        if (prepared !== null && (prepared.status === "completed" || prepared.status === "failed")) {
            this.finish(key);
        }
        return prepared;
    }

    private recordStart(key: string, update: ToolCallReport): ToolCallReport {
        const fields = new Map<string, string>();
        for (const [name, value] of reportedFields(update)) {
            fields.set(name, value);
        }
        this.openToolCalls.set(key, fields);
        return update;
    }

    private recordUpdate(key: string, update: ToolCallReport): ToolCallReport | null {
        const fields = this.openToolCalls.get(key) ?? new Map<string, string>();
        this.openToolCalls.set(key, fields);
        const prepared: Record<string, unknown> = {...update};
        const meta = isRecord(update._meta) ? {...update._meta} : undefined;
        for (const [name, value] of reportedFields(update)) {
            if (fields.get(name) === value) {
                if (name.startsWith(META_FIELD_PREFIX)) {
                    delete meta?.[name.slice(META_FIELD_PREFIX.length)];
                } else {
                    delete prepared[name];
                }
                continue;
            }
            fields.set(name, value);
        }
        if (meta !== undefined) {
            if (Object.keys(meta).length > 0) {
                prepared["_meta"] = meta;
            } else {
                delete prepared["_meta"];
            }
        }
        return hasPayload(prepared) ? prepared as ToolCallReport : null;
    }

    private finish(key: string): void {
        this.openToolCalls.delete(key);
    }
}

function reportedFields(update: ToolCallReport): Array<[string, string]> {
    const fields: Array<[string, string]> = [];
    const record = update as Record<string, unknown>;
    for (const name of COMPARED_FIELDS) {
        const value = record[name];
        if (value !== undefined) fields.push([name, JSON.stringify(value)]);
    }
    if (isRecord(update._meta)) {
        for (const [name, value] of Object.entries(update._meta)) {
            if (value === undefined || OUTPUT_DELTA_META_KEYS.has(name)) continue;
            fields.push([`${META_FIELD_PREFIX}${name}`, JSON.stringify(value)]);
        }
    }
    return fields;
}

function hasPayload(update: Record<string, unknown>): boolean {
    return Object.keys(update).some(name => name !== "sessionUpdate" && name !== "toolCallId");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
