// Follow store (task 081 / proposal J4): tiny HUD-side shared state naming the people whose life logs the
// city feed should stream. Lives entirely on the React side of the seam (like window state) — the game never
// reads it; the Feed polls the followed people's logs through the normal read-only engine accessors. Not
// serialized: follows are a viewing preference, not world state.

export interface FollowedPerson {
    personId: string;
    name: string;
}

const followed = new Map<string, string>();
const listeners = new Set<() => void>();

function notify(): void {
    for (const listener of listeners) {
        listener();
    }
}

export function isFollowed(personId: string): boolean {
    return followed.has(personId);
}

export function toggleFollow(personId: string, name: string): void {
    if (followed.has(personId)) {
        followed.delete(personId);
    } else {
        followed.set(personId, name);
    }
    notify();
}

export function getFollowed(): FollowedPerson[] {
    return [...followed.entries()].map(([personId, name]) => ({ personId, name }));
}

export function subscribeFollow(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
