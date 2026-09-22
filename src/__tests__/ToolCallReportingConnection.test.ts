import * as acp from "@agentclientprotocol/sdk";
import {describe, expect, it, vi} from "vitest";
import type {AcpClientConnection} from "../ACPSessionConnection";
import {ToolCallReportingConnection} from "../ToolCallReportingConnection";

function createClient() {
    const notify = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({outcome: {outcome: "cancelled"}});
    const client = {notify, request} as unknown as AcpClientConnection;
    return {client, notify, request};
}

describe("ToolCallReportingConnection", () => {
    it("sends only the changed fields of a tool call update from any emission site", async () => {
        const {client, notify} = createClient();
        const connection = new ToolCallReportingConnection(client).asClientConnection();
        await connection.notify(acp.methods.client.session.update, {
            sessionId: "s",
            update: {sessionUpdate: "tool_call", toolCallId: "t", title: "Guardian Review", status: "in_progress"},
        });
        await connection.notify(acp.methods.client.session.update, {
            sessionId: "s",
            update: {sessionUpdate: "tool_call_update", toolCallId: "t", title: "Guardian Review", status: "completed"},
        });

        expect(notify.mock.calls[1]).toEqual([acp.methods.client.session.update, {
            sessionId: "s",
            update: {sessionUpdate: "tool_call_update", toolCallId: "t", status: "completed"},
        }]);
    });

    it("drops an update that repeats every reported field", async () => {
        const {client, notify} = createClient();
        const connection = new ToolCallReportingConnection(client).asClientConnection();
        const update = {sessionUpdate: "tool_call", toolCallId: "t", title: "Search", status: "in_progress"} as const;
        await connection.notify(acp.methods.client.session.update, {sessionId: "s", update});
        await connection.notify(acp.methods.client.session.update, {
            sessionId: "s",
            update: {...update, sessionUpdate: "tool_call_update"},
        });

        expect(notify).toHaveBeenCalledTimes(1);
    });

    it("counts the permission request tool call as a report", async () => {
        const {client, notify} = createClient();
        const connection = new ToolCallReportingConnection(client).asClientConnection();
        await connection.notify(acp.methods.client.session.update, {
            sessionId: "s",
            update: {sessionUpdate: "tool_call", toolCallId: "t", title: "mcp.server.tool", status: "in_progress"},
        });
        await connection.request(acp.methods.client.session.requestPermission, {
            sessionId: "s",
            toolCall: {toolCallId: "t", status: "pending"},
            options: [],
        });
        await connection.notify(acp.methods.client.session.update, {
            sessionId: "s",
            update: {sessionUpdate: "tool_call_update", toolCallId: "t", status: "in_progress"},
        });

        expect(notify.mock.calls[1]![1]).toEqual({
            sessionId: "s",
            update: {sessionUpdate: "tool_call_update", toolCallId: "t", status: "in_progress"},
        });
    });
});
