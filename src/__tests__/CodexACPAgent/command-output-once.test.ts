import {describe, expect, it} from "vitest";
import type {ServerNotification} from "../../app-server";
import type {ThreadItem} from "../../app-server/v2";
import {CodexEventHandler} from "../../CodexEventHandler";
import {createCommandExecutionCompleteUpdate} from "../../CodexToolCallMapper";
import {parseResponseItemHistoryFallback} from "../../ResponseItemHistoryFallback";
import {createCodexMockTestFixture, createTestSessionState, setupPromptAndSendNotifications} from "../acp-test-utils";

type CommandItem = ThreadItem & {type: "commandExecution"};

function command(overrides: Partial<CommandItem> = {}): CommandItem {
    return {
        type: "commandExecution",
        id: "cmd-1",
        pluginId: null,
        scriptPath: null,
        command: "ls",
        cwd: "/workspace",
        processId: null,
        source: "agent",
        status: "completed",
        commandActions: [],
        aggregatedOutput: "a.txt\nb.txt\n",
        exitCode: 0,
        durationMs: 1,
        ...overrides,
    };
}

function occurrences(value: unknown, text: string): number {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return serialized.split(JSON.stringify(text).slice(1, -1)).length - 1;
}

describe("command output is sent once", () => {
    it("replays the output only in the terminal metadata for a terminal channel client", () => {
        const update = createCommandExecutionCompleteUpdate(command(), {
            terminalOutputMode: "terminal_output_delta",
            channel: "terminal",
            hasTerminal: true,
            outputStreamed: false,
        });

        expect(update).toEqual({
            sessionUpdate: "tool_call_update",
            toolCallId: "cmd-1",
            status: "completed",
            _meta: {
                terminal_output_delta: {data: "a.txt\nb.txt\n", terminal_id: "cmd-1"},
                terminal_exit: {exit_code: 0, signal: null, terminal_id: "cmd-1"},
            },
        });
    });

    it("sends the output and the exit code only in the raw output for a client without terminal metadata", () => {
        const update = createCommandExecutionCompleteUpdate(command(), {
            terminalOutputMode: "terminal_output_delta",
            channel: "rawOutput",
            hasTerminal: true,
            outputStreamed: false,
        });

        expect(update).toEqual({
            sessionUpdate: "tool_call_update",
            toolCallId: "cmd-1",
            status: "completed",
            rawOutput: {formatted_output: "a.txt\nb.txt\n", exit_code: 0},
        });
    });

    it("sends the output of a read command once in the content", () => {
        for (const channel of ["terminal", "rawOutput"] as const) {
            const update = createCommandExecutionCompleteUpdate(command({
                commandActions: [{type: "read", command: "cat a.txt", name: "a.txt", path: "/workspace/a.txt"}],
            }), {
                terminalOutputMode: "terminal_output_delta",
                channel,
                hasTerminal: false,
                outputStreamed: false,
            });

            expect(update).toEqual({
                sessionUpdate: "tool_call_update",
                toolCallId: "cmd-1",
                status: "completed",
                content: [{type: "content", content: {type: "text", text: "a.txt\nb.txt\n"}}],
            });
        }
    });

    it("sends the live output only as streamed deltas to a terminal channel client", async () => {
        const fixture = createCodexMockTestFixture();
        const sessionId = "command-once";
        await setupPromptAndSendNotifications(
            fixture,
            sessionId,
            createTestSessionState({sessionId, commandOutputChannel: "terminal"}),
            liveCommand(sessionId),
        );

        const dump = fixture.getAcpConnectionDump([]);
        expect(occurrences(dump, "a.txt\nb.txt\n")).toBe(1);
        expect(dump).toContain("terminal_output_delta");
        expect(dump).not.toContain("formatted_output");
    });

    it("sends the live output only in the final raw output to a client without terminal metadata", async () => {
        const fixture = createCodexMockTestFixture();
        const sessionId = "command-once-raw";
        await setupPromptAndSendNotifications(
            fixture,
            sessionId,
            createTestSessionState({sessionId, commandOutputChannel: "rawOutput"}),
            liveCommand(sessionId),
        );

        const dump = fixture.getAcpConnectionDump([]);
        expect(occurrences(dump, "a.txt\nb.txt\n")).toBe(1);
        expect(dump).not.toContain("terminal_output_delta");
        expect(dump).not.toContain("terminal_exit");
    });

    it("sends the streamed output of a read command once in the content", async () => {
        const fixture = createCodexMockTestFixture();
        const sessionId = "read-once";
        const read = {commandActions: [{type: "read" as const, command: "cat a.txt", name: "a.txt", path: "/workspace/a.txt"}]};
        await setupPromptAndSendNotifications(
            fixture,
            sessionId,
            createTestSessionState({sessionId, commandOutputChannel: "terminal"}),
            liveCommand(sessionId, read),
        );

        const dump = fixture.getAcpConnectionDump([]);
        expect(occurrences(dump, "a.txt\nb.txt\n")).toBe(1);
        expect(dump).not.toContain("terminal_output_delta");
        expect(dump).not.toContain("formatted_output");
        expect(dump).toContain("\"content\"");
    });

    it("replays fallback history output in one channel", () => {
        const jsonl = [
            {type: "response_item", payload: {type: "function_call", name: "exec_command", call_id: "call-1", arguments: JSON.stringify({cmd: "npm test", workdir: "/workspace", yield_time_ms: 1000})}},
            {type: "response_item", payload: {type: "function_call_output", call_id: "call-1", output: "Process exited with code 0\nOutput:\nfallback-output\n"}},
        ].map(line => JSON.stringify(line)).join("\n");

        const terminalUpdates = parseResponseItemHistoryFallback(jsonl, "terminal_output_delta", new Set(), "terminal");
        const rawUpdates = parseResponseItemHistoryFallback(jsonl, "terminal_output_delta", new Set(), "rawOutput");

        const terminalOutput = terminalUpdates?.find(update => update.sessionUpdate === "tool_call_update");
        expect(terminalOutput).not.toHaveProperty("rawOutput");
        expect(occurrences(terminalOutput, "fallback-output")).toBe(1);
        const rawOutput = rawUpdates?.find(update => update.sessionUpdate === "tool_call_update");
        expect(rawOutput).toHaveProperty("rawOutput.formatted_output");
        expect(rawOutput).not.toHaveProperty("_meta");
    });
});

