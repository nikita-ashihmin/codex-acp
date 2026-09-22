import type * as acp from "@agentclientprotocol/sdk";
import type {
    AdditionalPermissionProfile,
    CommandAction,
    CommandExecutionRequestApprovalParams,
    FileChangeRequestApprovalParams,
    RequestPermissionProfile,
    ThreadItem,
} from "../app-server/v2";
import {stripShellPrefix} from "../CommandUtils";
import type {PermissionPromptContext} from "./lifecycle";

type FileChangeItem = ThreadItem & {type: "fileChange"};
type CommandPresentationParams = CommandExecutionRequestApprovalParams & {
    additionalPermissions?: AdditionalPermissionProfile | null;
};

/**
 * A permission request carries a `ToolCallUpdate`, and the client merges it into the stored tool call.
 * When the client already received the tool call, the update does not reset the status to `pending`.
 * It also keeps the reported title, kind and raw input, unless the request adds data for the decision.
 */
export function commandToolCall(
    params: CommandPresentationParams,
    permissionContext: PermissionPromptContext,
): acp.ToolCallUpdate {
    const name = permissionContext.commandName(params.threadId, params.itemId);
    const started = permissionContext.commandStarted(params.threadId, params.itemId);
    const network = params.networkApprovalContext;
    const networkUrl = network?.protocol === "http" || network?.protocol === "https"
        ? `${network.protocol}://${network.host}`
        : undefined;
    const rawInput = {
        ...(params.command ? {command: stripShellPrefix(params.command)} : {}),
        ...(params.cwd ? {cwd: params.cwd} : {}),
        ...(networkUrl ? {url: networkUrl} : {}),
        ...(params.additionalPermissions ? {additionalPermissions: params.additionalPermissions} : {}),
    };
    const rawInputAddsDecisionData = networkUrl !== undefined || params.additionalPermissions != null;
    const additionalPermissionContent = params.additionalPermissions
        ? permissionProfileContent(params.additionalPermissions)
        : [];
    return {
        toolCallId: params.itemId,
        ...(name !== undefined ? {name} : {}),
        ...(started ? {} : {kind: "execute", status: "pending"}),
        ...(network
            ? {title: `${network.protocol} network access to ${network.host}`}
            : started ? {} : {title: commandTitle(params.commandActions)}),
        ...(Object.keys(rawInput).length > 0 && (!started || rawInputAddsDecisionData) ? {rawInput} : {}),
        ...locationsField(unique([
            ...commandActionPaths(params.commandActions),
            ...permissionProfilePaths(params.additionalPermissions),
        ])),
        ...(network
            ? {content: [textContent(`${network.protocol} access to ${network.host}`), ...additionalPermissionContent]}
            : additionalPermissionContent.length > 0
                ? {content: additionalPermissionContent}
                : {}),
    };
}

/** See `commandToolCall` for the fields that a started tool call keeps. */
export function fileChangeToolCall(
    params: FileChangeRequestApprovalParams,
    permissionContext: PermissionPromptContext,
): acp.ToolCallUpdate {
    const item = permissionContext.fileChange(params.threadId, params.itemId);
    return {
        toolCallId: params.itemId,
        ...(item === undefined ? {kind: "edit", status: "pending", title: "Edit files"} : {}),
        ...locationsField(fileChangePaths(item)),
    };
}

export function additionalPermissionsToolCall(
    itemId: string,
    cwd: string,
    environmentId: string | null,
    permissions: RequestPermissionProfile,
): acp.ToolCallUpdate {
    const content = permissionProfileContent(permissions);
    return {
        toolCallId: itemId,
        name: "request_permissions",
        kind: "other",
        status: "pending",
        title: "Additional sandbox permissions",
        rawInput: {permissions, cwd, environmentId},
        ...locationsField(permissionProfilePaths(permissions)),
        ...(content.length > 0 ? {content} : {}),
    };
}

function commandTitle(actions?: CommandAction[] | null): string {
    const first = actions?.[0];
    if (!first) return "Run command";
    switch (first.type) {
        case "read":
            return actions?.length === 1 ? "Read file" : "Run command with file reads";
        case "listFiles":
            return "List files";
        case "search":
            return "Search files";
        case "unknown":
            return "Run command";
    }
}

function commandActionPaths(actions?: CommandAction[] | null): string[] {
    return unique((actions ?? []).flatMap(action => {
        switch (action.type) {
            case "read":
                return [action.path];
            case "listFiles":
            case "search":
                return action.path ? [action.path] : [];
            case "unknown":
                return [];
        }
    }));
}

function fileChangePaths(item?: FileChangeItem): string[] {
    return unique(item?.changes.map(change => change.path) ?? []);
}

function permissionProfilePaths(permissions?: RequestPermissionProfile | AdditionalPermissionProfile | null): string[] {
    const fileSystem = permissions?.fileSystem;
    return unique([
        ...(fileSystem?.read ?? []),
        ...(fileSystem?.write ?? []),
        ...(fileSystem?.entries ?? []).flatMap(entry => entry.path.type === "path" ? [entry.path.path] : []),
    ]);
}

function permissionProfileContent(
    permissions: RequestPermissionProfile | AdditionalPermissionProfile,
): acp.ToolCallContent[] {
    const lines: string[] = [];
    const networkEnabled = permissions.network?.enabled;
    if (networkEnabled !== null && networkEnabled !== undefined) {
        lines.push(networkEnabled ? "Enable network access" : "Disable network access");
    }
    for (const entry of permissions.fileSystem?.entries ?? []) {
        switch (entry.path.type) {
            case "glob_pattern":
                lines.push(`${entry.access} filesystem pattern ${entry.path.pattern}`);
                break;
            case "special":
                lines.push(`${entry.access} Codex filesystem scope ${JSON.stringify(entry.path.value)}`);
                break;
            case "path":
                break;
        }
    }
    return lines.length > 0 ? [textContent(lines.join("\n"))] : [];
}

function locationsField(paths: string[]): Pick<acp.ToolCallUpdate, "locations"> | object {
    return paths.length > 0 ? {locations: paths.map(path => ({path}))} : {};
}

function textContent(text: string): acp.ToolCallContent {
    return {type: "content", content: {type: "text", text}};
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}
