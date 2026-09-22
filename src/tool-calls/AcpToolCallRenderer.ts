import type * as acp from "@agentclientprotocol/sdk";
import type {UpdateSessionEvent} from "../ACPSessionConnection";
import {AIR_CONTEXT_COMPACTION_KEY, withAirMeta} from "../AirExtension";
import type {ClientCapabilities} from "./ClientCapabilities";
import type {PermissionToolFacts, ToolFacts} from "./ToolFacts";

export const AIR_SUBAGENT_KEY = "subagent";

type ToolCallReport = Extract<UpdateSessionEvent, {sessionUpdate: "tool_call" | "tool_call_update"}>;

/**
 * Turns the facts of a `ToolReporter` into ACP tool call fields.
 *
 * Each fact goes into one field, see `docs/acp-tool-call-contract.md`.
 * The capabilities decide the terminal channel and the display copy of the input.
 * `ToolCallReports` then drops the fields that an earlier report already sent.
 */
export class AcpToolCallRenderer {
    constructor(readonly capabilities: ClientCapabilities) {}

    render(facts: ToolFacts): ToolCallReport {
        // A `tool_call` requires a title.
        const title = facts.report === "start" ? facts.title ?? "" : facts.title;
        const fields = {
            toolCallId: facts.toolCallId,
            ...(facts.name === undefined ? {} : {name: facts.name}),
            ...(facts.kind === undefined ? {} : {kind: facts.kind}),
            ...(title === undefined ? {} : {title}),
            ...(facts.status === undefined ? {} : {status: facts.status}),
            ...this.contentField(facts),
            ...locationsField(facts.locations),
            ...(facts.input === undefined ? {} : {rawInput: facts.input}),
            ...(facts.opaqueResult === undefined ? {} : {rawOutput: facts.opaqueResult}),
            ...this.metaField(facts),
        };
        if (facts.report === "start") {
            return {sessionUpdate: "tool_call", ...fields} as ToolCallReport;
        }
        return {sessionUpdate: "tool_call_update", ...fields};
    }

    renderPermissionToolCall(facts: PermissionToolFacts): acp.ToolCallUpdate {
        return {
            toolCallId: facts.toolCallId,
            ...(facts.name === undefined ? {} : {name: facts.name}),
            ...(facts.kind === undefined ? {} : {kind: facts.kind}),
            ...(facts.status === undefined ? {} : {status: facts.status}),
            ...(facts.title === undefined ? {} : {title: facts.title}),
            ...(facts.input === undefined ? {} : {rawInput: facts.input}),
            ...locationsField(facts.locations),
            ...this.contentField(facts),
        };
    }

    private contentField(facts: PermissionToolFacts & {terminal?: unknown}): {content?: acp.ToolCallContent[]} {
        const readableInput = facts.readableInput !== undefined && !this.capabilities.air.rawInputRendering
            ? [textContent(facts.readableInput)]
            : [];
        if (facts.terminal === undefined && readableInput.length === 0 && facts.result === undefined) {
            return {};
        }
        return {
            content: [
                ...(facts.terminal === undefined ? [] : [{type: "terminal" as const, terminalId: facts.toolCallId}]),
                ...readableInput,
                ...(facts.result ?? []),
            ],
        };
    }

    private metaField(facts: ToolFacts): {_meta?: Record<string, unknown>} {
        const terminalId = facts.toolCallId;
        let meta: Record<string, unknown> = {
            ...(facts.terminal === undefined ? {} : {terminal_info: {cwd: facts.terminal.cwd, terminal_id: terminalId}}),
            ...(facts.terminalInput === undefined ? {} : {terminal_input: {data: facts.terminalInput, terminal_id: terminalId}}),
            ...(facts.terminalOutput === undefined ? {} : {
                [this.capabilities.terminalOutputDelta ? "terminal_output_delta" : "terminal_output"]: {
                    data: facts.terminalOutput,
                    terminal_id: terminalId,
                },
            }),
            ...(facts.terminalExit === undefined ? {} : {
                terminal_exit: {exit_code: facts.terminalExit.exitCode, signal: null, terminal_id: terminalId},
            }),
            ...(facts.mcpProgress === undefined ? {} : {mcp_output_delta: {data: facts.mcpProgress}}),
            ...(facts.mcp ? {is_mcp_tool_call: true} : {}),
        };
        if (facts.subagent) meta = withAirMeta(meta, AIR_SUBAGENT_KEY, true);
        if (facts.contextCompaction !== undefined) {
            meta = withAirMeta(meta, AIR_CONTEXT_COMPACTION_KEY, facts.contextCompaction);
        }
        return Object.keys(meta).length > 0 ? {_meta: meta} : {};
    }
}

export function textContent(text: string): acp.ToolCallContent {
    return {type: "content", content: {type: "text", text}};
}

function locationsField(paths: string[] | undefined): {locations?: acp.ToolCallLocation[]} {
    return paths === undefined || paths.length === 0 ? {} : {locations: paths.map(path => ({path}))};
}
