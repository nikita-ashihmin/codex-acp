import type * as acp from "@agentclientprotocol/sdk";
import {AIR_PLAN_REVIEW_KEY, withAirMeta} from "../../AirExtension";
import type {CompletedPlan} from "../../CodexEventHandler";
import type {AcpToolCallRenderer} from "../AcpToolCallRenderer";
import type {ToolFacts} from "../ToolFacts";

const IMPLEMENT_PLAN_OPTION_ID = "implement_plan";
const REVISE_PLAN_OPTION_ID = "revise_plan";

/**
 * Reports the approval of a completed Codex plan.
 * The client already received the plan, so the request names the plan item and does not repeat the text.
 */
export class PlanReviewReporter {
    static permissionRequest(
        sessionId: string,
        plan: CompletedPlan,
        renderer: AcpToolCallRenderer,
    ): acp.RequestPermissionRequest {
        return {
            sessionId,
            toolCall: renderer.renderPermissionToolCall({
                toolCallId: planReviewToolCallId(plan),
                title: "Implement this plan?",
                kind: "switch_mode",
                status: "pending",
            }),
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

    static approved(response: acp.RequestPermissionResponse): boolean {
        return response.outcome.outcome === "selected" && response.outcome.optionId === IMPLEMENT_PLAN_OPTION_ID;
    }

    static decided(plan: CompletedPlan, approved: boolean): ToolFacts {
        return {
            toolCallId: planReviewToolCallId(plan),
            report: "update",
            status: "completed",
            opaqueResult: approved ? "User approved the plan." : "User kept the session in plan mode.",
        };
    }
}

export function planReviewToolCallId(plan: CompletedPlan): string {
    return `plan-review:${plan.itemId}`;
}
