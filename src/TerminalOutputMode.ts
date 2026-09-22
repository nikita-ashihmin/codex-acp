import type * as acp from "@agentclientprotocol/sdk";
import {isAirClient} from "./AirExtension";

export type TerminalOutputMode = "terminal_output" | "terminal_output_delta";

/**
 * The one channel that carries the output of a shell command to the client.
 *
 * - `terminal`: the terminal metadata carries the output chunks and the exit status.
 * - `rawOutput`: the final `rawOutput` carries the whole output and the exit code.
 */
export type CommandOutputChannel = "terminal" | "rawOutput";

/** A client that advertises terminal metadata, and AIR, read the terminal channel. */
export function resolveCommandOutputChannel(
    clientCapabilities?: acp.ClientCapabilities | null
): CommandOutputChannel {
    const meta = clientCapabilities?._meta;
    return isAirClient(clientCapabilities)
        || meta?.["terminal_output_delta"] === true
        || meta?.["terminal_output"] === true
        ? "terminal"
        : "rawOutput";
}

export function resolveTerminalOutputMode(
    clientCapabilities?: acp.ClientCapabilities | null
): TerminalOutputMode {
    if (isAirClient(clientCapabilities)) {
        return "terminal_output_delta";
    }
    const meta = clientCapabilities?._meta;
    if (meta?.["terminal_output_delta"] === true) {
        return "terminal_output_delta";
    }
    if (meta?.["terminal_output"] === true) {
        return "terminal_output";
    }
    return "terminal_output_delta";
}

export function createTerminalOutputMeta(
    mode: TerminalOutputMode,
    terminalId: string,
    data: string
): Record<string, unknown> {
    switch (mode) {
        case "terminal_output":
            return {
                terminal_output: {
                    data,
                    terminal_id: terminalId,
                },
            };
        case "terminal_output_delta":
            return {
                terminal_output_delta: {
                    data,
                    terminal_id: terminalId,
                },
            };
    }
}
