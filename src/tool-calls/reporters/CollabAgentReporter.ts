import type {ThreadItem} from "../../app-server/v2";
import type {ToolFacts} from "../ToolFacts";
import {toToolStatus} from "./ToolStatus";

type CollabAgentToolCallItem = ThreadItem & {type: "collabAgentToolCall"};

/**
 * Reports a Codex collaboration tool call, for a client without native subagent sessions.
 * The prompt is input that the user reads. The agent states are a result without a display form.
 */
export class CollabAgentReporter {
    static started(item: CollabAgentToolCallItem): ToolFacts {
        return {
            ...facts(item, "start"),
            kind: "other",
            ...(item.prompt ? {readableInput: item.prompt} : {}),
        };
    }

    static completed(item: CollabAgentToolCallItem): ToolFacts {
        return facts(item, "update");
    }
}

function facts(item: CollabAgentToolCallItem, report: ToolFacts["report"]): ToolFacts {
    return {
        toolCallId: item.id,
        report,
        title: item.tool,
        status: toToolStatus(item.status),
        input: {
            prompt: item.prompt,
            senderThreadId: item.senderThreadId,
            receiverThreadIds: item.receiverThreadIds,
            model: item.model,
            reasoningEffort: item.reasoningEffort,
        },
        ...(Object.keys(item.agentsStates).length > 0 ? {opaqueResult: {agentsStates: item.agentsStates}} : {}),
        subagent: true,
    };
}
