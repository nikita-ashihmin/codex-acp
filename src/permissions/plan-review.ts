import type * as acp from "@agentclientprotocol/sdk";
import type {CompletedPlan} from "../CodexEventHandler";
import {AIR_PLAN_REVIEW_KEY, withAirMeta} from "../AirExtension";

const IMPLEMENT_PLAN_OPTION_ID = "implement_plan";
const REVISE_PLAN_OPTION_ID = "revise_plan";

export function planImplementationPermissionRequest(
    sessionId: string,
    plan: CompletedPlan,
): acp.RequestPermissionRequest {
    return {
        sessionId,
        toolCall: {
            toolCallId: planImplementationToolCallId(plan),
            title: "Implement this plan?",
            kind: "switch_mode",
            status: "pending",
            rawInput: {plan: plan.text},
        },
        options: [
            {optionId: IMPLEMENT_PLAN_OPTION_ID, name: "Yes, implement this plan", kind: "allow_once"},
            {
                optionId: REVISE_PLAN_OPTION_ID,
                name: "No, and tell Codex what to do differently",
                kind: "reject_once",
            },
        ],
        _meta: withAirMeta(undefined, AIR_PLAN_REVIEW_KEY, {planItemId: plan.itemId}),
    };
}

export function planImplementationApproved(response: acp.RequestPermissionResponse): boolean {
    return response.outcome.outcome === "selected" && response.outcome.optionId === IMPLEMENT_PLAN_OPTION_ID;
}

export function planImplementationToolCallId(plan: CompletedPlan): string {
    return `plan-review:${plan.itemId}`;
}
