import {AIR_CONTEXT_COMPACTION_KEY, withAirMeta} from "./AirExtension";

export const CONTEXT_COMPACTION_META_VERSION = 1;

export type ContextCompactionTrigger = "manual" | "automatic";

export interface ContextCompactionMetadata {
    version: typeof CONTEXT_COMPACTION_META_VERSION;
    trigger?: ContextCompactionTrigger;
    preTokens?: number;
    postTokens?: number;
    durationMs?: number;
    error?: string;
}

/**
 * AIR metadata for a synthetic ACP context-compaction tool call, in `_meta.jetbrains.air.contextCompaction`.
 * The standard toolCallId and status fields own lifecycle identity and phase;
 * this extension carries only compaction-specific facts.
 */
export function createContextCompactionMeta(
    metadata: Omit<ContextCompactionMetadata, "version"> = {},
): Record<string, unknown> {
    const compaction: ContextCompactionMetadata = {
        version: CONTEXT_COMPACTION_META_VERSION,
        ...metadata,
    };
    return withAirMeta(undefined, AIR_CONTEXT_COMPACTION_KEY, compaction);
}
