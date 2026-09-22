import type * as acp from "@agentclientprotocol/sdk";
import type {JsonValue} from "../../app-server/serde_json/JsonValue";
import type {McpToolCallError, McpToolCallResult, ThreadItem} from "../../app-server/v2";
import type {ToolFacts} from "../ToolFacts";
import {toToolStatus} from "./ToolStatus";

type McpToolCallItem = ThreadItem & {type: "mcpToolCall"};

/**
 * Reports a Codex MCP tool call.
 * The text and image blocks of the result are shown in `content`. The structured result and the error go to `rawOutput`.
 */
export class McpToolReporter {
    static started(item: McpToolCallItem): ToolFacts {
        return {
            toolCallId: item.id,
            report: "start",
            kind: "execute",
            title: `mcp.${item.server}.${item.tool}`,
            status: toToolStatus(item.status),
            input: mcpInput(item),
            ...resultFacts(item.result, item.error),
            mcp: true,
        };
    }

    static completed(item: McpToolCallItem): ToolFacts {
        return {
            toolCallId: item.id,
            report: "update",
            status: item.status === "completed" ? "completed" : "failed",
            input: mcpInput(item),
            ...resultFacts(item.result, item.error),
        };
    }

    /** MCP progress text, unchanged, so that the client can append the chunks. */
    static progress(itemId: string, message: string): ToolFacts {
        return {toolCallId: itemId, report: "update", mcpProgress: message};
    }
}

function mcpInput(item: McpToolCallItem): Record<string, unknown> {
    return {server: item.server, tool: item.tool, arguments: item.arguments};
}

function resultFacts(
    result: McpToolCallResult | null,
    error: McpToolCallError | null,
): Pick<ToolFacts, "result" | "opaqueResult"> {
    if (result === null && error === null) return {};
    const shown: acp.ToolCallContent[] = [];
    const other: JsonValue[] = [];
    for (const block of result?.content ?? []) {
        const content = displayBlock(block);
        if (content) shown.push({type: "content", content});
        else other.push(block);
    }
    const opaque: Record<string, JsonValue> = {
        ...(other.length > 0 ? {content: other} : {}),
        ...(result?.structuredContent != null ? {structuredContent: result.structuredContent} : {}),
        ...(error !== null ? {error: error.message} : {}),
    };
    return {
        ...(result !== null ? {result: shown} : {}),
        ...(Object.keys(opaque).length > 0 ? {opaqueResult: opaque} : {}),
    };
}

function displayBlock(block: JsonValue): acp.ContentBlock | null {
    if (block === null || typeof block !== "object" || Array.isArray(block)) return null;
    if (block["type"] === "text" && typeof block["text"] === "string") {
        return {type: "text", text: block["text"]};
    }
    if (block["type"] === "image" && typeof block["data"] === "string" && typeof block["mimeType"] === "string") {
        return {type: "image", data: block["data"], mimeType: block["mimeType"]};
    }
    if (block["type"] === "resource_link" && typeof block["uri"] === "string" && typeof block["name"] === "string") {
        return {type: "resource_link", uri: block["uri"], name: block["name"]};
    }
    return null;
}