function liveCommand(sessionId: string, overrides: Partial<CommandItem> = {}): ServerNotification[] {
    return [
        {
            method: "item/started",
            params: {threadId: sessionId, turnId: "turn-1", startedAtMs: 0, item: command({status: "inProgress", aggregatedOutput: null, exitCode: null, ...overrides})},
        },
        {
            method: "item/commandExecution/outputDelta",
            params: {threadId: sessionId, turnId: "turn-1", itemId: "cmd-1", delta: "a.txt\nb.txt\n"},
        },
        {
            method: "item/completed",
            params: {threadId: sessionId, turnId: "turn-1", completedAtMs: 1, item: command(overrides)},
        },
    ];
}

describe("late output deltas", () => {
    it("drops command and MCP output that arrives after completion", async () => {
        const fixture = createCodexMockTestFixture();
        const sessionId = "late-output";
        const notifications: ServerNotification[] = [
            {
                method: "item/started",
                params: {threadId: sessionId, turnId: "turn-1", startedAtMs: 0, item: command({status: "inProgress", aggregatedOutput: null, exitCode: null})},
            },
            {
                method: "item/completed",
                params: {threadId: sessionId, turnId: "turn-1", completedAtMs: 1, item: command()},
            },
            {
                method: "item/commandExecution/outputDelta",
                params: {threadId: sessionId, turnId: "turn-1", itemId: "cmd-1", delta: "late-command-output"},
            },
            {
                method: "item/mcpToolCall/progress",
                params: {threadId: sessionId, turnId: "turn-1", itemId: "cmd-1", message: "late-mcp-output"},
            },
        ];

        await setupPromptAndSendNotifications(fixture, sessionId, createTestSessionState({sessionId}), notifications);

        const dump = fixture.getAcpConnectionDump([]);
        expect(dump).not.toContain("late-command-output");
        expect(dump).not.toContain("late-mcp-output");
    });
});

describe("MCP startup tool call ids", () => {
    it("gives each startup report a unique tool call id", () => {
        const event = {ready: [], failed: [{server: "broken", error: "boom", failureReason: null}], cancelled: ["slow"]};
        const first = CodexEventHandler.createMcpStartupUpdates(event as never);
        const second = CodexEventHandler.createMcpStartupUpdates(event as never);
        const ids = [...first, ...second].map(update => update.sessionUpdate === "tool_call" ? update.toolCallId : "");

        expect(new Set(ids).size).toBe(4);
        expect(ids[0]).toMatch(/^mcp_startup\.broken\./);
        expect(ids[1]).toMatch(/^mcp_startup\.slow\./);
    });
});
