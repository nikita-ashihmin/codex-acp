import type * as acp from "@agentclientprotocol/sdk";
import type {ContextCompactionMetadata} from "../ContextCompactionMeta";

/**
 * What a `ToolReporter` knows about one report of a tool call, before the client shape is chosen.
 *
 * Each fact has one field. `AcpToolCallRenderer` puts each fact into exactly one ACP field,
 * see `docs/acp-tool-call-contract.md`. An absent field means "no news" for this report.
 */
export type ToolFacts = {
    toolCallId: string;
    /** `start` renders a `tool_call`, `update` renders a `tool_call_update`. */
    report: "start" | "update";
    /** The programmatic tool name. */
    name?: string;
    kind?: acp.ToolKind;
    title?: string;
    status?: acp.ToolCallStatus;
    /** Paths of the files that the tool reads, searches or edits. */
    locations?: string[];
    /** The tool parameters. */
    input?: Record<string, unknown>;
    /**
     * Input that the user reads, for example a subagent prompt or a question.
     * A client without the AIR `rawInputRendering` capability gets one display copy in `content`.
     */
    readableInput?: string;
    /** The result to show. */
    result?: acp.ToolCallContent[];
    /** A result that has no display form. */
    opaqueResult?: unknown;
    /** The tool call shows a terminal. The terminal id is the tool call id. Only a `start` report sets it. */
    terminal?: {cwd: string};
    /** Command output to append to the terminal. */
    terminalOutput?: string;
    /** Text that was written to the stdin of the command. */
    terminalInput?: string;
    /** The command ended. */
    terminalExit?: {exitCode: number | null};
    /** MCP progress text to append. */
    mcpProgress?: string;
    mcp?: boolean;
    subagent?: boolean;
    contextCompaction?: ContextCompactionMetadata;
};

/**
 * The tool call of a permission request. The client merges it into the stored tool call.
 * A reporter sets only `toolCallId`, `title`, `input`, and the facts that the client does not have yet.
 */
export type PermissionToolFacts = Omit<ToolFacts, "report" | "terminal" | "terminalOutput" | "terminalInput"
    | "terminalExit" | "mcpProgress">;
