import { EventPayloads } from '@/types/Events';

export interface Handler<T> {
    callback: (payload: T) => void;
    context?: any;
}

export type HandlerList<T> = Array<Handler<T>>;

export type EventListeners = { 
    [E in keyof EventPayloads]?: HandlerList<EventPayloads[E]> 
};