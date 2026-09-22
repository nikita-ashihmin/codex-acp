import { describe, expect, it } from "vitest";
import { resolveCommandOutputChannel, resolveTerminalOutputMode } from "../TerminalOutputMode";

describe("resolveTerminalOutputMode", () => {
    it("prefers terminal_output_delta when both modes are advertised", () => {
        expect(resolveTerminalOutputMode({
            _meta: {
                terminal_output: true,
                terminal_output_delta: true,
            },
        })).toBe("terminal_output_delta");
    });

    it("uses legacy terminal_output_delta when only it is advertised", () => {
        expect(resolveTerminalOutputMode({
            _meta: {
                terminal_output_delta: true,
            },
        })).toBe("terminal_output_delta");
    });

    it("uses terminal_output when it is the only advertised mode", () => {
        expect(resolveTerminalOutputMode({
            _meta: {
                terminal_output: true,
            },
        })).toBe("terminal_output");
    });

    it("keeps legacy terminal_output_delta when capabilities are absent", () => {
        expect(resolveTerminalOutputMode(null)).toBe("terminal_output_delta");
        expect(resolveTerminalOutputMode({})).toBe("terminal_output_delta");
    });
});

describe("resolveCommandOutputChannel", () => {
    it("uses the terminal channel for a client that advertises terminal metadata", () => {
        expect(resolveCommandOutputChannel({ _meta: { terminal_output_delta: true } })).toBe("terminal");
        expect(resolveCommandOutputChannel({ _meta: { terminal_output: true } })).toBe("terminal");
    });

    it("uses the terminal channel with output deltas for AIR", () => {
        const capabilities = { _meta: { jetbrains: { air: { version: 1, capabilities: [] } } } };
        expect(resolveCommandOutputChannel(capabilities)).toBe("terminal");
        expect(resolveTerminalOutputMode({ _meta: { ...capabilities._meta, terminal_output: true } }))
            .toBe("terminal_output_delta");
    });

    it("uses the raw output channel for a client without terminal metadata", () => {
        expect(resolveCommandOutputChannel(null)).toBe("rawOutput");
        expect(resolveCommandOutputChannel({})).toBe("rawOutput");
    });
});
