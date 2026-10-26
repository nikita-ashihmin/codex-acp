import {afterEach, describe, expect, it, vi} from "vitest";
import type {Thread, ThreadReadParams, ThreadReadResponse} from "../app-server/v2";
import {SessionForkOrigins} from "../SessionForkOrigins";

const PARENT = "01a0f400-0000-7000-8000-000000000001";

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
    return {id, path: `/codex-home/sessions/rollout-${id}.jsonl`, updatedAt: 100, forkedFromId: null, ...overrides} as Thread;
}

/** An app-server whose `thread/read` answers the fork parents given, and fails for the other threads. */
function codex(parents: Record<string, string | null | Error>) {
    const threadRead = vi.fn(async ({threadId}: ThreadReadParams): Promise<ThreadReadResponse> => {
        const parent = parents[threadId];
        if (parent instanceof Error) throw parent;
        if (parent === undefined) throw Object.assign(new Error(`thread not found: ${threadId}`), {code: -32600});
        return {thread: thread(threadId, {forkedFromId: parent})} as ThreadReadResponse;
    });
    return {threadRead};
}

const notMaterialized = (id: string) => Object.assign(new Error(`thread ${id} is not materialized yet`), {code: -32600});

async function settled(origins: SessionForkOrigins): Promise<void> {
    await vi.waitFor(() => expect(origins.busy()).toBe(false));
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("SessionForkOrigins", () => {
    it("reads a fork in the background with thread/read, reports it once and reads each thread once", async () => {
        const reader = codex({fork: PARENT, plain: null});
        const onFound = vi.fn();
        const origins = new SessionForkOrigins({reader: () => reader, onFound});

        // Off the critical path: nothing is known and nothing is read before the call returns.
        expect(origins.originOf(thread("fork"))).toBe(null);
        expect(origins.originOf(thread("plain"))).toBe(null);
        expect(reader.threadRead).not.toHaveBeenCalled();
        await settled(origins);

        expect(reader.threadRead.mock.calls).toEqual([
            [{threadId: "fork", includeTurns: false}],
            [{threadId: "plain", includeTurns: false}],
        ]);
        expect(onFound).toHaveBeenCalledExactlyOnceWith(["fork"]);
        // Cached for the thread's lifetime, a fork or not, also when the thread changes.
        expect(origins.originOf(thread("fork", {updatedAt: 200}))).toBe(PARENT);
        expect(origins.originOf(thread("plain", {updatedAt: 200}))).toBe(null);
        await settled(origins);
        expect(reader.threadRead).toHaveBeenCalledTimes(2);
        expect(onFound).toHaveBeenCalledTimes(1);
        origins.dispose();
    });

    it("reads at most 8 threads at a time", async () => {
        let running = 0;
        let most = 0;
        const threadRead = vi.fn(async ({threadId}: ThreadReadParams) => {
            most = Math.max(most, ++running);
            await new Promise(resolve => setTimeout(resolve, 1));
            running--;
            return {thread: thread(threadId)} as ThreadReadResponse;
        });
        const origins = new SessionForkOrigins({reader: () => ({threadRead}), onFound: vi.fn()});

        for (let index = 0; index < 20; index++) origins.originOf(thread(`thread-${index}`));
        await settled(origins);

        expect(threadRead).toHaveBeenCalledTimes(20);
        expect(most).toBe(8);
        origins.dispose();
    });

    it("reads a thread listed again during its read once", async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>(resolve => { release = resolve; });
        const threadRead = vi.fn(async ({threadId}: ThreadReadParams) => {
            await gate;
            return {thread: thread(threadId, {forkedFromId: PARENT})} as ThreadReadResponse;
        });
        const onFound = vi.fn();
        const origins = new SessionForkOrigins({reader: () => ({threadRead}), onFound});

        origins.originOf(thread("fork"));
        await vi.waitFor(() => expect(threadRead).toHaveBeenCalledTimes(1));
        // Listed again while the read runs, and archived: the rollout moves.
        origins.originOf(thread("fork", {updatedAt: 200}));
        origins.originOf(thread("fork", {updatedAt: 300, path: "/codex-home/archived_sessions/rollout-fork.jsonl"}));
        release();
        await settled(origins);

        expect(threadRead).toHaveBeenCalledTimes(1);
        expect(onFound).toHaveBeenCalledExactlyOnceWith(["fork"]);
        expect(origins.originOf(thread("fork", {updatedAt: 400}))).toBe(PARENT);
        origins.dispose();
    });

    it("reads a thread that Codex could not read yet again only once the thread changed", async () => {
        const parents: Record<string, string | null | Error> = {fresh: notMaterialized("fresh")};
        const reader = codex(parents);
        const onFound = vi.fn();
        const origins = new SessionForkOrigins({reader: () => reader, onFound});

        origins.originOf(thread("fresh"));
        origins.originOf(thread("unknown"));
        await settled(origins);
        origins.originOf(thread("fresh"));
        origins.originOf(thread("unknown"));
        await settled(origins);
        expect(reader.threadRead).toHaveBeenCalledTimes(2);

        parents["fresh"] = PARENT;
        origins.originOf(thread("fresh", {updatedAt: 101}));
        await settled(origins);
        expect(reader.threadRead).toHaveBeenCalledTimes(3);
        expect(onFound).toHaveBeenCalledExactlyOnceWith(["fresh"]);
        expect(origins.originOf(thread("fresh", {updatedAt: 101}))).toBe(PARENT);
        origins.dispose();
    });

    it("reads a thread again that changed while a read could not read it yet", async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>(resolve => { release = resolve; });
        const threadRead = vi.fn(async ({threadId}: ThreadReadParams) => {
            if (threadRead.mock.calls.length === 1) {
                await gate;
                throw notMaterialized(threadId);
            }
            return {thread: thread(threadId, {forkedFromId: PARENT})} as ThreadReadResponse;
        });
        const onFound = vi.fn();
        const origins = new SessionForkOrigins({reader: () => ({threadRead}), onFound});

        origins.originOf(thread("fork"));
        await vi.waitFor(() => expect(threadRead).toHaveBeenCalledTimes(1));
        origins.originOf(thread("fork", {updatedAt: 101}));
        release();
        await settled(origins);

        expect(threadRead).toHaveBeenCalledTimes(2);
        expect(onFound).toHaveBeenCalledExactlyOnceWith(["fork"]);
        expect(origins.originOf(thread("fork", {updatedAt: 101}))).toBe(PARENT);
        origins.dispose();
    });

    it("reads a thread again when it is listed next after a failed read or without an app-server", async () => {
        const parents: Record<string, string | null | Error> = {fork: new Error("connection reset")};
        const reader = codex(parents);
        let running = false;
        const onFound = vi.fn();
        const origins = new SessionForkOrigins({reader: () => running ? reader : null, onFound});

        origins.originOf(thread("fork"));
        await settled(origins);
        expect(reader.threadRead).not.toHaveBeenCalled();

        running = true;
        origins.originOf(thread("fork"));
        await settled(origins);
        expect(reader.threadRead).toHaveBeenCalledTimes(1);

        parents["fork"] = PARENT;
        origins.originOf(thread("fork"));
        await settled(origins);
        expect(reader.threadRead).toHaveBeenCalledTimes(2);
        expect(onFound).toHaveBeenCalledExactlyOnceWith(["fork"]);
        origins.dispose();
    });

    it("reads nothing for a thread whose forkedFromId Codex gives, for one without a rollout, and for a remembered fork", async () => {
        const reader = codex({});
        const origins = new SessionForkOrigins({reader: () => reader, onFound: vi.fn()});

        expect(origins.originOf(thread("fork", {forkedFromId: "from-codex"}))).toBe("from-codex");
        expect(origins.originOf(thread("none", {path: null}))).toBe(null);
        origins.remember("own", PARENT);
        expect(origins.originOf(thread("own"))).toBe(PARENT);
        await settled(origins);

        expect(reader.threadRead).not.toHaveBeenCalled();
        origins.dispose();
    });

    it("takes the answer of a thread/read made elsewhere, and keeps an answer it has", async () => {
        const reader = codex({});
        const origins = new SessionForkOrigins({reader: () => reader, onFound: vi.fn()});

        origins.readElsewhere(thread("fork", {forkedFromId: PARENT}));
        origins.readElsewhere(thread("plain"));
        origins.remember("own", PARENT);
        origins.readElsewhere(thread("own"));
        // A read already scheduled is dropped.
        origins.originOf(thread("late"));
        origins.readElsewhere(thread("late", {forkedFromId: PARENT}));
        await settled(origins);

        expect(reader.threadRead).not.toHaveBeenCalled();
        expect(["fork", "plain", "own", "late"].map(id => origins.originOf(thread(id)))).toEqual([PARENT, null, PARENT, PARENT]);
        origins.dispose();
    });
});
