/**
 * The thread that a Codex thread was forked from, for the `forkedFrom` field of its session list row.
 *
 * `thread/list` answers `forkedFromId: null` for every thread; `thread/read` without turns gives the fork parent.
 * The fork parent never changes, so the answer is cached for the thread's lifetime, a fork or not. A list never
 * waits for the read: the threads are read in the background, and a fork found there is reported, see
 * {@link SessionForkOriginsDeps.onFound}.
 */

import type {Thread, ThreadReadParams, ThreadReadResponse} from "./app-server/v2";
import {isThreadNotMaterializedError} from "./CodexThreadErrors";
import {logger} from "./Logger";
import {isMissingThreadError} from "./SessionIndexMutations";

/** The app-server request that the fork origins need. */
export interface SessionForkOriginsReader {
    threadRead(params: ThreadReadParams): Promise<ThreadReadResponse>;
}

export interface SessionForkOriginsDeps {
    /** The app-server to read from, or `null` when none runs: then nothing is read. */
    reader(): SessionForkOriginsReader | null;
    /** These threads turned out to be forks: their rows get `forkedFrom` now. */
    onFound(threadIds: string[]): void;
}

/** The most threads whose answer is kept. An entry is a thread id and a parent id. */
const MAX_CACHED = 16_384;
/** The most `thread/read` requests at a time. */
const READ_CONCURRENCY = 8;

/** A thread that Codex could not read yet, as one not written yet: read again once the thread changes. */
interface Unknown {
    updatedAt: number;
}

export class SessionForkOrigins {
    /** The fork parent of each thread, `null` for no fork, or the thread as it was when it could not be read yet. */
    private readonly origins = new Map<string, string | null | Unknown>();
    private readonly pending = new Map<string, Thread>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;
    private disposed = false;

    constructor(private readonly deps: SessionForkOriginsDeps) {}

    /**
     * The fork parent of a thread: `Thread.forkedFromId` when Codex gives it, else the one `thread/read` gave,
     * `null` for no fork or before the read. A thread that is not read yet is read in the background.
     */
    originOf(thread: Thread): string | null {
        if (thread.forkedFromId) return thread.forkedFromId;
        const known = this.origins.get(thread.id);
        if (isAnswer(known)) return known;
        // A thread without a rollout is not listed, and Codex has nothing to read for it yet.
        if (thread.path === null) return null;
        if (known === undefined || known.updatedAt !== thread.updatedAt) this.schedule(thread);
        return null;
    }

    /** This adapter forked `parentId` into `threadId`: the fork parent is known without a read. */
    remember(threadId: string, parentId: string): void {
        this.pending.delete(threadId);
        remember(this.origins, threadId, parentId);
    }

    /** Another part of the adapter read the thread with `thread/read`: its `forkedFromId` is the answer, if none is known yet. */
    readElsewhere(thread: Thread): void {
        if (isAnswer(this.origins.get(thread.id))) return;
        this.pending.delete(thread.id);
        remember(this.origins, thread.id, thread.forkedFromId || null);
    }

    /** Drops the pending reads. */
    dispose(): void {
        this.disposed = true;
        this.pending.clear();
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
    }

    /** Whether reads are pending or running. For tests. */
    busy(): boolean {
        return this.running || this.timer !== null;
    }

    private schedule(thread: Thread): void {
        if (this.disposed) return;
        this.pending.set(thread.id, thread);
        if (this.timer !== null || this.running) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.readPending();
        }, 0);
        this.timer.unref?.();
    }

    private async readPending(): Promise<void> {
        this.running = true;
        try {
            while (this.pending.size > 0 && !this.disposed) {
                const batch = [...this.pending.values()];
                this.pending.clear();
                const found: string[] = [];
                for (let start = 0; start < batch.length && !this.disposed; start += READ_CONCURRENCY) {
                    await Promise.all(batch.slice(start, start + READ_CONCURRENCY).map(async (thread) => {
                        if (await this.read(thread)) found.push(thread.id);
                    }));
                }
                if (found.length > 0 && !this.disposed) this.deps.onFound(found);
            }
        } finally {
            this.running = false;
        }
    }

    /** Reads the fork parent of a thread with `thread/read`; true when it is a fork. */
    private async read(thread: Thread): Promise<boolean> {
        // A thread listed again while it was read waits for that read, which may have answered meanwhile.
        if (isAnswer(this.origins.get(thread.id))) return false;
        // Without an app-server, the thread is read when it is listed next.
        const reader = this.deps.reader();
        if (reader === null) return false;
        let origin: string | null | Unknown;
        try {
            origin = (await reader.threadRead({threadId: thread.id, includeTurns: false})).thread.forkedFromId || null;
        } catch (error) {
            if (!isNotReadableYet(error)) {
                // Not cached: the thread is read again when it is listed next.
                logger.log("Cannot read the fork parent of a thread", {threadId: thread.id, error: String(error)});
                return false;
            }
            origin = {updatedAt: thread.updatedAt};
        }
        // An answer is final: a later read does not take it back.
        if (isAnswer(this.origins.get(thread.id))) return false;
        remember(this.origins, thread.id, origin);
        return typeof origin === "string";
    }
}

/** Codex has no rollout of the thread yet, or does not know it yet. */
function isNotReadableYet(error: unknown): boolean {
    return isMissingThreadError(error) || isThreadNotMaterializedError(error);
}

/** A fork parent or `null` for no fork, as opposed to a thread that could not be read yet. */
function isAnswer(value: string | null | Unknown | undefined): value is string | null {
    return typeof value === "string" || value === null;
}

/** Keeps a value, most recent last, and drops the oldest beyond {@link MAX_CACHED}. */
function remember<T>(cache: Map<string, T>, key: string, value: T): void {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size <= MAX_CACHED) return;
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
}
