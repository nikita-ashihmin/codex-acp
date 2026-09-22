import type * as acp from "@agentclientprotocol/sdk";
import {AIR_DIFF_PATCH_KEY, clientSupportsAirCapability} from "../AirExtension";

export const AIR_RAW_INPUT_RENDERING_KEY = "rawInputRendering";
export const AIR_PLAN_CONTENT_DELTA_KEY = "planContentDelta";

/** The AIR capabilities that change the tool call and plan reports. */
export type AirCapabilities = {
    /** AIR renders `rawInput` itself, so the adapter sends no display copy of the input in `content`. */
    readonly rawInputRendering: boolean;
    /** AIR appends `plan_update._meta.jetbrains.air.contentDelta` to the plan content. */
    readonly planContentDelta: boolean;
    /** AIR reads a file change as a Git patch, see `docs/diff-patch-extension.md`. */
    readonly diffPatch: boolean;
};

/**
 * The client capabilities that decide how the adapter reports tool calls and plans.
 * The adapter reads them once in `initialize`. See `docs/acp-tool-call-contract.md`.
 */
export class ClientCapabilities {
    static readonly DEFAULT = new ClientCapabilities(false, false, {
        rawInputRendering: false,
        planContentDelta: false,
        diffPatch: false,
    });

    constructor(
        /** The client appends `_meta.terminal_output_delta`. Other clients get `_meta.terminal_output` chunks. */
        readonly terminalOutputDelta: boolean,
        /** The client shows `plan_update`. Other clients get the plan as agent message text. */
        readonly planUpdates: boolean,
        readonly air: AirCapabilities,
    ) {}

    static from(capabilities: acp.ClientCapabilities | null | undefined): ClientCapabilities {
        return new ClientCapabilities(
            capabilities?._meta?.["terminal_output_delta"] === true,
            capabilities?.plan != null,
            {
                rawInputRendering: clientSupportsAirCapability(capabilities, AIR_RAW_INPUT_RENDERING_KEY),
                planContentDelta: clientSupportsAirCapability(capabilities, AIR_PLAN_CONTENT_DELTA_KEY),
                diffPatch: clientSupportsAirCapability(capabilities, AIR_DIFF_PATCH_KEY),
            },
        );
    }

    with(changes: {
        terminalOutputDelta?: boolean;
        planUpdates?: boolean;
        air?: Partial<AirCapabilities>;
    }): ClientCapabilities {
        return new ClientCapabilities(
            changes.terminalOutputDelta ?? this.terminalOutputDelta,
            changes.planUpdates ?? this.planUpdates,
            {...this.air, ...changes.air},
        );
    }
}
